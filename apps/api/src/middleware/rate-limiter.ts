import { checkRateLimit, getRateLimitStatus } from "@llm-service/rate-limiter";
import { createLogger } from "@llm-service/logger";
import type { ApiResponse } from "@llm-service/types";

const logger = createLogger("RATE_LIMITER");

export interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

/**
 * Rate limit configuration per endpoint pattern
 * Key is the endpoint path (without /api prefix)
 */
const RATE_LIMIT_CONFIG: Record<string, RateLimitConfig> = {
  // High priority - expensive operations
  "/v1/files/upload": {
    limit: 20,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  "/v1/llm/answers": {
    limit: 60,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  "/v1/llm/images": {
    limit: 10,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Medium priority - moderate operations
  "/v1/files/download": {
    limit: 200,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  "/v1/files/signed-url": {
    limit: 100,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  "/v1/files": {
    limit: 50, // DELETE operations
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  // Low priority - lightweight operations
  "/v1/llm/tools": {
    limit: 300,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
  "/v1/users": {
    limit: 300,
    windowMs: 60 * 60 * 1000, // 1 hour
  },
};

/**
 * Exempt endpoints (no rate limiting)
 */
const EXEMPT_ENDPOINTS = ["/api", "/api/health"];

/**
 * Extract IP address from request
 * Checks X-Forwarded-For (from Nginx), X-Real-IP, then uses fallback
 */
function extractIPAddress(req: Request): string {
  // Check X-Forwarded-For header (from Nginx proxy)
  const forwardedFor = req.headers.get("X-Forwarded-For");
  if (forwardedFor && forwardedFor.trim() !== "") {
    // X-Forwarded-For can contain multiple IPs, take the first one
    const firstIP = forwardedFor.split(",")[0]?.trim();
    if (firstIP && firstIP !== "null") {
      return firstIP;
    }
  }

  // Check X-Real-IP header (alternative proxy header)
  const realIP = req.headers.get("X-Real-IP");
  if (realIP && realIP.trim() !== "" && realIP !== "null") {
    return realIP.trim();
  }

  // Try to get from CF-Connecting-IP (Cloudflare) or other headers
  const cfIP = req.headers.get("CF-Connecting-IP");
  if (cfIP && cfIP.trim() !== "" && cfIP !== "null") {
    return cfIP.trim();
  }

  // Fallback: use a default identifier for rate limiting
  // This allows rate limiting to work even when IP can't be determined
  // Using a shared identifier means all "unknown" IPs share the same limit
  return "unknown-client";
}

/**
 * Normalize endpoint path for rate limit lookup
 * Removes /api prefix and query parameters
 */
function normalizeEndpointPath(pathname: string): string {
  // Remove /api prefix if present
  let normalized = pathname.startsWith("/api") ? pathname.slice(4) : pathname;

  // Remove trailing slashes
  normalized = normalized.replace(/\/$/, "") || "/";

  // For dynamic routes like /v1/files/download/:containerName/:fileName
  // normalize to /v1/files/download
  if (normalized.startsWith("/v1/files/download/")) {
    return "/v1/files/download";
  }

  // For DELETE /v1/files/:containerName/:fileName
  // normalize to /v1/files
  if (normalized.startsWith("/v1/files/") && normalized !== "/v1/files/upload" && normalized !== "/v1/files/signed-url") {
    return "/v1/files";
  }

  return normalized;
}

/**
 * Find rate limit configuration for endpoint
 */
function findRateLimitConfig(pathname: string): RateLimitConfig | null {
  const normalized = normalizeEndpointPath(pathname);

  // Check exact match first
  if (RATE_LIMIT_CONFIG[normalized]) {
    return RATE_LIMIT_CONFIG[normalized];
  }

  // Check if endpoint is exempt
  if (EXEMPT_ENDPOINTS.includes(pathname)) {
    return null;
  }

  // Return null if no configuration found (no rate limiting)
  return null;
}

/**
 * Rate limiter middleware result
 */
export interface RateLimiterResult {
  rateLimited: boolean;
  response?: Response; // Present if rate limited
  headers: Record<string, string>; // Rate limit headers for all requests
}

/**
 * Rate limiter middleware
 * Checks rate limit before allowing request to proceed
 * Returns rate limit headers for successful requests
 */
export async function rateLimiterMiddleware(
  req: Request,
  pathname: string,
): Promise<RateLimiterResult> {
  // Find rate limit configuration
  const config = findRateLimitConfig(pathname);
  if (!config) {
    // No rate limiting for this endpoint
    logger.debug(`No rate limit config found for pathname: ${pathname}`);
    return {
      rateLimited: false,
      headers: {},
    };
  }

  // Extract IP address
  const ip = extractIPAddress(req);
  logger.debug(`Rate limit check for ${pathname}: IP=${ip}, Config found: limit=${config.limit}`);
  
  // Note: We allow rate limiting even with "unknown-client" IP
  // This ensures rate limiting works even when IP headers aren't available
  // All requests with unknown IPs will share the same limit pool

  // Normalize endpoint for Redis key
  const endpoint = normalizeEndpointPath(pathname);
  logger.debug(`Normalized endpoint: ${endpoint} from pathname: ${pathname}`);

  try {
    // Check rate limit
    const result = await checkRateLimit(
      endpoint,
      ip,
      config.limit,
      config.windowMs,
    );

    // Prepare headers (will be used for both allowed and rate limited requests)
    const resetTimeSeconds = Math.ceil(result.resetTime / 1000);
    const headers: Record<string, string> = {
      "X-RateLimit-Limit": result.limit.toString(),
      "X-RateLimit-Remaining": result.remaining.toString(),
      "X-RateLimit-Reset": resetTimeSeconds.toString(),
    };

    logger.debug(
      `Rate limit result for ${endpoint} (IP: ${ip}): allowed=${result.allowed}, remaining=${result.remaining}, limit=${result.limit}`,
    );

    if (!result.allowed) {
      // Rate limit exceeded
      const retryAfter = Math.max(
        1,
        Math.ceil((result.resetTime - Date.now()) / 1000),
      );

      logger.warn(`Rate limit exceeded for ${endpoint} from IP ${ip}`);

      const response: ApiResponse = {
        success: false,
        error: "Rate limit exceeded. Please try again later.",
      };

      return {
        rateLimited: true,
        response: Response.json(response, {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": retryAfter.toString(),
            "Content-Type": "application/json",
          },
        }),
        headers,
      };
    }

    // Rate limit passed, request can proceed
    // Return headers to be added to the response
    logger.debug(`Rate limit passed for ${endpoint}, returning headers: ${JSON.stringify(headers)}`);
    return {
      rateLimited: false,
      headers,
    };
  } catch (error) {
    // If rate limiting fails, log error but allow request
    // This prevents rate limiting from being a single point of failure
    logger.error(`Rate limit check failed for ${pathname}:`, error);
    return {
      rateLimited: false,
      headers: {},
    };
  }
}

/**
 * Get rate limit headers for successful requests
 * This can be called by route handlers to include rate limit info in responses
 */
export async function getRateLimitHeaders(
  req: Request,
  pathname: string,
): Promise<Record<string, string>> {
  const config = findRateLimitConfig(pathname);
  if (!config) {
    return {};
  }

  const ip = extractIPAddress(req);
  if (ip === "unknown-client") {
    // Log warning but still allow rate limiting with shared identifier
    logger.warn(
      `Could not extract IP address from request (pathname: ${pathname}). Using shared identifier. Headers: X-Forwarded-For=${req.headers.get("X-Forwarded-For")}, X-Real-IP=${req.headers.get("X-Real-IP")}`,
    );
  }

  const endpoint = normalizeEndpointPath(pathname);

  try {
    // Use getRateLimitStatus to check status without consuming a request
    const result = await getRateLimitStatus(
      endpoint,
      ip,
      config.limit,
      config.windowMs,
    );

    const resetTimeSeconds = Math.ceil(result.resetTime / 1000);

    return {
      "X-RateLimit-Limit": result.limit.toString(),
      "X-RateLimit-Remaining": result.remaining.toString(),
      "X-RateLimit-Reset": resetTimeSeconds.toString(),
    };
  } catch (error) {
    logger.error("Failed to get rate limit headers:", error);
    return {};
  }
}

