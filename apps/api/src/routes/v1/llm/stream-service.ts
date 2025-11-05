import { getRedisClient } from "@llm-service/redis";
import { createLogger } from "@llm-service/logger";
import type { MessageSource } from "./types";

const logger = createLogger("STREAM_SERVICE");

/**
 * Stream status for conversation streaming
 */
export type StreamStatus = "streaming" | "completed" | "error" | "cancelled";

/**
 * Stream metadata stored in Redis
 */
export interface StreamMetadata {
  conversationId: string;
  status: StreamStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  model?: string;
  totalChunks?: number;
}

/**
 * Stream entry data structure
 */
export interface StreamEntry {
  type: "chunk" | "metadata" | "sources" | "complete" | "error";
  conversationId: string;
  timestamp: string;
  data?: string;
  metadata?: Record<string, unknown>;
  sources?: MessageSource[];
  error?: string;
}

/**
 * Redis Stream keys
 */
function getStreamKey(conversationId: string): string {
  return `llm:stream:${conversationId}`;
}

function getMetadataKey(conversationId: string): string {
  return `llm:stream:meta:${conversationId}`;
}

function getCancellationKey(conversationId: string): string {
  return `llm:stream:cancel:${conversationId}`;
}

/**
 * Initialize a new stream for a conversation
 */
export async function initializeStream(
  conversationId: string,
  model: string,
): Promise<void> {
  const redis = getRedisClient();
  const metadataKey = getMetadataKey(conversationId);

  const metadata: StreamMetadata = {
    conversationId,
    status: "streaming",
    startedAt: new Date().toISOString(),
    model,
    totalChunks: 0,
  };

  await redis.setex(metadataKey, 3600, JSON.stringify(metadata)); // Expire in 1 hour
  logger.info(`Initialized stream for conversation ${conversationId}`);
}

/**
 * Write a text chunk to the stream
 */
export async function writeChunk(
  conversationId: string,
  chunk: string,
): Promise<void> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);

  const entry: StreamEntry = {
    type: "chunk",
    conversationId,
    timestamp: new Date().toISOString(),
    data: chunk,
  };

  await redis.xadd(
    streamKey,
    "MAXLEN",
    "~",
    "1000", // Keep last ~1000 entries
    "*",
    "entry",
    JSON.stringify(entry),
  );

  // Update chunk count
  const metadataKey = getMetadataKey(conversationId);
  const metadataStr = await redis.get(metadataKey);
  if (metadataStr) {
    const metadata: StreamMetadata = JSON.parse(metadataStr);
    metadata.totalChunks = (metadata.totalChunks || 0) + 1;
    await redis.setex(metadataKey, 3600, JSON.stringify(metadata));
  }
}

/**
 * Write metadata to the stream
 */
export async function writeMetadata(
  conversationId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);

  const entry: StreamEntry = {
    type: "metadata",
    conversationId,
    timestamp: new Date().toISOString(),
    metadata,
  };

  await redis.xadd(
    streamKey,
    "MAXLEN",
    "~",
    "1000",
    "*",
    "entry",
    JSON.stringify(entry),
  );
}

/**
 * Write sources to the stream
 */
export async function writeSources(
  conversationId: string,
  sources: MessageSource[],
): Promise<void> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);

  const entry: StreamEntry = {
    type: "sources",
    conversationId,
    timestamp: new Date().toISOString(),
    sources,
  };

  await redis.xadd(
    streamKey,
    "MAXLEN",
    "~",
    "1000",
    "*",
    "entry",
    JSON.stringify(entry),
  );
}

/**
 * Mark stream as completed
 */
export async function completeStream(conversationId: string): Promise<void> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);
  const metadataKey = getMetadataKey(conversationId);

  // Write completion entry to stream
  const entry: StreamEntry = {
    type: "complete",
    conversationId,
    timestamp: new Date().toISOString(),
  };

  await redis.xadd(
    streamKey,
    "MAXLEN",
    "~",
    "1000",
    "*",
    "entry",
    JSON.stringify(entry),
  );

  // Update metadata
  const metadataStr = await redis.get(metadataKey);
  if (metadataStr) {
    const metadata: StreamMetadata = JSON.parse(metadataStr);
    metadata.status = "completed";
    metadata.completedAt = new Date().toISOString();
    await redis.setex(metadataKey, 3600, JSON.stringify(metadata));
  }

  // Set stream expiration
  await redis.expire(streamKey, 3600); // Expire in 1 hour

  logger.info(`Completed stream for conversation ${conversationId}`);
}

/**
 * Mark stream as errored
 */
