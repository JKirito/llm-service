import type { ApiResponse } from "@llm-service/types";
import type { RouteHandler } from "../../types";
import { createLogger } from "@llm-service/logger";
import {
  getStreamMetadata,
  readStream,
  getAllStreamEntries,
  cancelStream,
  type StreamMetadata,
  type StreamEntry,
} from "./stream-service";

const logger = createLogger("STREAM_ROUTES");

/**
 * GET /v1/llm/stream/status/:conversationId
 * Check if a conversation is actively streaming
 */
export const getStreamStatusHandler: RouteHandler = async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const conversationId = pathParts[pathParts.length - 1];

  if (!conversationId || conversationId.trim() === "") {
    const response: ApiResponse = {
      success: false,
      error: "conversationId is required",
    };
    return Response.json(response, { status: 400 });
  }

  try {
    const metadata = await getStreamMetadata(conversationId);

    if (!metadata) {
      const response: ApiResponse = {
        success: false,
        error: `No stream found for conversation ${conversationId}`,
      };
      return Response.json(response, { status: 404 });
    }

    const responsePayload: ApiResponse<StreamMetadata> = {
      success: true,
      data: metadata,
    };

    return Response.json(responsePayload);
  } catch (error) {
    logger.error(
      `Failed to get stream status for conversation ${conversationId}`,
      error,
    );
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to get stream status",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * POST /v1/llm/stream/cancel/:conversationId
 * Cancel an active stream
 */
export const cancelStreamHandler: RouteHandler = async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const conversationId = pathParts[pathParts.length - 1];

  if (!conversationId || conversationId.trim() === "") {
    const response: ApiResponse = {
      success: false,
      error: "conversationId is required",
    };
    return Response.json(response, { status: 400 });
  }

  try {
    const metadata = await getStreamMetadata(conversationId);

    if (!metadata) {
      const response: ApiResponse = {
        success: false,
        error: `No stream found for conversation ${conversationId}`,
      };
      return Response.json(response, { status: 404 });
    }

    if (metadata.status !== "streaming") {
      const response: ApiResponse = {
        success: false,
        error: `Stream for conversation ${conversationId} is not active (status: ${metadata.status})`,
      };
      return Response.json(response, { status: 400 });
    }

    await cancelStream(conversationId);

    const responsePayload: ApiResponse<{ message: string }> = {
      success: true,
      data: {
        message: `Stream cancelled for conversation ${conversationId}`,
      },
    };

    return Response.json(responsePayload);
  } catch (error) {
    logger.error(
      `Failed to cancel stream for conversation ${conversationId}`,
      error,
    );
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to cancel stream",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * GET /v1/llm/stream/subscribe/:conversationId?fromId=<streamId>&replay=<true|false>
 * Subscribe to a stream with optional replay from a specific position
 * Uses Server-Sent Events (SSE) for real-time streaming
 */
export const subscribeToStreamHandler: RouteHandler = async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const conversationId = pathParts[pathParts.length - 1];

  if (!conversationId || conversationId.trim() === "") {
    const response: ApiResponse = {
      success: false,
      error: "conversationId is required",
    };
    return Response.json(response, { status: 400 });
  }

  const fromId = url.searchParams.get("fromId") || "0";
  const replay = url.searchParams.get("replay") === "true";

  try {
    const metadata = await getStreamMetadata(conversationId);

    if (!metadata) {
      const response: ApiResponse = {
        success: false,
        error: `No stream found for conversation ${conversationId}`,
      };
      return Response.json(response, { status: 404 });
    }

    // Check if stream is inactive and handle appropriately
    const isInactive = metadata.status !== "streaming";

    // If stream is inactive and not in replay mode, provide clear guidance
    if (isInactive && !replay) {
      const response: ApiResponse = {
        success: false,
        error: `Stream for conversation ${conversationId} is not active (status: ${metadata.status}). Use ?replay=true to replay the completed stream, or check conversation history at /v1/llm/conversations/${conversationId}`,
      };
      return Response.json(response, { status: 400 });
    }

    // Create a ReadableStream for SSE
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();

        // Helper to send SSE message
        const sendSSE = (
          event: string,
          data: Record<string, unknown> | string,
        ) => {
          const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
          controller.enqueue(encoder.encode(message));
        };

        try {
          // Send initial metadata
          sendSSE("metadata", metadata as unknown as Record<string, unknown>);

          if (replay) {
            // Replay mode: get all entries from the beginning
            const entries = await getAllStreamEntries(conversationId);

            for (const { id, entry } of entries) {
              sendSSE("entry", { id, ...entry });

              // If we hit a complete or error event, we can stop
              if (entry.type === "complete" || entry.type === "error") {
                break;
              }
            }

            // After replay, close the stream
            sendSSE("done", { message: "Replay complete" });
            controller.close();
          } else {
            // Live streaming mode: poll for new entries
            let lastId = fromId;
            let isComplete = false;

            const pollInterval = setInterval(async () => {
              try {
                const entries = await readStream(conversationId, lastId, 50);

                if (entries.length > 0) {
                  for (const { id, entry } of entries) {
                    sendSSE("entry", { id, ...entry });
                    lastId = id;

                    // Check if stream is complete or errored
                    if (entry.type === "complete" || entry.type === "error") {
                      isComplete = true;
                      break;
                    }
                  }
                }

                // If stream is complete, stop polling
                if (isComplete) {
                  clearInterval(pollInterval);
                  sendSSE("done", { message: "Stream complete" });
                  controller.close();
                }

                // Also check metadata status
                const currentMetadata = await getStreamMetadata(conversationId);
                if (
                  currentMetadata &&
                  currentMetadata.status !== "streaming"
                ) {
                  clearInterval(pollInterval);
                  sendSSE("done", {
                    message: `Stream ${currentMetadata.status}`,
                  });
                  controller.close();
                }
              } catch (error) {
                logger.error("Error polling stream", error);
                clearInterval(pollInterval);
                sendSSE("error", {
                  error:
                    error instanceof Error
                      ? error.message
                      : "Stream polling error",
                });
                controller.close();
              }
            }, 100); // Poll every 100ms

            // Cleanup on connection close
            req.signal.addEventListener("abort", () => {
              clearInterval(pollInterval);
              controller.close();
              logger.info(
                `Client disconnected from stream ${conversationId}`,
              );
            });
          }
        } catch (error) {
          logger.error("Error in stream handler", error);
          sendSSE("error", {
            error:
              error instanceof Error
                ? error.message
                : "Stream handler error",
          });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Conversation-Id": conversationId,
      },
    });
  } catch (error) {
    logger.error(
      `Failed to subscribe to stream for conversation ${conversationId}`,
      error,
    );
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to subscribe to stream",
    };
    return Response.json(response, { status: 500 });
  }
};
