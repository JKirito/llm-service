import { getRedisClient } from "@llm-service/redis";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number; // Unix timestamp in milliseconds
  limit: number;
}

/**
 * Check rate limit using sliding window algorithm
 * Uses Redis sorted sets (ZSET) to track requests
 *
 * @param endpoint - Endpoint identifier (e.g., "files/upload")
 * @param ip - IP address of the client
 * @param limit - Maximum number of requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns Rate limit result with allowed status and metadata
 */
export async function checkRateLimit(
  endpoint: string,
  ip: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowStart = now - windowMs;

  // Create Redis key for this endpoint and IP combination
  const key = `rate_limit:${endpoint}:${ip}`;

  // Use Redis pipeline for atomic operations
  const pipeline = redis.pipeline();

  // Remove entries older than the window
  pipeline.zremrangebyscore(key, 0, windowStart);

  // Count remaining entries in the window
  pipeline.zcard(key);

  // Get the oldest entry timestamp (if any) to calculate reset time
  pipeline.zrange(key, 0, 0, "WITHSCORES");

  // Execute pipeline
  const results = await pipeline.exec();

  if (!results || results.length < 3) {
    throw new Error("Failed to execute Redis pipeline for rate limiting");
  }

  // Extract results
  const currentCount = results[1][1] as number;
  const oldestEntry = results[2][1] as Array<string> | null;

  // Calculate reset time (oldest entry timestamp + window)
  let resetTime: number;
  if (oldestEntry && oldestEntry.length > 0) {
    const oldestTimestamp = Number.parseInt(oldestEntry[1] || "0", 10);
    resetTime = oldestTimestamp + windowMs;
  } else {
    resetTime = now + windowMs;
  }

  // Check if limit exceeded
  const allowed = currentCount < limit;

  if (allowed) {
    // Add current request to the sorted set
    // Use timestamp as score and a unique request ID as value
    const requestId = `${now}-${Math.random().toString(36).substring(7)}`;
    await redis.zadd(key, now, requestId);

    // Set expiration on the key to clean up old entries
    // Add some buffer time (1 hour) to ensure cleanup
    await redis.pexpire(key, windowMs + 3600000);

    return {
      allowed: true,
      remaining: limit - currentCount - 1,
      resetTime,
      limit,
    };
  }

  return {
    allowed: false,
    remaining: 0,
    resetTime,
    limit,
  };
}

/**
 * Get rate limit status without consuming a request
 * Useful for checking remaining requests before making a request
 *
 * @param endpoint - Endpoint identifier
 * @param ip - IP address of the client
 * @param limit - Maximum number of requests allowed
 * @param windowMs - Time window in milliseconds
 * @returns Rate limit result with current status
 */
export async function getRateLimitStatus(
  endpoint: string,
  ip: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const redis = getRedisClient();
  const now = Date.now();
  const windowStart = now - windowMs;

  const key = `rate_limit:${endpoint}:${ip}`;

  // Remove old entries and count remaining
  const pipeline = redis.pipeline();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zcard(key);
  pipeline.zrange(key, 0, 0, "WITHSCORES");

  const results = await pipeline.exec();

  if (results && results.length >= 3) {
    const currentCount = (results[1][1] as number) || 0;
    const oldestEntry = results[2][1] as Array<string> | null;

    let resetTime: number;
    if (oldestEntry && oldestEntry.length > 0) {
      const oldestTimestamp = Number.parseInt(oldestEntry[1] || "0", 10);
      resetTime = oldestTimestamp + windowMs;
    } else {
      resetTime = now + windowMs;
    }

    return {
      allowed: currentCount < limit,
      remaining: Math.max(0, limit - currentCount),
      resetTime,
      limit,
    };
  }

  // Fallback if pipeline fails or doesn't have enough results
  return {
    allowed: true,
    remaining: limit,
    resetTime: now + windowMs,
    limit,
  };
}

