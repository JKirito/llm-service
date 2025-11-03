//import type { ApiResponse } from "@llm-service/types";

export type RouteHandler = (
  req: Request,
  params?: Record<string, string>,
) => Promise<Response> | Response;

export interface Route {
  path: string;
  handler: RouteHandler;
  methods?: string[];
}

export interface RouteRegistry {
  [path: string]: RouteHandler;
}
