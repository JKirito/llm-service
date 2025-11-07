import { generateText } from "ai";
import type { CoreMessage, LanguageModel, Tool } from "ai";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("TEXT_GENERATOR");

export interface GenerationConfig {
  messageId: string;
  conversationId?: string;
  model: LanguageModel;
  messages: CoreMessage[];
  tools: Record<string, Tool>;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}

export interface GenerateTextResult {
  text: string;
  usage?: Record<string, unknown>;
  sources?: Array<{ url: string; title?: string }>;
  imageReferences?: Array<unknown>;
}

/**
 * Handle non-streaming text generation
 * Uses AI SDK generateText()
 */
export async function generateTextResponse(
  config: GenerationConfig,
): Promise<GenerateTextResult> {
  const { model, messages, tools, temperature, reasoningEffort } = config;

  logger.info("Generating text response", {
    messageId: config.messageId,
    conversationId: config.conversationId,
    messageCount: messages.length,
    toolCount: Object.keys(tools).length,
  });

  // Call AI SDK generateText
  const result = await generateText({
    model,
    messages,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    temperature,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  });

  // Extract response
  return {
    text: result.text,
    usage: result.usage,
    // TODO: Extract sources and images from tool calls when implementing
  };
}
