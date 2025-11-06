import type { CoreMessage } from "ai";
import type { Tool } from "ai";
import type { ImageReference } from "../types";

export interface StreamWriter {
  write(data: unknown): void;
  merge(stream: ReadableStream): void;
}

export interface CapturedStreamData {
  usage?: Record<string, unknown>;
  imageReferences: ImageReference[];
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
  textVerbosity?: "low" | "medium" | "high";
  needsResponsesAPI?: boolean;
  requestedTools?: string[];
  capturedData?: CapturedStreamData;
  onFinish?: (event: unknown) => Promise<void>;
}
