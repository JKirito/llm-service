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
    // Event-driven streaming: Write to Redis Stream instead of direct SSE
    const {
      initializeStream,
      writeChunk,
      writeSources,
      writeMetadata,
      completeStream,
      errorStream,
      isStreamCancelled,
    } = await import("./stream-service");

    // Initialize the Redis stream
    await initializeStream(conversationId, model);

    // Start background streaming process (non-blocking)
    // This allows us to return immediately while streaming continues
    (async () => {
      let streamedText = "";
      let streamSources: MessageSource[] | undefined;
      const abortController = new AbortController();

      // Periodic cancellation check
      const cancellationCheckInterval = setInterval(async () => {
        const isCancelled = await isStreamCancelled(conversationId);
        if (isCancelled) {
          abortController.abort();
          clearInterval(cancellationCheckInterval);
        }
      }, 500); // Check every 500ms

      try {
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
          abortSignal: abortController.signal,
        });

        // Stream chunks to Redis
        for await (const chunk of result.textStream) {
          streamedText += chunk;
          await writeChunk(conversationId, chunk);

          // Check for cancellation
          if (abortController.signal.aborted) {
            logger.info(`Stream cancelled for conversation ${conversationId}`);
            break;
          }
        }

        // Get final result with sources
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
            await writeSources(conversationId, extractedSources);
          }
        }

        // Write metadata (usage, etc.)
        if (finalResult.usage) {
          await writeMetadata(conversationId, {
            usage: finalResult.usage,
          });
        }

        // Persist conversation
        const assistantMessage = createTextMessage(
          "assistant",
          streamedText,
          {
            model,
            ...(finalResult.usage ? { usage: finalResult.usage } : {}),
          },
          undefined,
          undefined,
          streamSources,
        );
        const updatedConversationMessages = [
          ...combinedMessages,
          assistantMessage,
        ];

        try {
          await replaceConversationMessages(
            conversationId,
            updatedConversationMessages,
          );
        } catch (persistError) {
          logger.error(
            "Failed to persist streamed conversation",
            persistError,
          );
        }

        // Mark stream as complete
        await completeStream(conversationId);
        clearInterval(cancellationCheckInterval);
      } catch (error) {
        clearInterval(cancellationCheckInterval);

        // Check if it was cancelled
        if (abortController.signal.aborted) {
          // Save partial response if we have text
          if (streamedText.length > 0) {
            const assistantMessage = createTextMessage(
              "assistant",
              streamedText,
              { model },
              undefined,
              undefined,
              streamSources,
            );
            const updatedConversationMessages = [
              ...combinedMessages,
              assistantMessage,
            ];
            try {
              await replaceConversationMessages(
                conversationId,
                updatedConversationMessages,
              );
            } catch (persistError) {
              logger.error(
                "Failed to persist cancelled conversation",
                persistError,
              );
            }
          }
          logger.info(`Stream cancelled for conversation ${conversationId}`);
          return; // Don't mark as error, cancellation was handled
        }

        // Otherwise, it's a real error
        logger.error("Stream execution failed", error);
        const errorMessage =
          error instanceof Error ? error.message : "Stream execution failed";
        await errorStream(conversationId, errorMessage);
      }
    })();

    // Return immediately with conversationId
    const responsePayload: ApiResponse<{
      conversationId: string;
      streaming: boolean;
      message: string;
    }> = {
      success: true,
      data: {
        conversationId,
        streaming: true,
        message:
          "Stream started. Use /v1/llm/stream/subscribe/:conversationId to receive events.",
      },
    };

    return Response.json(responsePayload, {
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
