import type { UIMessage } from "ai";
import type { MessageSource } from "./types";

/**
 * Custom data parts for LLM streaming
 */
export type LLMUIMessage = UIMessage<
  // Metadata type (attached to entire message)
  {
    model?: string;
    totalTokens?: number;
    completionTokens?: number;
    promptTokens?: number;
    timestamp?: number;
    conversationId?: string;
    fileReferences?: Array<{
      path: string;
      filename: string;
    }>;
  },
  {
    // Custom data part schemas

    // Sources from tools (web_search, RAG, etc.)
    sources: {
      sources: MessageSource[];
      status: "loading" | "success";
    };

    // Processing status notifications (transient)
    notification: {
      message: string;
      level: "info" | "warning" | "error";
    };

    // Stream status (for frontend to track)
    streamStatus: {
      conversationId: string;
      status: "streaming" | "completed" | "error" | "cancelled";
      cached: boolean; // true if written to Redis
    };

    // Usage information
    usage: {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    };

    // Image generation results
    image: {
      urls: string[];
      prompt: string;
      provider: string;
      model?: string;
      size?: string;
    };

    // Tool status (for showing loading states)
    toolStatus: {
      name: string;
      status: "started" | "completed" | "error";
    };
  }
>;
