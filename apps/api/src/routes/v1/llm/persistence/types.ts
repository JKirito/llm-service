import type { BasicUIMessage } from "../messages";
import type { MessageSource, ImageReference } from "../types";

export interface InteractionData {
  conversationId?: string;
  messageId: string;
  model: string;
  requestMessages: BasicUIMessage[];
  responseMessage: BasicUIMessage;
  usage?: Record<string, unknown>;
  sources?: MessageSource[];
  imageReferences?: ImageReference[];
  documentReferences?: string[];
  wasStreamed: boolean;
  duration?: number;
}

export interface InteractionDocument extends InteractionData {
  _id: string;
  createdAt: Date;
  completedAt: Date;
}
