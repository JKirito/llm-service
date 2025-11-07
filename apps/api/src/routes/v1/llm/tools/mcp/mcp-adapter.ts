import { tool } from "ai";
import { z } from "zod";
import { mcpManager } from "./mcp-manager";
import { createLogger } from "@llm-service/logger";
import type { FlexibleSchema } from "@ai-sdk/provider-utils";

const logger = createLogger("MCP_ADAPTER");

export function createMCPToolAdapter(toolKey: string) {
  const toolInfo = mcpManager.getToolInfo(toolKey);
  if (!toolInfo) {
    throw new Error(`MCP tool not found: ${toolKey}`);
  }

  // Convert MCP JSON Schema to Zod schema
  const zodSchema = convertJsonSchemaToZod(
    toolInfo.inputSchema,
  ) as unknown as FlexibleSchema<Record<string, unknown>>;

  return tool({
    description: toolInfo.description || `MCP tool: ${toolInfo.toolName}`,
    inputSchema: zodSchema,
    async execute(args: Record<string, unknown>) {
      try {
        const result = await mcpManager.executeTool(toolKey, args);
        return result;
      } catch (error) {
        logger.error(`MCP tool execution failed: ${toolKey}`, error);
        throw error;
      }
    },
  });
}

function convertJsonSchemaToZod(jsonSchema: unknown): z.ZodTypeAny {
  if (!jsonSchema || typeof jsonSchema !== "object") {
    return z.any();
  }

  const schema = jsonSchema as Record<string, unknown>;

  if (schema.type === "object" && schema.properties) {
    const shape: Record<string, z.ZodType> = {};
    const props = schema.properties as Record<string, unknown>;
    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const [key, value] of Object.entries(props)) {
      let fieldSchema = convertJsonSchemaToZod(value);

      // Make field optional if not in required array
      if (!required.includes(key)) {
        fieldSchema = fieldSchema.optional();
      }

      shape[key] = fieldSchema;
    }

    return z.object(shape);
  }

  if (schema.type === "string") {
    let stringSchema = z.string();
    if (schema.description && typeof schema.description === "string") {
      stringSchema = stringSchema.describe(schema.description);
    }
    if (schema.enum && Array.isArray(schema.enum)) {
      const enumValues = schema.enum.filter(
        (v): v is string => typeof v === "string",
      );
      if (enumValues.length > 0) {
        return z.enum([enumValues[0], ...enumValues.slice(1)]);
      }
    }
    return stringSchema;
  }

  if (schema.type === "number" || schema.type === "integer") {
    let numSchema = z.number();
    if (schema.description && typeof schema.description === "string") {
      numSchema = numSchema.describe(schema.description);
    }
    if (schema.type === "integer") {
      numSchema = numSchema.int();
    }
    if (typeof schema.minimum === "number") {
      numSchema = numSchema.min(schema.minimum);
    }
    if (typeof schema.maximum === "number") {
      numSchema = numSchema.max(schema.maximum);
    }
    return numSchema;
  }

  if (schema.type === "boolean") {
    let boolSchema = z.boolean();
    if (schema.description && typeof schema.description === "string") {
      boolSchema = boolSchema.describe(schema.description);
    }
    return boolSchema;
  }

  if (schema.type === "array") {
    const items = schema.items as unknown;
    let arraySchema = z.array(convertJsonSchemaToZod(items));
    if (schema.description && typeof schema.description === "string") {
      arraySchema = arraySchema.describe(schema.description);
    }
    if (typeof schema.minItems === "number") {
      arraySchema = arraySchema.min(schema.minItems);
    }
    if (typeof schema.maxItems === "number") {
      arraySchema = arraySchema.max(schema.maxItems);
    }
    return arraySchema;
  }

  return z.any();
}
