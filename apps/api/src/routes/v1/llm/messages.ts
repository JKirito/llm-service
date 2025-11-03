import type { ApiResponse } from "@llm-service/types";
import type { MessageFileReference, ImageReference, MessageSource } from "./types";

const SUPPORTED_ROLES = ["system", "user", "assistant"] as const;

export type SupportedRole = (typeof SUPPORTED_ROLES)[number];

export type TextUIPart = {
  type: "text";
  text: string;
};

export interface MessageMetadata {
  model?: string;
  usage?: Record<string, unknown>;
  fileReferences?: MessageFileReference[];
  imageReferences?: ImageReference[];
  sources?: MessageSource[];
}

export type BasicUIMessage = {
  id: string;
  role: SupportedRole;
  parts: TextUIPart[];
  metadata?: MessageMetadata;
};

function isSupportedRole(value: unknown): value is SupportedRole {
  return SUPPORTED_ROLES.includes(value as SupportedRole);
}

function generateMessageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toTextParts(value: unknown): TextUIPart[] | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? [{ type: "text", text }] : null;
  }

  if (Array.isArray(value)) {
    const parts: TextUIPart[] = [];

    for (const item of value) {
      if (typeof item === "string") {
        const text = item.trim();
        if (!text) {
          continue;
        }
        parts.push({ type: "text", text });
        continue;
      }

      if (typeof item === "object" && item !== null) {
        const type = (item as { type?: unknown }).type;
        const text = (item as { text?: unknown }).text;

        if (
          (type === "text" || type === undefined) &&
          typeof text === "string" &&
          text.trim() !== ""
        ) {
          parts.push({ type: "text", text: text.trim() });
          continue;
        }
      }

      return null;
    }

    return parts.length > 0 ? parts : null;
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createTextMessage(
  role: SupportedRole,
  text: string,
  metadata?: MessageMetadata,
  fileReferences?: MessageFileReference[],
  imageReferences?: ImageReference[],
  sources?: MessageSource[],
): BasicUIMessage {
  const finalMetadata: MessageMetadata = {
    ...metadata,
    ...(fileReferences && fileReferences.length > 0
      ? { fileReferences }
      : {}),
    ...(imageReferences && imageReferences.length > 0
      ? { imageReferences }
      : {}),
    ...(sources && sources.length > 0
      ? { sources }
      : {}),
  };

  return {
    id: generateMessageId(),
    role,
    parts: [{ type: "text", text }],
    ...(Object.keys(finalMetadata).length > 0 ? { metadata: finalMetadata } : {}),
  };
}

function normalizeMessage(raw: unknown): BasicUIMessage | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  const roleValue = record.role;

  if (!isSupportedRole(roleValue)) {
    return null;
  }

  const parts =
    toTextParts(record.parts) ??
    toTextParts(record.content) ??
    toTextParts(record.text);

  if (!parts || parts.length === 0) {
    return null;
  }

  const rawId = record.id;
  const id =
    typeof rawId === "string" && rawId.trim() !== ""
      ? rawId.trim()
      : generateMessageId();

  const metadataValue = record.metadata;
  const metadata =
    isPlainObject(metadataValue) && Object.keys(metadataValue).length > 0
      ? (metadataValue as MessageMetadata)
      : undefined;

  return {
    id,
    role: roleValue,
    parts,
    ...(metadata ? { metadata } : {}),
  };
}

export function buildMessagesFromBody(body: Record<string, unknown>):
  | { success: true; messages: BasicUIMessage[] }
  | {
      success: false;
      response: ApiResponse;
    } {
  const messages: BasicUIMessage[] = [];

  if (typeof body.system === "string" && body.system.trim() !== "") {
    messages.push(createTextMessage("system", body.system.trim()));
  }

  if (Array.isArray(body.messages)) {
    for (let index = 0; index < body.messages.length; index += 1) {
      const normalized = normalizeMessage(body.messages[index]);
      if (!normalized) {
        return {
          success: false,
          response: {
            success: false,
            error: `Invalid message at index ${index}. Ensure messages include role, id (optional), and text content.`,
          },
        };
      }
      messages.push(normalized);
    }
  }

  if (typeof body.prompt === "string" && body.prompt.trim() !== "") {
    messages.push(createTextMessage("user", body.prompt.trim()));
  }

  return { success: true, messages };
}

export function containsUserMessage(messages: BasicUIMessage[]): boolean {
  return messages.some((message) => message.role === "user");
}
