import Redis, { type RedisOptions } from "ioredis";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("REDIS");

export interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  db?: number;
  retryStrategy?: (times: number) => number | null;
  maxRetriesPerRequest?: number;
  enableReadyCheck?: boolean;
  lazyConnect?: boolean;
}

let redisClient: Redis | null = null;

/**
 * Initialize Redis client with configuration
 */
export function initializeRedis(config: RedisConfig): Redis {
  if (redisClient) {
    logger.warn("Redis client already initialized. Returning existing client.");
    return redisClient;
  }

  const redisOptions: RedisOptions = {
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db ?? 0,
    retryStrategy:
      config.retryStrategy ??
      ((times: number) => {
        const delay = Math.min(times * 50, 2000);
        logger.warn(
          `Redis connection retry attempt ${times}, waiting ${delay}ms`,
        );
        return delay;
      }),
    maxRetriesPerRequest: config.maxRetriesPerRequest ?? 3,
    enableReadyCheck: config.enableReadyCheck ?? true,
    lazyConnect: config.lazyConnect ?? false,
  };

  redisClient = new Redis(redisOptions);

  redisClient.on("connect", () => {
    logger.info("Redis client connecting...");
  });

  redisClient.on("ready", () => {
    logger.info(`Redis client connected to ${config.host}:${config.port}`);
  });

  redisClient.on("error", (error: Error) => {
    logger.error("Redis client error:", error);
  });

  redisClient.on("close", () => {
    logger.warn("Redis client connection closed");
  });

  redisClient.on("reconnecting", () => {
    logger.info("Redis client reconnecting...");
  });

  return redisClient;
}

/**
 * Get the Redis client instance
 * @throws Error if Redis client is not initialized
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    throw new Error(
      "Redis client not initialized. Call initializeRedis() first.",
    );
  }
  return redisClient;
}

/**
 * Close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info("Redis client closed");
  }
}

/**
 * Check if Redis client is connected
 */
export function isRedisConnected(): boolean {
  return redisClient?.status === "ready";
}
