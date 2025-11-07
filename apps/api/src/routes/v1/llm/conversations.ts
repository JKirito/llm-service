import type { ApiResponse } from "@llm-service/types";
import type { RouteHandler } from "../../types";
import { createLogger } from "@llm-service/logger";
import {
  findConversation,
  listConversations,
  deleteConversation,
} from "./conversation-store";
import { listInteractionsByConversation } from "./persistence/interaction-store";

const logger = createLogger("CONVERSATIONS");

/**
 * GET /v1/llm/conversations
 * List all conversations with optional pagination
 */
export const listConversationsHandler: RouteHandler = async (req) => {
  try {
    const url = new URL(req.url);
    const limitParam = url.searchParams.get("limit");
    const skipParam = url.searchParams.get("skip");

    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const skip = skipParam ? Number.parseInt(skipParam, 10) : undefined;

    if (
      limit !== undefined &&
      (Number.isNaN(limit) || limit < 1 || limit > 1000)
    ) {
      const response: ApiResponse = {
        success: false,
        error: "Limit must be a number between 1 and 1000",
      };
      return Response.json(response, { status: 400 });
    }

    if (skip !== undefined && (Number.isNaN(skip) || skip < 0)) {
      const response: ApiResponse = {
        success: false,
        error: "Skip must be a non-negative number",
      };
      return Response.json(response, { status: 400 });
    }

    const { conversations, total } = await listConversations(limit, skip);

    const response: ApiResponse<{
      conversations: Array<{
        conversationId: string;
        messageCount: number;
        label?: string;
        createdAt: string;
        updatedAt: string;
      }>;
      total: number;
      limit?: number;
      skip?: number;
    }> = {
      success: true,
      data: {
        conversations: conversations.map((conv) => ({
          conversationId: conv._id,
          messageCount: conv.messages.length,
          ...(conv.label ? { label: conv.label } : {}),
          createdAt: conv.createdAt.toISOString(),
          updatedAt: conv.updatedAt.toISOString(),
        })),
        total,
        ...(limit !== undefined ? { limit } : {}),
        ...(skip !== undefined ? { skip } : {}),
      },
      message: "Conversations retrieved successfully",
    };

    return Response.json(response);
  } catch (error) {
    logger.error("Failed to list conversations", error);
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to list conversations: ${error.message}`
          : "Failed to list conversations",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * GET /v1/llm/conversations/:conversationId
 * Fetch a conversation by ID
 */
export const getConversationHandler: RouteHandler = async (_req, params) => {
  try {
    const conversationId = params?.conversationId;

    if (!conversationId || typeof conversationId !== "string") {
      const response: ApiResponse = {
        success: false,
        error: "Conversation ID is required",
      };
      return Response.json(response, { status: 400 });
    }

    const conversation = await findConversation(conversationId);

    if (!conversation) {
      const response: ApiResponse = {
        success: false,
        error: `Conversation ${conversationId} not found`,
      };
      return Response.json(response, { status: 404 });
    }

    const response: ApiResponse<{
      conversationId: string;
      messages: typeof conversation.messages;
      label?: string;
      createdAt: string;
      updatedAt: string;
    }> = {
      success: true,
      data: {
        conversationId: conversation._id,
        messages: conversation.messages,
        ...(conversation.label ? { label: conversation.label } : {}),
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      message: "Conversation retrieved successfully",
    };

    return Response.json(response);
  } catch (error) {
    logger.error("Failed to retrieve conversation", error);
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to retrieve conversation: ${error.message}`
          : "Failed to retrieve conversation",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * DELETE /v1/llm/conversations/:conversationId
 * Delete a conversation by ID
 */
export const deleteConversationHandler: RouteHandler = async (_req, params) => {
  try {
    const conversationId = params?.conversationId;

    if (!conversationId || typeof conversationId !== "string") {
      const response: ApiResponse = {
        success: false,
        error: "Conversation ID is required",
      };
      return Response.json(response, { status: 400 });
    }

    const deleted = await deleteConversation(conversationId);

    if (!deleted) {
      const response: ApiResponse = {
        success: false,
        error: `Conversation ${conversationId} not found`,
      };
      return Response.json(response, { status: 404 });
    }

    const response: ApiResponse<{
      conversationId: string;
    }> = {
      success: true,
      data: {
        conversationId,
      },
      message: "Conversation deleted successfully",
    };

    return Response.json(response);
  } catch (error) {
    logger.error("Failed to delete conversation", error);
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to delete conversation: ${error.message}`
          : "Failed to delete conversation",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * GET /v1/llm/conversations/:conversationId/interactions
 * Fetch all interactions for a conversation
 */
export const getConversationInteractions: RouteHandler = async (
  _req,
  params,
) => {
  try {
    const conversationId = params?.conversationId;

    if (!conversationId || typeof conversationId !== "string") {
      const response: ApiResponse = {
        success: false,
        error: "Conversation ID is required",
      };
      return Response.json(response, { status: 400 });
    }

    const interactions = await listInteractionsByConversation(conversationId);

    const response: ApiResponse<{
      conversationId: string;
      interactions: typeof interactions;
      count: number;
    }> = {
      success: true,
      data: {
        conversationId,
        interactions,
        count: interactions.length,
      },
      message: "Interactions retrieved successfully",
    };

    return Response.json(response);
  } catch (error) {
    logger.error("Failed to fetch conversation interactions", error);
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to fetch interactions: ${error.message}`
          : "Failed to fetch interactions",
    };
    return Response.json(response, { status: 500 });
  }
};
