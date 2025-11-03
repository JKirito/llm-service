import type { ApiResponse } from "@llm-service/types";
import type { Route, RouteHandler } from "../types";
import { filesRoutes } from "./files";
import { llmRoutes } from "./llm";

export const usersHandler: RouteHandler = () => {
  const response: ApiResponse = {
    success: true,
    data: [],
    message: "Users retrieved successfully",
  };
  return Response.json(response);
};

export const routes: Route[] = [
  {
    path: "/v1/users",
    handler: usersHandler,
    methods: ["GET"],
  },
  ...filesRoutes,
  ...llmRoutes,
];
