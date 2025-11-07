import type { Collection, Db } from "mongodb";
import { createLogger } from "@llm-service/logger";
import { getDatabase } from "../../../../lib/mongodb";
import type { InteractionData, InteractionDocument } from "./types";

const logger = createLogger("INTERACTION_STORE");

const COLLECTION_NAME = "interactions";

/**
 * Get the interactions collection from MongoDB
 */
export async function getInteractionsCollection(): Promise<
  Collection<InteractionDocument>
> {
  try {
    const db: Db = await getDatabase();
    return db.collection<InteractionDocument>(COLLECTION_NAME);
  } catch (error) {
    logger.error("Failed to get interactions collection", { error });
    throw new Error(
      `Failed to get interactions collection: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Create and save an interaction to the database
 * Returns the MongoDB _id of the inserted document
 */
export async function createInteraction(
  data: InteractionData,
): Promise<string> {
  try {
    const collection = await getInteractionsCollection();

    const now = new Date();
    const document: Omit<InteractionDocument, "_id"> = {
      ...data,
      duration: data.duration || 0,
      createdAt: now,
      completedAt: now,
    };

    const result = await collection.insertOne(document as InteractionDocument);

    logger.info("Interaction created", {
      messageId: data.messageId,
      conversationId: data.conversationId,
      model: data.model,
      insertedId: result.insertedId.toString(),
    });

    return result.insertedId.toString();
  } catch (error) {
    logger.error("Failed to create interaction", {
      error,
      messageId: data.messageId,
      conversationId: data.conversationId,
    });
    throw new Error(
      `Failed to create interaction ${data.messageId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * List all interactions for a conversation, sorted by creation time
 */
export async function listInteractionsByConversation(
  conversationId: string,
): Promise<InteractionDocument[]> {
  try {
    const collection = await getInteractionsCollection();

    const interactions = await collection
      .find({ conversationId })
      .sort({ createdAt: 1 })
      .toArray();

    logger.debug("Retrieved interactions for conversation", {
      conversationId,
      count: interactions.length,
    });

    return interactions;
  } catch (error) {
    logger.error("Failed to list interactions by conversation", {
      error,
      conversationId,
    });
    throw new Error(
      `Failed to list interactions for conversation ${conversationId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Find a specific interaction by message ID
 */
export async function findInteractionByMessageId(
  messageId: string,
): Promise<InteractionDocument | null> {
  try {
    const collection = await getInteractionsCollection();

    const interaction = await collection.findOne({ messageId });

    if (interaction) {
      logger.debug("Retrieved interaction by message ID", {
        messageId,
        conversationId: interaction.conversationId,
      });
    } else {
      logger.warn("Interaction not found", { messageId });
    }

    return interaction;
  } catch (error) {
    logger.error("Failed to find interaction by message ID", {
      error,
      messageId,
    });
    throw new Error(
      `Failed to find interaction by messageId ${messageId}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}

/**
 * Create database indexes for the interactions collection
 * Should be called during application startup
 */
export async function createIndexes(): Promise<void> {
  try {
    const collection = await getInteractionsCollection();

    // Compound index for efficient conversation-based queries
    await collection.createIndex(
      { conversationId: 1, createdAt: 1 },
      { name: "conversationId_createdAt" },
    );

    // Unique index on messageId to prevent duplicate interactions
    await collection.createIndex(
      { messageId: 1 },
      { unique: true, name: "messageId_unique" },
    );

    // Index for time-based queries (recent interactions)
    await collection.createIndex({ createdAt: -1 }, { name: "createdAt_desc" });

    logger.info("Interactions collection indexes created successfully");
  } catch (error) {
    logger.error("Failed to create interactions indexes", { error });
    throw new Error(
      `Failed to create interactions indexes: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
}
