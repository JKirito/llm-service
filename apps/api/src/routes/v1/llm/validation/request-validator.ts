import { config } from "../../../../config";
import type { ValidatedRequest, ModelParams } from "./types";
import { RequestValidationError } from "./types";

export function validateRequestBody(body: unknown): ValidatedRequest {
  if (!body || typeof body !== "object") {
    throw new RequestValidationError(
      "Request body must be an object",
      "body",
      "INVALID_BODY"
    );
  }

  const record = body as Record<string, unknown>;

  // Validate messages (required)
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new RequestValidationError(
      "messages array is required and must not be empty",
      "messages",
      "MISSING_MESSAGES"
    );
  }

  // Validate model
  const model =
    typeof record.model === "string" && record.model.trim()
      ? record.model.trim()
      : config.openai.defaultModel;

  // Validate modelParams
  const modelParams = parseModelParams(record.modelParams);

  // Validate conversationId format if provided
  const conversationId = record.conversationId;
  if (conversationId !== undefined) {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new RequestValidationError(
        "conversationId must be a non-empty string",
        "conversationId",
        "INVALID_CONVERSATION_ID"
      );
    }
  }

  // Validate documentReferences
  const documentReferences = Array.isArray(record.documentReferences)
    ? record.documentReferences.filter(
        (ref): ref is string =>
          typeof ref === "string" && ref.trim() !== ""
      )
    : [];

  // Stream flag
  const stream =
    typeof record.stream === "boolean"
      ? record.stream
      : typeof record.stream === "string"
        ? record.stream.toLowerCase() === "true"
        : false;

  return {
    messages: record.messages,
    conversationId: typeof conversationId === "string" ? conversationId.trim() : undefined,
    model,
    modelParams,
    documentReferences,
    stream,
  };
}

export function parseModelParams(params: unknown): ModelParams {
  if (!params || typeof params !== "object") {
    return { tools: [] };
  }

  const p = params as Record<string, unknown>;

  // Extract tools
  const tools = Array.isArray(p.tools)
    ? p.tools.filter(
        (t): t is string => typeof t === "string" && t.trim() !== ""
      )
    : [];

  // Extract reasoningEffort
  const validReasoningEfforts = ["low", "medium", "high"];
  const reasoningEffort =
    typeof p.reasoningEffort === "string" &&
    validReasoningEfforts.includes(p.reasoningEffort)
      ? (p.reasoningEffort as "low" | "medium" | "high")
      : undefined;

  // Extract temperature
  const temperature =
    typeof p.temperature === "number" &&
    !Number.isNaN(p.temperature) &&
    p.temperature >= 0 &&
    p.temperature <= 2
      ? p.temperature
      : undefined;

  // Extract includeSearch (legacy support)
  const includeSearch =
    typeof p.includeSearch === "boolean" ? p.includeSearch : undefined;

  return {
    tools,
    reasoningEffort,
    temperature,
    includeSearch,
  };
}

export async function validateTools(
  tools: string[],
  toolRegistry: { listAllTools: () => Array<{ name: string }> }
): Promise<string[]> {
  const allTools = toolRegistry.listAllTools();
  const validToolNames = new Set(allTools.map((t) => t.name));

  return tools.filter((name) => !validToolNames.has(name));
}
