import type { ApiResponse } from "@llm-service/types";
import type { Route, RouteHandler } from "./types";
import { routes as v1Routes } from "./v1";

function normalizeBasePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }
  return path.endsWith("/") && path.length > 1 ? path.slice(0, -1) : path;
}

function combinePaths(basePath: string, routePath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  const trimmedRoute = routePath.startsWith("/")
    ? routePath.slice(1)
    : routePath;
  if (!trimmedRoute) {
    return normalizedBase;
  }
  return `${normalizedBase}/${trimmedRoute}`;
}

function withBasePath(basePath: string, childRoutes: Route[]): Route[] {
  return childRoutes.map((route) => ({
    ...route,
    path: combinePaths(basePath, route.path),
  }));
}

export const rootHandler: RouteHandler = () => {
  const response: ApiResponse = {
    success: true,
    message: "LLM Service API is running",
  };
  return Response.json(response);
};

export const healthHandler: RouteHandler = () => {
  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
};

export const routes: Route[] = [
  {
    path: "/api",
    handler: rootHandler,
    methods: ["GET"],
  },
  {
    path: "/api/health",
    handler: healthHandler,
    methods: ["GET"],
  },
  ...withBasePath("/api", v1Routes),
];
