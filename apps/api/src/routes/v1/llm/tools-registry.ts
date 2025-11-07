import { createOpenAI } from "@ai-sdk/openai";
import type { Tool } from "ai";
import { config } from "../../../config";
import { mcpManager } from "./tools/mcp/mcp-manager";
import { createMCPToolAdapter } from "./tools/mcp/mcp-adapter";

export interface ToolDefinition {
  name: string;
  openaiToolName: string;
  description: string;
  requiresResponsesAPI: boolean;
  getTool: (fileIds?: string[]) => Tool;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getToolsByName(names: string[]): ToolDefinition[] {
    return names
      .map((name) => this.tools.get(name))
      .filter((tool): tool is ToolDefinition => tool !== undefined);
  }

  getOpenAITools(names: string[], fileIds?: string[]): Record<string, Tool> {
    const tools: Record<string, Tool> = {};

    for (const name of names) {
      // Try to get native tool first
      const nativeToolDef = this.getTool(name);
      if (nativeToolDef) {
        const toolInstance = nativeToolDef.getTool(fileIds);
        // For OpenAI's Responses API tools (like webSearchPreview), the tool name
        // must match what OpenAI expects. The tool instance from webSearchPreview
        // has the name "web_search_preview" internally, so we use that as the key.
        // However, if the tool instance has a different name property, we need to
        // ensure consistency. The Record key determines what name the model sees.
        tools[nativeToolDef.openaiToolName] = toolInstance;
        continue;
      }

      // Check MCP tools (format: "server:tool")
      if (name.includes(":")) {
        const toolInfo = mcpManager.getToolInfo(name);
        if (toolInfo) {
          const mcpTool = createMCPToolAdapter(name);
          // Use the full "server:tool" format as the key for MCP tools
          tools[name] = mcpTool;
        }
      }
    }

    return tools;
  }

  /**
   * Get the actual OpenAI tool names that will be available to the model
   * This helps ensure system prompts match actual tool names
   * For MCP tools, returns the full "server:tool" format
   */
  getOpenAIToolNames(names: string[]): string[] {
    const toolNames: string[] = [];

    for (const name of names) {
      // Native tools
      const nativeToolDef = this.getTool(name);
      if (nativeToolDef) {
        toolNames.push(nativeToolDef.openaiToolName);
        continue;
      }

      // MCP tools (format: "server:tool")
      if (name.includes(":")) {
        const toolInfo = mcpManager.getToolInfo(name);
        if (toolInfo) {
          toolNames.push(name); // Use the full "server:tool" format
        }
      }
    }

    return toolNames;
  }

  requiresResponsesAPI(names: string[]): boolean {
    // Only check native tools - MCP tools don't require Responses API
    const nativeToolNames = names.filter((name) => !name.includes(":"));
    const requestedTools = this.getToolsByName(nativeToolNames);
    return requestedTools.some((tool) => tool.requiresResponsesAPI);
  }

  /**
   * Initialize the tool registry
   * MCP manager is already initialized in index.ts, but this method
   * can be used for future registry setup
   */
  async initialize(): Promise<void> {
    // MCP manager is already initialized in index.ts
    // This method is here for consistency with the design
  }

  /**
   * List all available tools (both native and MCP)
   * Returns a unified list with tool name, type, and description
   */
  listAllTools(): Array<{
    name: string;
    type: "native" | "mcp";
    description?: string;
  }> {
    const tools: Array<{
      name: string;
      type: "native" | "mcp";
      description?: string;
    }> = [];

    // Native tools
    for (const toolDef of this.getAllTools()) {
      tools.push({
        name: toolDef.name,
        type: "native",
        description: toolDef.description,
      });
    }

    // MCP tools
    for (const toolInfo of mcpManager.listAvailableTools()) {
      const toolKey = `${toolInfo.serverName}:${toolInfo.toolName}`;
      tools.push({
        name: toolKey,
        type: "mcp",
        description: toolInfo.description,
      });
    }

    return tools;
  }

  /**
   * Get a tool by name, checking both native and MCP tools
   * MCP tools use the format "server:tool"
   */
  getToolInstance(name: string, fileIds?: string[]): Tool | undefined {
    // Check native tools first
    const nativeToolDef = this.getTool(name);
    if (nativeToolDef) {
      return nativeToolDef.getTool(fileIds);
    }

    // Check MCP tools (format: "server:tool")
    if (name.includes(":")) {
      const toolInfo = mcpManager.getToolInfo(name);
      if (toolInfo) {
        return createMCPToolAdapter(name);
      }
    }

    return undefined;
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();

// Initialize tools registry - lazy initialization
let openaiInstance: ReturnType<typeof createOpenAI> | null = null;

function getOpenAIInstance(): ReturnType<typeof createOpenAI> {
  if (!openaiInstance) {
    openaiInstance = createOpenAI({
      apiKey: config.openai.apiKey,
    });
  }
  return openaiInstance;
}

// Register web_search tool
// User-facing name: "web_search" (for better developer experience)
// Actual OpenAI tool name: "web_search" (what the model sees and calls)
// Using the current webSearch tool (not deprecated webSearchPreview)
toolRegistry.registerTool({
  name: "web_search", // User-facing name for API requests (tools: ["web_search"])
  openaiToolName: "web_search", // Actual OpenAI tool name that the model sees
  description:
    "Search the web for current information using OpenAI's web search",
  requiresResponsesAPI: true,
  getTool: () => getOpenAIInstance().tools.webSearch({}) as Tool, // fileIds not needed for web_search
});

// Register code_interpreter tool
// User-facing name: "code_interpreter"
// Actual OpenAI tool name: "code_interpreter"
// Note: File IDs must be passed separately when constructing the tool
// code_interpreter requires Responses API for proper functionality
toolRegistry.registerTool({
  name: "code_interpreter", // User-facing name for API requests (tools: ["code_interpreter"])
  openaiToolName: "code_interpreter", // Actual OpenAI tool name that the model sees
  description:
    "Write and execute Python code to analyze data, create visualizations, and solve problems",
  requiresResponsesAPI: true, // code_interpreter requires Responses API
  getTool: (fileIds?: string[]) => {
    // If file IDs are provided, make them available to code_interpreter
    if (fileIds && fileIds.length > 0) {
      return getOpenAIInstance().tools.codeInterpreter({
        container: {
          fileIds: fileIds,
        },
      }) as Tool;
    }
    // Return code_interpreter without file container
    return getOpenAIInstance().tools.codeInterpreter({}) as Tool;
  },
});

// Register generate_image tool
// User-facing name: "generate_image"
// Note: This tool is created dynamically using createImageGenerationTool()
// in the handler/orchestrator with runtime dependencies (StreamWriter, callbacks)
// but we register it here so it appears in the tools list
toolRegistry.registerTool({
  name: "generate_image",
  openaiToolName: "generate_image",
  description:
    "Generate images using DALL-E 3. Can create 1-4 images with customizable size, quality, and style",
  requiresResponsesAPI: false, // generate_image works with standard API
  getTool: () => {
    // This is a placeholder - the actual tool is created dynamically
    // in stream-orchestrator.ts using createImageGenerationTool()
    // This registration is primarily for the tools list endpoint
    throw new Error(
      "generate_image tool must be created dynamically with runtime dependencies",
    );
  },
});
