import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  streamText,
  TypeValidationError,
  validateUIMessages,
} from "ai";
import { createLogger } from "@llm-service/logger";
import type { ApiResponse } from "@llm-service/types";
import { config } from "../../../config";
import type { RouteHandler } from "../../types";
import {
  buildMessagesFromBody,
  containsUserMessage,
  createTextMessage,
  type BasicUIMessage,
} from "./messages";
import {
  createConversation,
  findConversation,
  replaceConversationMessages,
} from "./conversation-store";
import { downloadFile } from "@llm-service/azure-storage";
import { initializeAzureStorage } from "@llm-service/azure-storage";
import { getFileUrlFromPath } from "../../../lib/storage-url";
import { parseDocument } from "../../../lib/document-parser";
import { SystemPromptBuilder } from "./system-prompt-builder";
import type {
  DocumentContext,
  MessageFileReference,
  MessageSource,
} from "./types";
import { parseDocumentPath } from "./types";
import { toolRegistry } from "./tools-registry";
import type { LLMUIMessage } from "./ui-message-types";

const logger = createLogger("LLM_ROUTES");

interface GenerateAnswerResponse {
  conversationId: string;
  model: string;
  text: string;
  usage?: unknown;
  warnings?: unknown;
  sources?: Array<{ url: string; title?: string }>;
}

const openai = createOpenAI({
  apiKey: config.openai.apiKey,
});

// Initialize Azure Storage if not already initialized
let azureStorageInitialized = false;
function ensureAzureStorage(): void {
  if (!azureStorageInitialized) {
    initializeAzureStorage(config.azure.connectionString);
    azureStorageInitialized = true;
  }
}

/**
 * Upload a file to OpenAI Files API
 * Returns the file ID that can be used with code_interpreter
 */
