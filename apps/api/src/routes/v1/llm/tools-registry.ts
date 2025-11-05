import { createOpenAI } from "@ai-sdk/openai";
import type { Tool } from "ai";
import { tool } from "ai";
import { z } from "zod";
import { config } from "../../../config";
import { generateImageWithDallE } from "./image-generation-service";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("TOOLS_REGISTRY");

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
    const requestedTools = this.getToolsByName(names);

    for (const toolDef of requestedTools) {
      const toolInstance = toolDef.getTool(fileIds);
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

// Register image_generation tool
// User-facing name: "image_generation"
// This is a custom tool that uses DALL-E 3 to generate images
// Does NOT require Responses API as it's a custom tool implementation
toolRegistry.registerTool({
  name: "image_generation", // User-facing name for API requests (tools: ["image_generation"])
  openaiToolName: "image_generation", // Tool name that the model sees
  description:
    "Generate images using DALL-E 3 based on text descriptions. Use this when the user asks to create, generate, or draw an image.",
  requiresResponsesAPI: false, // Custom tool, doesn't require Responses API
  getTool: () => {
    return tool({
      description:
        "Generate an image using DALL-E 3 based on a text prompt. Returns the generated image URL and metadata.",
      parameters: z.object({
        prompt: z
          .string()
          .min(1)
          .max(1000)
          .describe(
            "A detailed text description of the image to generate. Be specific and descriptive.",
          ),
        size: z
          .enum(["1024x1024", "1792x1024", "1024x1792"])
          .optional()
          .describe(
            "The size of the generated image. Defaults to 1024x1024 (square).",
          ),
        quality: z
          .enum(["standard", "hd"])
          .optional()
          .describe(
            "The quality of the image. 'hd' creates images with finer details. Defaults to 'standard'.",
          ),
        style: z
          .enum(["vivid", "natural"])
          .optional()
          .describe(
            "The style of the generated image. 'vivid' creates hyper-real and dramatic images, 'natural' creates more natural-looking images. Defaults to 'vivid'.",
          ),
      }),
      execute: async ({ prompt, size, quality, style }) => {
        try {
          logger.info(`Tool calling image generation with prompt: ${prompt}`);

          const result = await generateImageWithDallE({
            prompt,
            size: size || "1024x1024",
            quality: quality || "standard",
            style: style || "vivid",
            n: 1,
          });

          logger.info(
            `Image generated successfully: ${result.imageReference.imageId}`,
          );

          return {
            success: true,
            imageId: result.imageReference.imageId,
            imageUrl: result.imageUrl,
            prompt: result.imageReference.prompt,
            revisedPrompt: result.revisedPrompt,
            size: result.imageReference.size,
            model: result.imageReference.model,
            path: result.imageReference.path,
            message: `Image generated successfully! You can view it at: ${result.imageUrl}`,
          };
        } catch (error) {
          logger.error("Failed to generate image via tool", error);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to generate image",
          };
        }
      },
    });
  },
});
