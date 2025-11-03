import type { Collection } from "mongodb";
import type { BasicUIMessage } from "./messages";
import { getDatabase } from "../../../lib/mongodb";

interface ConversationDocument {
  _id: string;
  messages: BasicUIMessage[];
  createdAt: Date;
  updatedAt: Date;
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
  const document: ConversationDocument = {
    _id: conversationId,
    messages,
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
