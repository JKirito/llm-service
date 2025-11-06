import type { CoreMessage } from "ai";
import type { Tool } from "ai";

export interface StreamWriter {
  write(data: unknown): void;
  merge(stream: ReadableStream): void;
}

export interface StreamConfig {
  messageId: string;
  conversationId?: string;
  model: unknown;
  messages: CoreMessage[];
  tools: Record<string, Tool>;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
  request: Request;
}
