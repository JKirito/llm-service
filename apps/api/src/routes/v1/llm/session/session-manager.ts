import { createLogger } from "@llm-service/logger";
import type { BasicUIMessage } from "../messages";
import {
  createConversation as createConversationInStore,
  findConversation,
  replaceConversationMessages,
} from "../conversation-store";

const logger = createLogger("SESSION_MANAGER");

/**
 * Session creation result containing the generated conversationId
 */
export interface SessionCreationResult {
  conversationId: string;
  messages: BasicUIMessage[];
}

/**
 * Creates a new session with a server-generated conversationId.
 *
 * This function is the primary entry point for creating new conversations
 * in the stateless architecture. It generates a UUID-based conversationId
 * and persists the initial messages to the database.
 *
 * @param messages - The initial messages to store in the new conversation
 * @returns Promise resolving to the session creation result with conversationId
 *
 * @example
 * ```typescript
 * const result = await createSession([
 *   { role: 'user', parts: [{ type: 'text', text: 'Hello' }] }
 * ]);
 * console.log(result.conversationId); // '550e8400-e29b-41d4-a716-446655440000'
 * ```
 *
 * @throws Error if conversation creation fails
 */
export async function createSession(
  messages: BasicUIMessage[],
): Promise<SessionCreationResult> {
  try {
    logger.info("Creating new session with generated conversationId");

    // Delegate to the conversation store which handles UUID generation
    const result = await createConversationInStore(messages);

    logger.info("Session created successfully", {
      conversationId: result.conversationId,
      messageCount: messages.length,
    });

    return result;
  } catch (error) {
    logger.error("Failed to create session", error);
    throw new Error(
      `Session creation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Retrieves an existing conversation by ID.
 *
 * This function fetches a conversation from the database, validating
 * that it exists before returning it.
 *
 * @param conversationId - The UUID of the conversation to retrieve
 * @returns Promise resolving to the conversation document or null if not found
 *
 * @example
 * ```typescript
 * const conversation = await getSession('550e8400-e29b-41d4-a716-446655440000');
 * if (conversation) {
 *   console.log(conversation.messages);
 * }
 * ```
 */
export async function getSession(conversationId: string): Promise<{
  conversationId: string;
  messages: BasicUIMessage[];
  label?: string;
  createdAt: Date;
  updatedAt: Date;
} | null> {
  try {
    logger.debug("Retrieving session", { conversationId });

    const conversation = await findConversation(conversationId);

    if (!conversation) {
      logger.warn("Session not found", { conversationId });
      return null;
    }

    logger.debug("Session retrieved successfully", {
      conversationId,
      messageCount: conversation.messages.length,
    });

    return {
      conversationId: conversation._id,
      messages: conversation.messages,
      ...(conversation.label ? { label: conversation.label } : {}),
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    };
  } catch (error) {
    logger.error("Failed to retrieve session", { conversationId }, error);
    throw new Error(
      `Session retrieval failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Updates an existing conversation's messages.
 *
 * This function replaces all messages in a conversation with the provided
 * message array. It's used when appending new messages to an existing
 * conversation.
 *
 * @param conversationId - The UUID of the conversation to update
 * @param messages - The complete updated message array
 * @returns Promise that resolves when the update is complete
 *
 * @example
 * ```typescript
 * await updateSession('550e8400-e29b-41d4-a716-446655440000', [
 *   ...existingMessages,
 *   newMessage
 * ]);
 * ```
 *
 * @throws Error if the conversation doesn't exist or update fails
 */
export async function updateSession(
  conversationId: string,
  messages: BasicUIMessage[],
): Promise<void> {
  try {
    logger.info("Updating session", {
      conversationId,
      messageCount: messages.length,
    });

    await replaceConversationMessages(conversationId, messages);

    logger.info("Session updated successfully", {
      conversationId,
      messageCount: messages.length,
    });
  } catch (error) {
    logger.error("Failed to update session", { conversationId }, error);
    throw new Error(
      `Session update failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Validates that a conversationId is properly formatted (UUID v4).
 *
 * This is a utility function for validating conversationIds before
 * attempting database operations.
 *
 * @param conversationId - The conversationId to validate
 * @returns true if valid UUID v4 format, false otherwise
 *
 * @example
 * ```typescript
 * if (isValidConversationId('550e8400-e29b-41d4-a716-446655440000')) {
 *   // Proceed with database operation
 * }
 * ```
 */
export function isValidConversationId(conversationId: string): boolean {
  // UUID v4 regex pattern
  const uuidV4Pattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  return uuidV4Pattern.test(conversationId);
}
