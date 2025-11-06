import type { Collection, Db } from "mongodb";
import { createLogger } from "@llm-service/logger";
import { getDatabase } from "../../../../lib/mongodb";
import type { InteractionData, InteractionDocument } from "./types";

const logger = createLogger("INTERACTIONS_COLLECTION");

const COLLECTION_NAME = "interactions";

/**
 * Get the interactions collection from MongoDB
 */
export async function getInteractionsCollection(): Promise<Collection<InteractionDocument>> {
  try {
    const db: Db = await getDatabase();
    return db.collection<InteractionDocument>(COLLECTION_NAME);
  } catch (error) {
    logger.error("Failed to get interactions collection", { error });
    throw new Error("Failed to get interactions collection");
  }
}

/**
 * Save an interaction to the database
 */
export async function saveInteraction(data: InteractionData): Promise<InteractionDocument> {
  try {
    const collection = await getInteractionsCollection();

    const now = new Date();
    const document: InteractionDocument = {
      _id: crypto.randomUUID(),
      ...data,
      createdAt: now,
      completedAt: now,
    };

    await collection.insertOne(document);

    logger.info("Interaction saved", {
      messageId: document.messageId,
      conversationId: document.conversationId,
      model: document.model,
    });

    return document;
  } catch (error) {
    logger.error("Failed to save interaction", {
      error,
      messageId: data.messageId,
      conversationId: data.conversationId,
    });
    throw new Error("Failed to save interaction");
  }
}

/**
 * Get all interactions for a conversation
 */
export async function getInteractionsByConversation(
  conversationId: string
): Promise<InteractionDocument[]> {
  try {
    const collection = await getInteractionsCollection();

    const interactions = await collection
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .toArray();

    logger.info("Retrieved interactions for conversation", {
      conversationId,
      count: interactions.length,
    });

    return interactions;
  } catch (error) {
    logger.error("Failed to get interactions by conversation", {
      error,
      conversationId,
    });
    throw new Error("Failed to get interactions by conversation");
  }
}

/**
 * Get a specific interaction by message ID
 */
export async function getInteractionByMessageId(
  messageId: string
): Promise<InteractionDocument | null> {
  try {
    const collection = await getInteractionsCollection();

    const interaction = await collection.findOne({ messageId });

    if (interaction) {
      logger.info("Retrieved interaction by message ID", {
        messageId,
        conversationId: interaction.conversationId,
      });
    } else {
      logger.warn("Interaction not found", { messageId });
    }

    return interaction;
  } catch (error) {
    logger.error("Failed to get interaction by message ID", {
      error,
      messageId,
    });
    throw new Error("Failed to get interaction by message ID");
  }
}
