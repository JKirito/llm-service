export interface ValidatedRequest {
  messages: unknown[];
  conversationId?: string;
  model: string;
  modelParams: ModelParams;
  documentReferences: string[];
  stream: boolean;
}

export interface ModelParams {
  tools: string[];
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  includeSearch?: boolean;
}

export class RequestValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}
