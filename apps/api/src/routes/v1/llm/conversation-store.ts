import type { Collection } from "mongodb";
import type { BasicUIMessage } from "./messages";
import { getDatabase } from "../../../lib/mongodb";

interface ConversationDocument {
  _id: string;
  messages: BasicUIMessage[];
  label?: string;
  createdAt: Date;
  updatedAt: Date;
}

function extractFirstUserMessageLabel(
  messages: BasicUIMessage[],
): string | undefined {
  const firstUserMessage = messages.find((msg) => msg.role === "user");
  if (!firstUserMessage) {
    return undefined;
  }

  // Extract text from parts
  const textParts = firstUserMessage.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();

  return textParts || undefined;
}

async function getConversationCollection(): Promise<
  Collection<ConversationDocument>
> {
  const db = await getDatabase();
  return db.collection<ConversationDocument>("conversations");
}

export async function findConversation(
  conversationId: string,
): Promise<ConversationDocument | null> {
  const collection = await getConversationCollection();
  return await collection.findOne({ _id: conversationId });
}

export async function createConversation(
  messages: BasicUIMessage[],
): Promise<{ conversationId: string; messages: BasicUIMessage[] }> {
  const collection = await getConversationCollection();
  const conversationId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const now = new Date();
  const label = extractFirstUserMessageLabel(messages);
  const document: ConversationDocument = {
    _id: conversationId,
    messages,
    ...(label ? { label } : {}),
    createdAt: now,
    updatedAt: now,
  };

  await collection.insertOne(document);
  return { conversationId, messages };
}

export async function replaceConversationMessages(
  conversationId: string,
  messages: BasicUIMessage[],
): Promise<void> {
  const collection = await getConversationCollection();
  const result = await collection.updateOne(
    { _id: conversationId },
    {
      $set: {
        messages,
        updatedAt: new Date(),
      },
    },
  );

  if (result.matchedCount === 0) {
    throw new Error(`Conversation ${conversationId} not found`);
  }
}

export async function listConversations(
  limit?: number,
  skip?: number,
): Promise<{
  conversations: ConversationDocument[];
  total: number;
}> {
  const collection = await getConversationCollection();
  const total = await collection.countDocuments();

  const query = collection
    .find({})
    .sort({ updatedAt: -1 })
    .limit(limit ?? 100)
    .skip(skip ?? 0);

  const conversations = await query.toArray();

  return {
    conversations,
    total,
  };
}

export async function deleteConversation(
  conversationId: string,
): Promise<boolean> {
  const collection = await getConversationCollection();
  const result = await collection.deleteOne({ _id: conversationId });
  return result.deletedCount > 0;
}
