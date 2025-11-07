import {
  streamText,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type LanguageModel,
} from "ai";
import type { Tool } from "ai";
import { createLogger } from "@llm-service/logger";
import type { StreamConfig } from "./stream-types";
import type { LLMUIMessage } from "../ui-message-types";
import type { ImageReference, MessageSource } from "../types";
import { createImageGenerationTool } from "../tools/definitions/image-generator";
import {
  initializeStream,
  writeChunk,
  writeSources,
  writeMetadata,
  completeStream,
  errorStream,
  isStreamCancelled,
} from "../stream-service";

const logger = createLogger("STREAM_ORCHESTRATOR");

export interface CapturedData {
  usage?: Record<string, unknown>;
  imageReferences: ImageReference[];
}

/**
 * Handle streaming request with AI SDK
 * Streams to client via SSE and caches to Redis
 */
export async function handleStreamingRequest(
  config: StreamConfig,
): Promise<Response> {
  const {
    messageId,
    conversationId,
    model,
    messages,
    tools: openAITools,
    temperature,
    reasoningEffort,
    request,
    textVerbosity = "low",
    needsResponsesAPI = false,
    requestedTools = [],
    capturedData,
    onFinish,
  } = config;

  logger.info("Starting streaming request", {
    messageId,
    conversationId,
    messageCount: messages.length,
    toolCount: Object.keys(openAITools).length,
  });

  // Initialize Redis stream for caching (side effect)
  // Determine model name for metadata
  const modelName =
    typeof model === "object" && model !== null && "modelId" in model
      ? String(model.modelId)
      : "unknown";

  await initializeStream(
    messageId,
    conversationId || "unknown",
    modelName,
  ).catch((err) =>
    logger.error("Failed to initialize Redis stream cache", err),
  );

  // Use provided capturedData or create new one
  // This allows handler to pass a reference and access captured values
  const data = capturedData || { imageReferences: [] };

  const stream = createUIMessageStream<LLMUIMessage>({
    async execute({ writer }) {
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
            conversationId: conversationId || "unknown",
            status: "streaming",
            cached: true,
          },
        });

        // Build tools object merging existing OpenAI tools with generate_image tool
        const allTools: Record<string, Tool> = {
          ...(openAITools || {}),
          generate_image: createImageGenerationTool({
            writer,
            onImageGenerated: (imageRefs) => {
              data.imageReferences.push(...imageRefs);
            },
          }),
        };

        // Start LLM streaming
        const result = streamText({
          model: model as LanguageModel,
          messages,
          tools: allTools,
          temperature:
            typeof temperature === "number" && !Number.isNaN(temperature)
              ? temperature
              : undefined,
          ...(needsResponsesAPI && reasoningEffort
            ? {
                providerOptions: {
                  openai: {
                    reasoningEffort,
                    textVerbosity,
                  },
                },
              }
            : {}),
          abortSignal: request.signal,
          onChunk: ({ chunk }) => {
            // Check for cancellation (AbortSignal is read-only, so we just log)
            isStreamCancelled(messageId)
              .then((cancelled) => {
                if (cancelled) {
                  logger.info("Stream cancelled", { messageId });
                }
              })
              .catch((err) =>
                logger.error("Failed to check cancellation", err),
              );

            // Side effect: Cache chunks to Redis
            if (chunk.type === "text-delta" && typeof chunk.text === "string") {
              writeChunk(
                messageId,
                conversationId || "unknown",
                chunk.text,
              ).catch((err) =>
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
            writeSources(
              messageId,
              conversationId || "unknown",
              extractedSources,
            ).catch((err) =>
              logger.error("Failed to cache sources to Redis", err),
            );
          }
        }

        // Write usage information with full details (includes cached, reasoning tokens, etc.)
        if (finalResult.usage) {
          // Await usage if it's a Promise
          const usage = await finalResult.usage;

          // Capture usage for persistence in onFinish
          data.usage = usage as Record<string, unknown>;

          writer.write({
            type: "data-usage",
            id: "usage-1",
            data: usage, // Pass entire usage object to preserve all details
          });

          // Side effect: Cache to Redis
          writeMetadata(messageId, conversationId || "unknown", {
            usage,
          }).catch((err) =>
            logger.error("Failed to cache metadata to Redis", err),
          );
        }

        // Update stream status to completed
        writer.write({
          type: "data-streamStatus",
          id: "stream-status",
          data: {
            conversationId: conversationId || "unknown",
            status: "completed",
            cached: true,
          },
        });

        // Side effect: Mark Redis stream as complete
        completeStream(messageId, conversationId || "unknown").catch((err) =>
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
            conversationId: conversationId || "unknown",
            status: "error",
            cached: true,
          },
        });

        // Side effect: Mark Redis stream as error
        errorStream(messageId, conversationId || "unknown", errorMessage).catch(
          (err) => logger.error("Failed to mark Redis stream as error", err),
        );

        throw error; // Re-throw for AI SDK to handle
      }
    },

    // onFinish: Persist conversation to MongoDB
    onFinish,
  });

  // Return AI SDK's proper SSE response
  return createUIMessageStreamResponse({
    stream,
    headers: {
      "X-Conversation-Id": conversationId || "unknown",
      "X-Message-Id": messageId,
    },
  });
}
