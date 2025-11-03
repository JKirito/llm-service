import { createOpenAI } from "@ai-sdk/openai";
import type { Tool } from "ai";

export interface ToolDefinition {
  name: string;
  openaiToolName: string;
  description: string;
  requiresResponsesAPI: boolean;
  getTool: () => Tool;
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

  getOpenAITools(names: string[]): Record<string, Tool> {
    const tools: Record<string, Tool> = {};
    const requestedTools = this.getToolsByName(names);

    for (const toolDef of requestedTools) {
      const toolInstance = toolDef.getTool();
      // For OpenAI's Responses API tools (like webSearchPreview), the tool name
      // must match what OpenAI expects. The tool instance from webSearchPreview
      // has the name "web_search_preview" internally, so we use that as the key.
      // However, if the tool instance has a different name property, we need to
      // ensure consistency. The Record key determines what name the model sees.
      tools[toolDef.openaiToolName] = toolInstance;
    }

    return tools;
  }

  /**
   * Get the actual OpenAI tool names that will be available to the model
   * This helps ensure system prompts match actual tool names
   */
  getOpenAIToolNames(names: string[]): string[] {
    const requestedTools = this.getToolsByName(names);
    return requestedTools.map((tool) => tool.openaiToolName);
  }

  requiresResponsesAPI(names: string[]): boolean {
    const requestedTools = this.getToolsByName(names);
    return requestedTools.some((tool) => tool.requiresResponsesAPI);
  }
}

// Singleton instance
export const toolRegistry = new ToolRegistry();

// Initialize tools registry - lazy initialization
let openaiInstance: ReturnType<typeof createOpenAI> | null = null;

function getOpenAIInstance(): ReturnType<typeof createOpenAI> {
  if (!openaiInstance) {
    // Import config dynamically to avoid circular dependencies
    const { config } = require("../../../config");
    openaiInstance = createOpenAI({
      apiKey: config.openai.apiKey,
    });
  }
  return openaiInstance;
}

// Register web_search tool
// User-facing name: "web_search" (for better developer experience)
// Actual OpenAI tool name: "web_search_preview" (what the model sees and calls)
// The mapping happens internally: user requests "web_search", we map to "web_search_preview"
toolRegistry.registerTool({
  name: "web_search", // User-facing name for API requests (tools: ["web_search"])
  openaiToolName: "web_search_preview", // Actual OpenAI tool name that the model sees
  description: "Search the web for current information using OpenAI's web search",
  requiresResponsesAPI: true,
  getTool: () => getOpenAIInstance().tools.webSearchPreview({}),
});