async function uploadFileToOpenAI(
  fileBuffer: Buffer,
  fileName: string,
): Promise<string> {
  try {
    const formData = new FormData();
    // Convert Buffer to Uint8Array for Blob compatibility
    const uint8Array = new Uint8Array(fileBuffer);
    const blob = new Blob([uint8Array], { type: "application/octet-stream" });
    const file = new File([blob], fileName);
    formData.append("file", file);
    formData.append("purpose", "assistants");

    const response = await fetch("https://api.openai.com/v1/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openai.apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `OpenAI file upload failed: ${response.status} - ${
          error.error?.message || response.statusText
        }`,
      );
    }

    const result = (await response.json()) as { id: string };
    logger.info(`Uploaded file to OpenAI: ${fileName} -> ${result.id}`);
    return result.id;
  } catch (error) {
    logger.error(`Failed to upload file to OpenAI: ${fileName}`, error);
    throw error;
  }
}

export const generateAnswerHandler: RouteHandler = async (req) => {
  let body: Record<string, unknown>;

  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    const response: ApiResponse = {
      success: false,
      error: "Invalid JSON payload",
    };
    return Response.json(response, { status: 400 });
  }

  const model =
    typeof body.model === "string" && body.model.trim() !== ""
      ? body.model.trim()
      : config.openai.defaultModel;

  const temperature = body.temperature;

  // Parse reasoningEffort and textVerbosity options
  const VALID_REASONING_EFFORT = ["low", "medium", "high"] as const;
  const VALID_TEXT_VERBOSITY = ["low", "medium", "high"] as const;

  let reasoningEffort: "low" | "medium" | "high" = "low";
  if (body.reasoningEffort !== undefined) {
    if (
      typeof body.reasoningEffort === "string" &&
      VALID_REASONING_EFFORT.includes(
        body.reasoningEffort as (typeof VALID_REASONING_EFFORT)[number],
      )
    ) {
      reasoningEffort = body.reasoningEffort as "low" | "medium" | "high";
    } else {
      const response: ApiResponse = {
        success: false,
        error: `reasoningEffort must be one of: ${VALID_REASONING_EFFORT.join(", ")}`,
      };
      return Response.json(response, { status: 400 });
    }
  }

  let textVerbosity: "low" | "medium" | "high" = "low";
  if (body.textVerbosity !== undefined) {
    if (
      typeof body.textVerbosity === "string" &&
      VALID_TEXT_VERBOSITY.includes(
        body.textVerbosity as (typeof VALID_TEXT_VERBOSITY)[number],
      )
    ) {
      textVerbosity = body.textVerbosity as "low" | "medium" | "high";
    } else {
      const response: ApiResponse = {
        success: false,
        error: `textVerbosity must be one of: ${VALID_TEXT_VERBOSITY.join(", ")}`,
      };
      return Response.json(response, { status: 400 });
    }
  }

  // Parse tools if provided
  let requestedTools: string[] = [];
  if (Array.isArray(body.tools)) {
    requestedTools = body.tools.filter(
      (tool): tool is string => typeof tool === "string" && tool.trim() !== "",
    );
  }

  // Validate tool names exist in registry
  if (requestedTools.length > 0) {
    const invalidTools = requestedTools.filter(
      (toolName) => !toolRegistry.getTool(toolName),
    );
    if (invalidTools.length > 0) {
      const response: ApiResponse = {
        success: false,
        error: `Invalid tool names: ${invalidTools.join(", ")}`,
      };
      return Response.json(response, { status: 400 });
    }
  }

  // Determine if Responses API is needed (will be updated after we get file IDs)
  const needsResponsesAPI =
    requestedTools.length > 0 &&
    toolRegistry.requiresResponsesAPI(requestedTools);

  // Parse document references if provided
  let documentReferences: string[] = [];
  if (Array.isArray(body.documentReferences)) {
    documentReferences = body.documentReferences.filter(
      (ref): ref is string => typeof ref === "string" && ref.trim() !== "",
    );
  }

  // Process documents if provided
  let documentContexts: DocumentContext[] = [];
  let fileReferences: MessageFileReference[] = [];
  let openAIFileIds: string[] = [];
  const needsCodeInterpreter = requestedTools.includes("code_interpreter");

  if (documentReferences.length > 0) {
    ensureAzureStorage();

    try {
      // Process documents in parallel (Azure download + OpenAI upload)
      const documentPromises = documentReferences.map(async (docRef) => {
        try {
          const { containerName, filePath } = parseDocumentPath(docRef);

          // Download file from Azure Storage
          const downloadResult = await downloadFile(containerName, filePath);

          // Extract filename from metadata or use fileName
          const filename =
            downloadResult.metadata?.originalName || downloadResult.fileName;

          // Run Azure processing and OpenAI upload in parallel
          const [parsedContent, openAIFileId] = await Promise.all([
            // Parse document content for system prompt
            parseDocument(
              downloadResult.content,
              downloadResult.contentType || "application/octet-stream",
              downloadResult.fileName,
            ),
            // Upload to OpenAI Files API if code_interpreter is requested
            needsCodeInterpreter
              ? uploadFileToOpenAI(downloadResult.content, filename)
              : Promise.resolve(undefined),
          ]);

          // Generate file URL dynamically using path format
          const fullPath = `${containerName}/${filePath}`;
          const fileUrl = getFileUrlFromPath(fullPath);

          // Build DocumentContext
          const docContext: DocumentContext = {
            filename,
            content: parsedContent,
            url: fileUrl,
            containerName,
            filePath,
          };

          // Build file reference for message metadata
          const fileRef: MessageFileReference = {
            path: `${containerName}/${filePath}`,
            filename,
          };

          return {
            docContext,
            fileRef,
            openAIFileId,
          };
        } catch (error) {
          logger.error(
            `Failed to process document reference: ${docRef}`,
            error,
          );
          throw error;
        }
      });

      const results = await Promise.all(documentPromises);

      // Collect results
      for (const result of results) {
        documentContexts.push(result.docContext);
        fileReferences.push(result.fileRef);
        if (result.openAIFileId) {
          openAIFileIds.push(result.openAIFileId);
        }
      }
    } catch (error) {
      logger.error("Failed to process documents", error);
      const response: ApiResponse = {
        success: false,
        error:
          error instanceof Error
            ? `Failed to process documents: ${error.message}`
            : "Failed to process documents",
      };
      return Response.json(response, { status: 500 });
    }
  }

  // Get OpenAI tools with file IDs (for code_interpreter)
  const openAITools =
    requestedTools.length > 0
      ? toolRegistry.getOpenAITools(
          requestedTools,
          openAIFileIds.length > 0 ? openAIFileIds : undefined,
        )
      : undefined;


  const buildResult = buildMessagesFromBody(body);
  if (!buildResult.success) {
    return Response.json(buildResult.response, { status: 400 });
  }

  const { messages: parsedRequestMessages } = buildResult;

  // Extract existing system message if any
  let existingSystemMessage: BasicUIMessage | undefined;
  const userMessages: BasicUIMessage[] = [];

  for (const msg of parsedRequestMessages) {
    if (msg.role === "system") {
      existingSystemMessage = msg;
    } else {
      userMessages.push(msg);
    }
  }

  // Build enhanced system message if documents or tools are provided
  if (documentContexts.length > 0 || requestedTools.length > 0) {
    const builder = new SystemPromptBuilder(
      existingSystemMessage?.parts[0]?.text || undefined,
    );

    // Get actual OpenAI tool names for the system prompt to match what's available
    const openAIToolNames =
      requestedTools.length > 0
        ? toolRegistry.getOpenAIToolNames(requestedTools)
        : undefined;

    const enhancedSystemPrompt = builder.build({
      documents: documentContexts,
      tools: openAIToolNames, // Use actual OpenAI tool names, not user-facing names
    });

    // Replace or create system message
    existingSystemMessage = createTextMessage("system", enhancedSystemPrompt);
  }

  // Reconstruct messages array with enhanced system message
  const requestMessages: BasicUIMessage[] = [];
  if (existingSystemMessage) {
    requestMessages.push(existingSystemMessage);
  }
  requestMessages.push(...userMessages);

  // Add file references to user messages that include documents
  const requestMessagesWithFileRefs = requestMessages.map((message) => {
    if (message.role === "user" && fileReferences.length > 0) {
      const existingMetadata = message.metadata ?? {};
      return {
        ...message,
        metadata: {
          ...existingMetadata,
          model,
          fileReferences,
        },
      };
    }

    const existingMetadata = message.metadata ?? {};
    return {
      ...message,
      metadata: {
        ...existingMetadata,
        model,
      },
    };
  });

  const streamRequested =
    typeof body.stream === "boolean"
      ? body.stream
      : typeof body.stream === "string"
        ? body.stream.toLowerCase() === "true"
        : false;

  if (!containsUserMessage(requestMessages)) {
    const response: ApiResponse = {
      success: false,
      error:
        "At least one user message is required. Provide a prompt or include a user role message.",
    };
    return Response.json(response, { status: 400 });
  }

  const conversationIdFromBody =
    typeof body.conversationId === "string" && body.conversationId.trim() !== ""
      ? body.conversationId.trim()
      : null;

  let persistedConversationMessages: BasicUIMessage[] = [];

  if (conversationIdFromBody) {
    const existingConversation = await findConversation(conversationIdFromBody);
    if (!existingConversation) {
      const response: ApiResponse = {
        success: false,
        error: `Conversation ${conversationIdFromBody} not found`,
      };
      return Response.json(response, { status: 404 });
    }
    persistedConversationMessages = existingConversation.messages;
  }

  const combinedMessages: BasicUIMessage[] = [
    ...persistedConversationMessages,
    ...requestMessagesWithFileRefs,
  ];

  let validatedMessages;
  try {
    validatedMessages = await validateUIMessages({
      messages: combinedMessages,
    });
  } catch (error) {
    if (error instanceof TypeValidationError) {
      const response: ApiResponse = {
        success: false,
        error: `Invalid message format: ${error.message}`,
      };
      return Response.json(response, { status: 400 });
    }
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Invalid messages",
    };
    return Response.json(response, { status: 400 });
  }

  const modelMessages = convertToModelMessages(validatedMessages);

  // Select model API based on tool requirements
  const modelInstance = needsResponsesAPI
    ? openai.responses(model)
    : openai(model);

  let conversationId = conversationIdFromBody;

  try {
    if (conversationId) {
      await replaceConversationMessages(conversationId, combinedMessages);
    } else {
      const createdConversation = await createConversation(combinedMessages);
      conversationId = createdConversation.conversationId;
    }
  } catch (error) {
    logger.error("Failed to persist conversation", error);
    const response: ApiResponse = {
      success: false,
      error: "Failed to persist conversation",
    };
    return Response.json(response, { status: 500 });
  }

  if (!conversationId) {
    logger.error("Conversation ID missing after initial persistence");
    const response: ApiResponse = {
      success: false,
      error: "Conversation state is inconsistent",
    };
    return Response.json(response, { status: 500 });
  }

  if (streamRequested) {
    // Use Vercel AI SDK's proper streaming with Redis caching as side effect
    const {
      initializeStream,
      writeChunk,
      writeSources,
      writeMetadata,
      completeStream,
      errorStream,
    } = await import("./stream-service");

    // Initialize Redis stream for caching (side effect)
    await initializeStream(conversationId, model).catch((err) =>
      logger.error("Failed to initialize Redis stream cache", err),
    );

    // Create AI SDK stream with custom data parts
    // Capture usage data for persistence
    let capturedUsage: Record<string, unknown> | undefined;

    const stream = createUIMessageStream<LLMUIMessage>({
      async execute({ writer }) {
        let streamSources: MessageSource[] | undefined;

        try {
          // Send initial notification (transient)
          writer.write({
            type: "data-notification",
            data: {
              message: "Processing your request...",
              level: "info",
            },
            transient: true,
          });

          // Stream status (persistent)
          writer.write({
            type: "data-streamStatus",
            id: "stream-status",
            data: {
              conversationId,
              status: "streaming",
              cached: true,
            },
          });

          // Start LLM streaming
          const result = streamText({
            model: modelInstance,
            messages: modelMessages,
            ...(openAITools ? { tools: openAITools } : {}),
            temperature:
              typeof temperature === "number" && !Number.isNaN(temperature)
                ? temperature
                : undefined,
            ...(needsResponsesAPI
              ? {
                  providerOptions: {
                    openai: {
                      reasoningEffort,
                      textVerbosity,
                    },
                  },
                }
              : {}),
            abortSignal: req.signal,
            onChunk: ({ chunk }) => {
              // Side effect: Cache chunks to Redis
              if (
                chunk.type === "text-delta" &&
                typeof chunk.text === "string"
              ) {
                writeChunk(conversationId, chunk.text).catch((err) =>
                  logger.error("Failed to cache chunk to Redis", err),
                );
              }
            },
          });

          // Merge AI SDK stream (text, tools, etc.)
          writer.merge(result.toUIMessageStream());

          // Wait for completion and extract sources
          const finalResult = await result;

          // Extract sources if available
          if ("sources" in finalResult && Array.isArray(finalResult.sources)) {
            const extractedSources: MessageSource[] = [];
            for (const source of finalResult.sources) {
              if (
                typeof source === "object" &&
                source !== null &&
                "type" in source &&
                source.type === "source" &&
                "sourceType" in source &&
                "id" in source &&
                "url" in source
              ) {
                const src = source as {
                  type: string;
                  sourceType: string;
                  id: string;
                  url: string;
                  title?: string;
                };
                extractedSources.push({
                  type: src.type,
                  sourceType: src.sourceType,
                  id: src.id,
                  url: src.url,
                  title: src.title,
                  sourceOrigin: "tool",
                  sourceProvider: requestedTools.includes("web_search")
                    ? "web_search"
                    : undefined,
                });
              }
            }

            if (extractedSources.length > 0) {
              streamSources = extractedSources;

              // Write sources as custom data part
              writer.write({
                type: "data-sources",
                id: "sources-1",
                data: {
                  sources: extractedSources,
                  status: "success",
                },
              });

              // Side effect: Cache to Redis
              writeSources(conversationId, extractedSources).catch((err) =>
                logger.error("Failed to cache sources to Redis", err),
              );
            }
          }

          // Write usage information with full details (includes cached, reasoning tokens, etc.)
          if (finalResult.usage) {
            // Capture usage for persistence in onFinish
            capturedUsage = finalResult.usage as Record<string, unknown>;

            writer.write({
              type: "data-usage",
              id: "usage-1",
              data: finalResult.usage, // Pass entire usage object to preserve all details
            });

            // Side effect: Cache to Redis
            writeMetadata(conversationId, {
              usage: finalResult.usage,
            }).catch((err) =>
              logger.error("Failed to cache metadata to Redis", err),
            );
          }

          // Update stream status to completed
          writer.write({
            type: "data-streamStatus",
            id: "stream-status",
            data: {
              conversationId,
              status: "completed",
              cached: true,
            },
          });

          // Side effect: Mark Redis stream as complete
          completeStream(conversationId).catch((err) =>
            logger.error("Failed to mark Redis stream as complete", err),
          );

          // Send completion notification (transient)
          writer.write({
            type: "data-notification",
            data: {
              message: "Request completed successfully",
              level: "info",
            },
            transient: true,
          });
        } catch (error) {
          logger.error("Stream execution failed", error);

          const errorMessage =
            error instanceof Error ? error.message : "Stream execution failed";

          // Write error notification
          writer.write({
            type: "data-notification",
            data: {
              message: errorMessage,
              level: "error",
            },
            transient: true,
          });

          // Update stream status to error
          writer.write({
            type: "data-streamStatus",
            id: "stream-status",
            data: {
              conversationId,
              status: "error",
              cached: true,
            },
          });

          // Side effect: Mark Redis stream as error
          errorStream(conversationId, errorMessage).catch((err) =>
            logger.error("Failed to mark Redis stream as error", err),
          );

          throw error; // Re-throw for AI SDK to handle
        }
      },

      // onFinish: Persist conversation to MongoDB
      onFinish: async ({ messages: aiSdkMessages }) => {
        try {
          // AI SDK messages only contain the assistant response
          // We need to combine with the original request messages
          const assistantMessages = aiSdkMessages.filter(
            (msg) => msg.role === "assistant",
          );

          // Add usage metadata to assistant messages if available (captured from execute)
          const assistantMessagesWithUsage = assistantMessages.map(
            (msg: BasicUIMessage) => {
              if (msg.role === "assistant" && capturedUsage) {
                // Ensure usage metadata is attached to assistant message
                const existingMetadata = msg.metadata ?? {};
                return {
                  ...msg,
                  metadata: {
                    ...existingMetadata,
                    model,
                    usage: capturedUsage, // Preserve full usage details from AI SDK
                  },
                };
              }
              return msg;
            },
          );

          // Build complete conversation: previous + user request + assistant response
          const completeConversation = [
            ...combinedMessages, // Includes: previous messages + new user message
            ...assistantMessagesWithUsage, // Assistant's response from AI SDK with usage
          ];

          await replaceConversationMessages(conversationId, completeConversation);
          logger.info(
            `Persisted conversation ${conversationId} to MongoDB (${completeConversation.length} messages)`,
          );
        } catch (persistError) {
          logger.error("Failed to persist streamed conversation", persistError);
        }
      },
    });

    // Return AI SDK's proper SSE response
    return createUIMessageStreamResponse({
      stream,
      headers: {
        "X-Conversation-Id": conversationId,
      },
    });
  }

  try {
    const result = await generateText({
      model: modelInstance,
      messages: modelMessages,
      ...(openAITools ? { tools: openAITools } : {}),
      temperature:
        typeof temperature === "number" && !Number.isNaN(temperature)
          ? temperature
          : undefined,
      ...(needsResponsesAPI
        ? {
            providerOptions: {
              openai: {
                reasoningEffort,
                textVerbosity,
              },
            },
          }
        : {}),
    });

    const usageMetadata =
      result.usage && typeof result.usage === "object"
        ? (result.usage as Record<string, unknown>)
        : undefined;

    // Extract sources if available (from web_search tool, RAG, MCP, etc.)
    // Sources format: [{ type: "source", sourceType: "url", id: "...", url: "...", title: "..." }]
    let messageSources: MessageSource[] | undefined;
    if ("sources" in result && Array.isArray(result.sources)) {
      const extractedSources: MessageSource[] = [];
      for (const source of result.sources) {
        // Handle AI SDK source format
        if (
          typeof source === "object" &&
          source !== null &&
          "type" in source &&
          source.type === "source" &&
          "sourceType" in source &&
          "id" in source &&
          "url" in source
        ) {
          const src = source as {
            type: string;
            sourceType: string;
            id: string;
            url: string;
            title?: string;
          };
          extractedSources.push({
            type: src.type,
            sourceType: src.sourceType,
            id: src.id,
            url: src.url,
            title: src.title,
            sourceOrigin: "tool",
            sourceProvider: requestedTools.includes("web_search")
              ? "web_search"
              : undefined,
          });
        }
      }

      if (extractedSources.length > 0) {
        messageSources = extractedSources;
      }
    }

    // Also extract simplified sources for API response
    const sources =
      messageSources && messageSources.length > 0
        ? messageSources.map((s) => ({
            url: s.url,
            title: s.title,
          }))
        : undefined;

    const assistantMessage = createTextMessage(
      "assistant",
      result.text,
      {
        model,
        ...(usageMetadata ? { usage: usageMetadata } : {}),
      },
      undefined,
      undefined,
      messageSources,
    );
    const updatedConversationMessages = [...combinedMessages, assistantMessage];

    try {
      await replaceConversationMessages(
        conversationId,
        updatedConversationMessages,
      );
    } catch (persistError) {
      logger.error("Failed to persist conversation", persistError);
      const response: ApiResponse = {
        success: false,
        error: "Failed to persist conversation",
      };
      return Response.json(response, { status: 500 });
    }

    const responsePayload: ApiResponse<GenerateAnswerResponse> = {
      success: true,
      data: {
        conversationId,
        model,
        text: result.text,
        usage: result.usage,
        warnings: result.warnings,
        ...(sources ? { sources } : {}),
      },
    };

    return Response.json(responsePayload);
  } catch (error) {
    logger.error("Failed to generate answer", error);

    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to generate answer",
    };
    return Response.json(response, { status: 500 });
  }
};
