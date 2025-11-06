/**
 * Session management module for stateless LLM architecture.
 *
 * This module provides a clean abstraction layer for session/conversation
 * management, supporting both stateless (no conversationId) and stateful
 * (with conversationId) operations.
 */

export {
  createSession,
  getSession,
  updateSession,
  isValidConversationId,
  type SessionCreationResult,
} from "./session-manager";
