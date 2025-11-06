import type { ApiResponse } from "@llm-service/types";
import type { RouteHandler } from "../../types";
import { toolRegistry } from "./tools-registry";

/**
 * GET /v1/llm/tools
 * List all available tools (native + MCP)
 */
export const listToolsHandler: RouteHandler = async (_req) => {
  try {
    // Use listAllTools() which includes both native and MCP tools
    const allTools = toolRegistry.listAllTools();

    const tools = allTools.map((tool) => {
      // For native tools, get additional metadata
      if (tool.type === "native") {
        const toolDef = toolRegistry.getTool(tool.name);
        return {
          name: tool.name,
          type: tool.type,
          description: tool.description || "",
          requiresResponsesAPI: toolDef?.requiresResponsesAPI || false,
        };
      }

      // For MCP tools, just return basic info
      return {
        name: tool.name,
        type: tool.type,
        description: tool.description || "",
        requiresResponsesAPI: false,
      };
    });

    const response: ApiResponse<{
      tools: Array<{
        name: string;
        type: "native" | "mcp";
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
