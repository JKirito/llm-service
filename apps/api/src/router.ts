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

  // Check rate limit before processing request
  const rateLimitResult = await rateLimiterMiddleware(req, pathname);
  if (rateLimitResult.rateLimited && rateLimitResult.response) {
    return rateLimitResult.response;
  }

  // Store rate limit headers to add to response
  const rateLimitHeaders = rateLimitResult.headers;
  
  // Log rate limit headers for debugging
  if (Object.keys(rateLimitHeaders).length > 0) {
    logger.debug(`Rate limit headers: ${JSON.stringify(rateLimitHeaders)}`);
  }

  for (const route of routes) {
    const match = matchRoute(pathname, route);
    if (!match) {
      continue;
    }

    const allowedMethods =
      route.methods?.map((method) => method.toUpperCase()) ?? [];

    if (
      allowedMethods.length > 0 &&
      !allowedMethods.includes(req.method.toUpperCase())
    ) {
      const response = new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: allowedMethods.join(", "),
          ...rateLimitHeaders,
        },
      });
      return response;
    }

    // Execute route handler
    const response = await route.handler(req, match.params);
    
    // Clone response and add rate limit headers
    const newHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(rateLimitHeaders)) {
      newHeaders.set(key, value);
    }

    // For streaming responses, we can't clone the body easily
    // Check if it's a streaming response by content-type
    const contentType = response.headers.get("content-type");
    const isStreaming = contentType?.includes("text/event-stream") || 
                        contentType?.includes("stream");
    
    if (isStreaming) {
      // For streaming responses, return as-is (headers are already set)
      // We can't modify headers on streaming responses easily
      return response;
    }

    // Clone response body properly
    // Response.body can only be read once, so we need to clone it
    const clonedBody = response.body ? response.body : null;
    
    // Create new response with rate limit headers
    return new Response(clonedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders,
    });
  }

  // Not found - still include rate limit headers if available
  const response = new Response("Not Found", {
    status: 404,
    headers: rateLimitHeaders,
  });
  return response;
}
