import type { ApiResponse } from "@llm-service/types";
import type { RouteHandler } from "../../types";
import { toolRegistry } from "./tools-registry";

/**
 * GET /v1/llm/tools
 * List all available tools
 */
export const listToolsHandler: RouteHandler = async (_req) => {
  try {
    const allTools = toolRegistry.getAllTools();

    const tools = allTools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      requiresResponsesAPI: tool.requiresResponsesAPI,
    }));

    const response: ApiResponse<{
      tools: Array<{
        name: string;
        description: string;
        requiresResponsesAPI: boolean;
      }>;
    }> = {
      success: true,
      data: {
        tools,
      },
      message: "Tools retrieved successfully",
    };

    return Response.json(response);
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to list tools: ${error.message}`
          : "Failed to list tools",
    };
    return Response.json(response, { status: 500 });
  }
};
