import { createLogger } from "@llm-service/logger";
import { routes } from "./routes";
import type { Route } from "./routes/types";
import { rateLimiterMiddleware } from "./middleware/rate-limiter";

const logger = createLogger("ROUTER");

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}

function matchRoute(
  requestPath: string,
  route: Route,
): { params: Record<string, string> } | null {
  const normalizedPath = normalizePath(requestPath);
  const normalizedRoutePath = normalizePath(route.path);

  if (normalizedRoutePath === "/") {
    return normalizedPath === "/" ? { params: {} } : null;
  }

  const pathSegments = normalizedPath.split("/").filter(Boolean);
  const routeSegments = normalizedRoutePath.split("/").filter(Boolean);

  if (pathSegments.length !== routeSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};

  for (let i = 0; i < routeSegments.length; i += 1) {
    const routeSegment = routeSegments[i];
    const pathSegment = pathSegments[i];

    if (routeSegment.startsWith(":")) {
      const paramName = routeSegment.slice(1);
      params[paramName] = decodeURIComponent(pathSegment);
    } else if (routeSegment !== pathSegment) {
      return null;
    }
  }

  return { params };
}

export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  logger.info(`${req.method} ${pathname}`);

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400", // 24 hours
  };

  // Handle preflight OPTIONS request
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // Check rate limit before processing request
  const rateLimitResult = await rateLimiterMiddleware(req, pathname);
  if (rateLimitResult.rateLimited && rateLimitResult.response) {
    // Add CORS headers to rate limit response
    const rateLimitHeaders = new Headers(rateLimitResult.response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      rateLimitHeaders.set(key, value);
    }
    return new Response(rateLimitResult.response.body, {
      status: rateLimitResult.response.status,
      headers: rateLimitHeaders,
    });
  }

  // Store rate limit headers to add to response
  const rateLimitHeaders = rateLimitResult.headers;

  // Log rate limit headers for debugging
  if (Object.keys(rateLimitHeaders).length > 0) {
    logger.debug(`Rate limit headers: ${JSON.stringify(rateLimitHeaders)}`);
  }

  let pathMatched = false;
  const allowedMethodsForPath: string[] = [];

  for (const route of routes) {
    const match = matchRoute(pathname, route);
    if (!match) {
      continue;
    }

    pathMatched = true;
    const allowedMethods =
      route.methods?.map((method) => method.toUpperCase()) ?? [];

    // Track all allowed methods for this path
    if (allowedMethods.length > 0) {
      allowedMethodsForPath.push(...allowedMethods);
    }

    // If route has methods specified and request method doesn't match, continue searching
    // This allows multiple routes with same path but different methods
    if (
      allowedMethods.length > 0 &&
      !allowedMethods.includes(req.method.toUpperCase())
    ) {
      continue;
    }

    // Execute route handler
    const response = await route.handler(req, match.params);

    // Clone response and add rate limit headers + CORS headers
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(rateLimitHeaders)) {
      newHeaders.set(key, value);
    }
    // Add CORS headers to response
    for (const [key, value] of Object.entries(corsHeaders)) {
      newHeaders.set(key, value);
    }

    // For streaming responses, add CORS headers and return new response
    // Check if it's a streaming response by content-type
    const contentType = response.headers.get("content-type");
    const isStreaming =
      contentType?.includes("text/event-stream") ||
      contentType?.includes("stream");

    if (isStreaming) {
      // Create new headers with CORS for streaming responses
      const streamingHeaders = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders)) {
        streamingHeaders.set(key, value);
      }
      for (const [key, value] of Object.entries(rateLimitHeaders)) {
        streamingHeaders.set(key, value);
      }
      // Return new response with streaming body and updated headers
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: streamingHeaders,
      });
    }

    // Clone response body properly
    // Response.body can only be read once, so we need to clone it
    const clonedBody = response.body ? response.body : null;

    // Create new response with rate limit headers and CORS headers
    return new Response(clonedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // If path matched but no method matched, return 405 Method Not Allowed
  if (pathMatched && allowedMethodsForPath.length > 0) {
    const uniqueMethods = [...new Set(allowedMethodsForPath)];
    const responseHeaders = new Headers({
      Allow: uniqueMethods.join(", "),
      ...rateLimitHeaders,
      ...corsHeaders,
    });
    const response = new Response("Method Not Allowed", {
      status: 405,
      headers: responseHeaders,
    });
    return response;
  }

  // Not found - still include rate limit headers and CORS headers if available
  const notFoundHeaders = new Headers({
    ...rateLimitHeaders,
    ...corsHeaders,
  });
  const response = new Response("Not Found", {
    status: 404,
    headers: notFoundHeaders,
  });
  return response;
}
