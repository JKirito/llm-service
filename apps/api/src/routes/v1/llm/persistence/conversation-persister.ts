import { createLogger } from "@llm-service/logger";
import { createInteraction } from "./interaction-store";
import type { InteractionData } from "./types";
import type { BasicUIMessage } from "../messages";
import type { MessageSource, ImageReference } from "../types";

const logger = createLogger("CONVERSATION_PERSISTER");

/**
 * Parameters for persisting an interaction
 */
export interface PersistInteractionParams {
  /** Optional conversation ID to group related interactions */
  conversationId?: string;
  /** Unique message ID for this interaction */
  messageId: string;
  /** Model identifier used for this interaction */
  model: string;
  /** Array of request messages sent to the LLM */
  requestMessages: BasicUIMessage[];
  /** Response message from the LLM */
  responseMessage: BasicUIMessage;
  /** Token usage and other usage statistics */
  usage?: Record<string, unknown>;
  /** Optional sources referenced in the response */
  sources?: MessageSource[];
  /** Optional image references in the response */
  imageReferences?: ImageReference[];
  /** Optional document references */
  documentReferences?: string[];
  /** Whether the response was streamed */
  wasStreamed: boolean;
  /** Duration of the interaction in milliseconds */
  duration?: number;
}

/**
 * Persists an LLM interaction to MongoDB using the interaction store
 *
 * This function takes interaction data (messages, response, metadata) and
 * persists it to the MongoDB interactions collection. It provides a clean
 * interface for storing conversation history.
 *
 * @param params - The interaction parameters to persist
 * @returns The MongoDB document ID of the persisted interaction
 * @throws Error if persistence fails
 *
 * @example
 * ```typescript
 * const docId = await persistInteraction({
 *   messageId: "msg_123",
 *   model: "claude-3-opus-20240229",
 *   requestMessages: [{ id: "1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
 *   responseMessage: { id: "2", role: "assistant", parts: [{ type: "text", text: "Hi!" }] },
 *   wasStreamed: true,
 *   duration: 1234
 * });
 * ```
 */
export async function persistInteraction(
  params: PersistInteractionParams,
): Promise<string> {
  const {
    conversationId,
    messageId,
    model,
    requestMessages,
    responseMessage,
    usage,
    sources,
    imageReferences,
    documentReferences,
    wasStreamed,
    duration,
  } = params;

  try {
    logger.debug("Persisting interaction", {
      messageId,
      conversationId,
      model,
      wasStreamed,
      requestMessageCount: requestMessages.length,
      hasSources: sources && sources.length > 0,
      hasImageReferences: imageReferences && imageReferences.length > 0,
      hasDocumentReferences:
        documentReferences && documentReferences.length > 0,
    });

    // Build the interaction data object
    const interactionData: InteractionData = {
      conversationId,
      messageId,
      model,
      requestMessages,
      responseMessage,
      usage,
      sources,
      imageReferences,
      documentReferences,
      wasStreamed,
      duration,
    };

    // Persist to MongoDB via interaction store
    const documentId = await createInteraction(interactionData);

    logger.info("Interaction persisted successfully", {
      messageId,
      conversationId,
      documentId,
      model,
    });

    return documentId;
  } catch (error) {
    logger.error("Failed to persist interaction", {
      error,
      messageId,
      conversationId,
      model,
    });

    // Re-throw with context
    throw new Error(
      `Failed to persist interaction ${messageId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
