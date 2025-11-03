import { createLogger } from "@llm-service/logger";
import { routes } from "./routes";
import type { Route } from "./routes/types";

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
      return new Response("Method Not Allowed", {
        status: 405,
        headers: {
          Allow: allowedMethods.join(", "),
        },
      });
    }

    return await route.handler(req, match.params);
  }

  return new Response("Not Found", { status: 404 });
}