export async function errorStream(
  conversationId: string,
  error: string,
): Promise<void> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);
  const metadataKey = getMetadataKey(conversationId);

  // Write error entry to stream
  const entry: StreamEntry = {
    type: "error",
    conversationId,
    timestamp: new Date().toISOString(),
    error,
  };

  await redis.xadd(
    streamKey,
    "MAXLEN",
    "~",
    "1000",
    "*",
    "entry",
    JSON.stringify(entry),
  );

  // Update metadata
  const metadataStr = await redis.get(metadataKey);
  if (metadataStr) {
    const metadata: StreamMetadata = JSON.parse(metadataStr);
    metadata.status = "error";
    metadata.completedAt = new Date().toISOString();
    metadata.error = error;
    await redis.setex(metadataKey, 3600, JSON.stringify(metadata));
  }

  // Set stream expiration
  await redis.expire(streamKey, 3600);

  logger.error(`Error in stream for conversation ${conversationId}: ${error}`);
}

/**
 * Mark stream as cancelled
 */
export async function cancelStream(conversationId: string): Promise<void> {
  const redis = getRedisClient();
  const metadataKey = getMetadataKey(conversationId);
  const cancellationKey = getCancellationKey(conversationId);

  // Set cancellation flag
  await redis.setex(cancellationKey, 60, "1"); // Expire in 1 minute

  // Update metadata
  const metadataStr = await redis.get(metadataKey);
  if (metadataStr) {
    const metadata: StreamMetadata = JSON.parse(metadataStr);
    metadata.status = "cancelled";
    metadata.completedAt = new Date().toISOString();
    await redis.setex(metadataKey, 3600, JSON.stringify(metadata));
  }

  logger.info(`Cancelled stream for conversation ${conversationId}`);
}

/**
 * Check if stream is cancelled
 */
export async function isStreamCancelled(
  conversationId: string,
): Promise<boolean> {
  const redis = getRedisClient();
  const cancellationKey = getCancellationKey(conversationId);
  const result = await redis.get(cancellationKey);
  return result === "1";
}

/**
 * Get stream metadata
 */
export async function getStreamMetadata(
  conversationId: string,
): Promise<StreamMetadata | null> {
  const redis = getRedisClient();
  const metadataKey = getMetadataKey(conversationId);
  const metadataStr = await redis.get(metadataKey);

  if (!metadataStr) {
    return null;
  }

  return JSON.parse(metadataStr) as StreamMetadata;
}

/**
 * Read stream entries from a given position
 * @param conversationId - Conversation ID
 * @param fromId - Stream entry ID to start from (use '0' for beginning, or last known ID)
 * @param count - Number of entries to read
 */
export async function readStream(
  conversationId: string,
  fromId: string = "0",
  count: number = 100,
): Promise<Array<{ id: string; entry: StreamEntry }>> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);

  try {
    // XREAD returns: [[streamKey, [[id, [field, value, ...]]]]]
    const results = await redis.xread(
      "COUNT",
      count,
      "STREAMS",
      streamKey,
      fromId,
    );

    if (!results || results.length === 0) {
      return [];
    }

    const entries: Array<{ id: string; entry: StreamEntry }> = [];

    // Parse Redis stream response
    for (const [, streamEntries] of results) {
      if (Array.isArray(streamEntries)) {
        for (const [id, fields] of streamEntries) {
          // fields is an array like ['entry', '{"type":"chunk",...}']
          if (Array.isArray(fields) && fields.length >= 2) {
            const entryData = fields[1] as string;
            try {
              const entry = JSON.parse(entryData) as StreamEntry;
              entries.push({ id: id as string, entry });
            } catch (parseError) {
              logger.error(
                `Failed to parse stream entry ${id}: ${parseError}`,
              );
            }
          }
        }
      }
    }

    return entries;
  } catch (error) {
    logger.error(
      `Failed to read stream for conversation ${conversationId}:`,
      error,
    );
    throw error;
  }
}

/**
 * Get all stream entries (for replay)
 */
export async function getAllStreamEntries(
  conversationId: string,
): Promise<Array<{ id: string; entry: StreamEntry }>> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);

  try {
    // XRANGE to get all entries from beginning to end
    const results = await redis.xrange(streamKey, "-", "+");

    const entries: Array<{ id: string; entry: StreamEntry }> = [];

    for (const [id, fields] of results) {
      // fields is an array like ['entry', '{"type":"chunk",...}']
      if (Array.isArray(fields) && fields.length >= 2) {
        const entryData = fields[1] as string;
        try {
          const entry = JSON.parse(entryData) as StreamEntry;
          entries.push({ id: id as string, entry });
        } catch (parseError) {
          logger.error(`Failed to parse stream entry ${id}: ${parseError}`);
        }
      }
    }

    return entries;
  } catch (error) {
    logger.error(
      `Failed to get all stream entries for conversation ${conversationId}:`,
      error,
    );
    throw error;
  }
}

/**
 * Delete stream and metadata
 */
export async function deleteStream(conversationId: string): Promise<void> {
  const redis = getRedisClient();
  const streamKey = getStreamKey(conversationId);
  const metadataKey = getMetadataKey(conversationId);
  const cancellationKey = getCancellationKey(conversationId);

  await Promise.all([
    redis.del(streamKey),
    redis.del(metadataKey),
    redis.del(cancellationKey),
  ]);

  logger.info(`Deleted stream for conversation ${conversationId}`);
}
