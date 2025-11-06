# Stateless LLM Service Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor the monolithic LLM handler into a stateless, modular architecture with MCP support and messageId-based streaming.

**Architecture:** Extract 1167-line handler into focused modules (validation, tools, documents, streaming, persistence). Change from conversationId-based to messageId-based streaming for concurrency. Add Model Context Protocol (MCP) integration for extensible tool support. New interactions collection for stateless audit trail.

**Tech Stack:** Bun, TypeScript, Vercel AI SDK, MongoDB, Redis (ioredis), MCP SDK, Zod

**Design Reference:** See `docs/plans/2025-11-06-stateless-llm-refactor-design.md` for complete architecture

---

## Prerequisites

Before starting, ensure:
- MongoDB running (for interactions collection)
- Redis running (for stream caching)
- Environment variables configured (`.env` file)
- In worktree: `/home/jkirito/Desktop/work/llm-service/.worktrees/stateless-llm-refactor`

---

## Task 1: Install MCP Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add MCP SDK dependency**

Run:
```bash
bun add @modelcontextprotocol/sdk
```

Expected: Package installed successfully

**Step 2: Verify installation**

Run:
```bash
bun pm ls | grep modelcontextprotocol
```

Expected: Shows installed version

**Step 3: Commit**

```bash
git add package.json bun.lockb
git commit -m "chore: add MCP SDK dependency

Add @modelcontextprotocol/sdk for Model Context Protocol integration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 2: Create Directory Structure

**Files:**
- Create: `apps/api/src/routes/v1/llm/validation/`
- Create: `apps/api/src/routes/v1/llm/tools/definitions/`
- Create: `apps/api/src/routes/v1/llm/tools/mcp/`
- Create: `apps/api/src/routes/v1/llm/documents/`
- Create: `apps/api/src/routes/v1/llm/streaming/`
- Create: `apps/api/src/routes/v1/llm/generation/`
- Create: `apps/api/src/routes/v1/llm/persistence/`

**Step 1: Create directories**

Run:
```bash
cd apps/api/src/routes/v1/llm
mkdir -p validation tools/definitions tools/mcp documents streaming generation persistence
```

Expected: Directories created

**Step 2: Verify structure**

Run:
```bash
tree -d -L 2 apps/api/src/routes/v1/llm
```

Expected: Shows all new directories

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/
git commit -m "chore: create modular directory structure

Set up directories for validation, tools, documents, streaming,
generation, and persistence modules.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 3: Create Type Definitions

**Files:**
- Create: `apps/api/src/routes/v1/llm/validation/types.ts`
- Create: `apps/api/src/routes/v1/llm/streaming/stream-types.ts`
- Create: `apps/api/src/routes/v1/llm/persistence/types.ts`

**Step 1: Create validation types**

Create `apps/api/src/routes/v1/llm/validation/types.ts`:

```typescript
export interface ValidatedRequest {
  messages: unknown[];
  conversationId?: string;
  model: string;
  modelParams: ModelParams;
  documentReferences: string[];
  stream: boolean;
}

export interface ModelParams {
  tools: string[];
  reasoningEffort?: "low" | "medium" | "high";
  temperature?: number;
  includeSearch?: boolean;
}

export class RequestValidationError extends Error {
  constructor(
    message: string,
    public field: string,
    public code: string
  ) {
    super(message);
    this.name = "RequestValidationError";
  }
}
```

**Step 2: Create streaming types**

Create `apps/api/src/routes/v1/llm/streaming/stream-types.ts`:

```typescript
import type { CoreMessage } from "ai";
import type { Tool } from "ai";

export interface StreamWriter {
  write(data: unknown): void;
  merge(stream: ReadableStream): void;
}

export interface StreamConfig {
  messageId: string;
  conversationId?: string;
  model: unknown;
  messages: CoreMessage[];
  tools: Record<string, Tool>;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
  request: Request;
}
```

**Step 3: Create persistence types**

Create `apps/api/src/routes/v1/llm/persistence/types.ts`:

```typescript
import type { BasicUIMessage } from "../messages";
import type { MessageSource, ImageReference } from "../types";

export interface InteractionData {
  conversationId?: string;
  messageId: string;
  model: string;
  requestMessages: BasicUIMessage[];
  responseMessage: BasicUIMessage;
  usage?: Record<string, unknown>;
  sources?: MessageSource[];
  imageReferences?: ImageReference[];
  documentReferences?: string[];
  wasStreamed: boolean;
  duration?: number;
}

export interface InteractionDocument extends InteractionData {
  _id: string;
  createdAt: Date;
  completedAt: Date;
}
```

**Step 4: Commit**

```bash
git add apps/api/src/routes/v1/llm/validation/types.ts \
        apps/api/src/routes/v1/llm/streaming/stream-types.ts \
        apps/api/src/routes/v1/llm/persistence/types.ts
git commit -m "feat: add type definitions for refactored modules

Add TypeScript types for validation, streaming, and persistence.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 4: Extract Request Validator

**Files:**
- Create: `apps/api/src/routes/v1/llm/validation/request-validator.ts`

**Step 1: Create request validator**

Create `apps/api/src/routes/v1/llm/validation/request-validator.ts`:

```typescript
import { config } from "../../../../config";
import type { ValidatedRequest, ModelParams } from "./types";
import { RequestValidationError } from "./types";

export function validateRequestBody(body: unknown): ValidatedRequest {
  if (!body || typeof body !== "object") {
    throw new RequestValidationError(
      "Request body must be an object",
      "body",
      "INVALID_BODY"
    );
  }

  const record = body as Record<string, unknown>;

  // Validate messages (required)
  if (!Array.isArray(record.messages) || record.messages.length === 0) {
    throw new RequestValidationError(
      "messages array is required and must not be empty",
      "messages",
      "MISSING_MESSAGES"
    );
  }

  // Validate model
  const model =
    typeof record.model === "string" && record.model.trim()
      ? record.model.trim()
      : config.openai.defaultModel;

  // Validate modelParams
  const modelParams = parseModelParams(record.modelParams);

  // Validate conversationId format if provided
  const conversationId = record.conversationId;
  if (conversationId !== undefined) {
    if (typeof conversationId !== "string" || !conversationId.trim()) {
      throw new RequestValidationError(
        "conversationId must be a non-empty string",
        "conversationId",
        "INVALID_CONVERSATION_ID"
      );
    }
  }

  // Validate documentReferences
  const documentReferences = Array.isArray(record.documentReferences)
    ? record.documentReferences.filter(
        (ref): ref is string =>
          typeof ref === "string" && ref.trim() !== ""
      )
    : [];

  // Stream flag
  const stream =
    typeof record.stream === "boolean"
      ? record.stream
      : typeof record.stream === "string"
        ? record.stream.toLowerCase() === "true"
        : false;

  return {
    messages: record.messages,
    conversationId: typeof conversationId === "string" ? conversationId.trim() : undefined,
    model,
    modelParams,
    documentReferences,
    stream,
  };
}

function parseModelParams(params: unknown): ModelParams {
  if (!params || typeof params !== "object") {
    return { tools: [] };
  }

  const p = params as Record<string, unknown>;

  // Extract tools
  const tools = Array.isArray(p.tools)
    ? p.tools.filter(
        (t): t is string => typeof t === "string" && t.trim() !== ""
      )
    : [];

  // Extract reasoningEffort
  const validReasoningEfforts = ["low", "medium", "high"];
  const reasoningEffort =
    typeof p.reasoningEffort === "string" &&
    validReasoningEfforts.includes(p.reasoningEffort)
      ? (p.reasoningEffort as "low" | "medium" | "high")
      : undefined;

  // Extract temperature
  const temperature =
    typeof p.temperature === "number" &&
    !Number.isNaN(p.temperature) &&
    p.temperature >= 0 &&
    p.temperature <= 2
      ? p.temperature
      : undefined;

  // Extract includeSearch (legacy support)
  const includeSearch =
    typeof p.includeSearch === "boolean" ? p.includeSearch : undefined;

  return {
    tools,
    reasoningEffort,
    temperature,
    includeSearch,
  };
}

export async function validateTools(
  tools: string[],
  toolRegistry: { listAllTools: () => Array<{ name: string }> }
): Promise<string[]> {
  const allTools = toolRegistry.listAllTools();
  const validToolNames = new Set(allTools.map((t) => t.name));

  return tools.filter((name) => !validToolNames.has(name));
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/validation/request-validator.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/validation/request-validator.ts
git commit -m "feat(validation): add request validator

Extract request validation logic from handler. Validates request body,
messages, modelParams, conversationId, and documentReferences.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 5: Extract Message Validator

**Files:**
- Create: `apps/api/src/routes/v1/llm/validation/message-validator.ts`

**Step 1: Create message validator**

Create `apps/api/src/routes/v1/llm/validation/message-validator.ts`:

```typescript
import { validateUIMessages, type CoreMessage } from "ai";
import type { BasicUIMessage } from "../messages";

export async function validateMessages(
  messages: unknown[]
): Promise<BasicUIMessage[]> {
  // Use AI SDK validation
  const validated = await validateUIMessages({ messages });
  return validated as BasicUIMessage[];
}

export function containsUserMessage(messages: BasicUIMessage[]): boolean {
  return messages.some((message) => message.role === "user");
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/validation/message-validator.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/validation/message-validator.ts
git commit -m "feat(validation): add message validator

Extract message validation logic. Uses AI SDK validateUIMessages.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 6: Create MCP Manager

**Files:**
- Create: `apps/api/src/routes/v1/llm/tools/mcp/mcp-manager.ts`

**Step 1: Create MCP manager**

Create `apps/api/src/routes/v1/llm/tools/mcp/mcp-manager.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("MCP_MANAGER");

export interface MCPServerConfig {
  name: string;
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  enabled: boolean;
}

export interface MCPToolInfo {
  serverName: string;
  toolName: string;
  description?: string;
  inputSchema: unknown;
}

export class MCPManager {
  private clients: Map<string, Client>;
  private availableTools: Map<string, MCPToolInfo>;

  constructor() {
    this.clients = new Map();
    this.availableTools = new Map();
  }

  async initialize(servers: MCPServerConfig[]): Promise<void> {
    for (const server of servers) {
      if (!server.enabled) {
        logger.info(`Skipping disabled MCP server: ${server.name}`);
        continue;
      }

      try {
        const client = await this.connectToServer(server);
        this.clients.set(server.name, client);

        // List available tools from this server
        const tools = await client.listTools();
        for (const tool of tools.tools) {
          const toolKey = `${server.name}:${tool.name}`;
          this.availableTools.set(toolKey, {
            serverName: server.name,
            toolName: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          });
        }

        logger.info(
          `Connected to MCP server: ${server.name} (${tools.tools.length} tools)`
        );
      } catch (error) {
        logger.error(`Failed to connect to MCP server ${server.name}`, error);
      }
    }
  }

  private async connectToServer(config: MCPServerConfig): Promise<Client> {
    const client = new Client(
      {
        name: "llm-service",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    let transport;
    if (config.type === "stdio") {
      if (!config.command) {
        throw new Error(`stdio server ${config.name} missing command`);
      }
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: { ...process.env, ...config.env },
      });
    } else {
      if (!config.url) {
        throw new Error(`sse server ${config.name} missing url`);
      }
      transport = new SSEClientTransport(new URL(config.url));
    }

    await client.connect(transport);
    return client;
  }

  listAvailableTools(): MCPToolInfo[] {
    return Array.from(this.availableTools.values());
  }

  getToolInfo(toolKey: string): MCPToolInfo | undefined {
    return this.availableTools.get(toolKey);
  }

  async executeTool(
    toolKey: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const toolInfo = this.availableTools.get(toolKey);
    if (!toolInfo) {
      throw new Error(`MCP tool not found: ${toolKey}`);
    }

    const client = this.clients.get(toolInfo.serverName);
    if (!client) {
      throw new Error(`MCP server not connected: ${toolInfo.serverName}`);
    }

    const result = await client.callTool({
      name: toolInfo.toolName,
      arguments: args,
    });

    return result;
  }

  async cleanup(): Promise<void> {
    for (const [name, client] of this.clients.entries()) {
      try {
        await client.close();
        logger.info(`Closed MCP connection: ${name}`);
      } catch (error) {
        logger.error(`Failed to close MCP connection: ${name}`, error);
      }
    }
    this.clients.clear();
    this.availableTools.clear();
  }
}

export const mcpManager = new MCPManager();
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/tools/mcp/mcp-manager.ts
```

Expected: No errors (or MCP SDK type issues - acceptable for now)

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/tools/mcp/mcp-manager.ts
git commit -m "feat(tools): add MCP manager

Implement Model Context Protocol manager for connecting to and
managing external tool servers (stdio and SSE transports).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 7: Create MCP Adapter

**Files:**
- Create: `apps/api/src/routes/v1/llm/tools/mcp/mcp-adapter.ts`

**Step 1: Create MCP adapter**

Create `apps/api/src/routes/v1/llm/tools/mcp/mcp-adapter.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";
import { mcpManager } from "./mcp-manager";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("MCP_ADAPTER");

export function createMCPToolAdapter(toolKey: string) {
  const toolInfo = mcpManager.getToolInfo(toolKey);
  if (!toolInfo) {
    throw new Error(`MCP tool not found: ${toolKey}`);
  }

  // Convert MCP JSON Schema to Zod schema
  const zodSchema = convertJsonSchemaToZod(toolInfo.inputSchema);

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

function convertJsonSchemaToZod(jsonSchema: unknown): z.ZodType {
  if (!jsonSchema || typeof jsonSchema !== "object") {
    return z.any();
  }

  const schema = jsonSchema as Record<string, unknown>;

  if (schema.type === "object" && schema.properties) {
    const shape: Record<string, z.ZodType> = {};
    const props = schema.properties as Record<string, unknown>;

    for (const [key, value] of Object.entries(props)) {
      shape[key] = convertJsonSchemaToZod(value);
    }

    return z.object(shape);
  }

  if (schema.type === "string") {
    let stringSchema = z.string();
    if (schema.description) {
      stringSchema = stringSchema.describe(schema.description as string);
    }
    return stringSchema;
  }

  if (schema.type === "number" || schema.type === "integer") {
    let numSchema = z.number();
    if (schema.description) {
      numSchema = numSchema.describe(schema.description as string);
    }
    return numSchema;
  }

  if (schema.type === "boolean") {
    return z.boolean();
  }

  if (schema.type === "array") {
    const items = schema.items as unknown;
    return z.array(convertJsonSchemaToZod(items));
  }

  return z.any();
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/tools/mcp/mcp-adapter.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/tools/mcp/mcp-adapter.ts
git commit -m "feat(tools): add MCP adapter

Convert MCP tools to AI SDK tool format. Includes JSON Schema to Zod
conversion for input validation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 8: Update Config with MCP Servers

**Files:**
- Modify: `apps/api/src/config.ts`

**Step 1: Add MCP configuration**

Add to `apps/api/src/config.ts` (after existing config):

```typescript
  mcp: {
    servers: [
      // Example MCP server configurations
      // Uncomment and configure as needed
      /*
      {
        name: "filesystem",
        type: "stdio" as const,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
        enabled: false,
      },
      {
        name: "brave-search",
        type: "stdio" as const,
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-brave-search"],
        env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY || "" },
        enabled: !!process.env.BRAVE_API_KEY,
      },
      */
    ],
  },
```

**Step 2: Verify config compiles**

Run:
```bash
bunx tsc --noEmit apps/api/src/config.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/config.ts
git commit -m "feat(config): add MCP server configuration

Add MCP server configuration array to config. Servers are disabled by
default and can be enabled as needed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 9: Extract Image Generation Tool

**Files:**
- Create: `apps/api/src/routes/v1/llm/tools/definitions/image-generator.ts`

**Step 1: Extract generate_image tool from handler**

Create `apps/api/src/routes/v1/llm/tools/definitions/image-generator.ts`:

Copy the generate_image tool code from handler.ts lines 546-768, wrap in function:

```typescript
import { tool } from "ai";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { experimental_generateImage as generateImage } from "ai";
import { createLogger } from "@llm-service/logger";
import { config } from "../../../../../config";
import { uploadGeneratedImage } from "../../../../../lib/image-storage";
import { getFileUrlFromPath } from "../../../../../lib/storage-url";
import { initializeAzureStorage } from "@llm-service/azure-storage";
import type { StreamWriter } from "../../streaming/stream-types";
import type { ImageReference } from "../../types";

const logger = createLogger("IMAGE_GENERATOR_TOOL");

const openai = createOpenAI({
  apiKey: config.openai.apiKey,
});

let azureStorageInitialized = false;
function ensureAzureStorage(): void {
  if (!azureStorageInitialized) {
    initializeAzureStorage(config.azure.connectionString);
    azureStorageInitialized = true;
  }
}

export function createImageGenerationTool(writer: StreamWriter) {
  return tool({
    description:
      "Generate one or more images using DALL-E 3. Returns public URLs so the client can render them immediately.",
    inputSchema: z.object({
      prompt: z
        .string()
        .describe("What to draw. Be descriptive and clear."),
      n: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(1)
        .describe("Number of images to generate (1-4)"),
      size: z
        .enum(["1024x1024", "1792x1024", "1024x1792"])
        .default("1024x1024")
        .describe("Image size"),
      quality: z
        .enum(["standard", "hd"])
        .default("standard")
        .describe("Image quality (standard or hd)"),
      style: z
        .enum(["vivid", "natural"])
        .default("vivid")
        .describe("Image style"),
      seed: z.number().optional().describe("Seed for reproducibility"),
    }),
    async execute(
      {
        prompt,
        n,
        size,
        quality,
        style,
        seed,
      }: {
        prompt: string;
        n: number;
        size: "1024x1024" | "1792x1024" | "1024x1792";
        quality: "standard" | "hd";
        style: "vivid" | "natural";
        seed?: number;
      },
      {
        toolCallId,
        abortSignal,
      }: {
        toolCallId: string;
        abortSignal?: AbortSignal;
      }
    ) {
      try {
        // Notify client that image generation started
        writer.write({
          type: "data-toolStatus",
          id: toolCallId,
          data: {
            name: "generate_image",
            status: "started",
          },
          transient: true,
        });

        // Ensure Azure Storage is initialized
        ensureAzureStorage();

        // Generate image using AI SDK
        logger.info(`Generating image with prompt: ${prompt}`);
        const generateResult = await generateImage({
          model: openai.image("dall-e-3"),
          prompt,
          size: size as "1024x1024" | "1792x1024" | "1024x1792",
          providerOptions: {
            openai: {
              quality: quality as "standard" | "hd",
              style: style as "vivid" | "natural",
            },
          },
          ...(seed !== undefined ? { seed } : {}),
          abortSignal,
        });

        // Process generated images
        const imagesToProcess = generateResult.image
          ? [generateResult.image]
          : generateResult.images || [];

        const imageUrls: string[] = [];

        for (const image of imagesToProcess) {
          try {
            const imageData = image.uint8Array || new Uint8Array();

            if (imageData.length > 0) {
              const uploadResult = await uploadGeneratedImage(
                imageData,
                prompt,
                {
                  model: "dall-e-3",
                  size,
                  quality,
                  style,
                  ...(seed !== undefined ? { seed: seed.toString() } : {}),
                }
              );

              const publicUrl = getFileUrlFromPath(uploadResult.path);
              imageUrls.push(publicUrl);
            }
          } catch (uploadError) {
            logger.error("Failed to upload generated image", uploadError);
            throw uploadError;
          }
        }

        if (imageUrls.length === 0) {
          throw new Error("No images were generated");
        }

        // Stream image data to client
        writer.write({
          type: "data-image",
          id: toolCallId,
          data: {
            urls: imageUrls,
            prompt,
            provider: "openai",
            model: "dall-e-3",
            size,
          },
        });

        // Return compact result for LLM
        return {
          urls: imageUrls,
          prompt,
          provider: "openai",
          model: "dall-e-3",
          size,
          count: imageUrls.length,
        };
      } catch (error) {
        logger.error("Image generation failed", error);
        const errorMessage =
          error instanceof Error ? error.message : "Image generation failed";

        // Notify client of error
        writer.write({
          type: "data-toolStatus",
          id: toolCallId,
          data: {
            name: "generate_image",
            status: "error",
          },
          transient: true,
        });

        writer.write({
          type: "data-notification",
          data: {
            message: `Image generation failed: ${errorMessage}`,
            level: "error",
          },
          transient: true,
        });

        throw error;
      }
    },
  });
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/tools/definitions/image-generator.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/tools/definitions/image-generator.ts
git commit -m "feat(tools): extract image generation tool

Extract generate_image tool from monolithic handler into dedicated
module. Self-contained tool with Azure Storage upload.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 10: Add MongoDB Interactions Collection

**Files:**
- Create: `apps/api/src/routes/v1/llm/persistence/interaction-store.ts`

**Step 1: Create interaction store**

Create `apps/api/src/routes/v1/llm/persistence/interaction-store.ts`:

```typescript
import type { Collection } from "mongodb";
import { getDatabase } from "../../../../lib/mongodb";
import type { InteractionDocument, InteractionData } from "./types";

async function getInteractionCollection(): Promise<
  Collection<InteractionDocument>
> {
  const db = await getDatabase();
  return db.collection<InteractionDocument>("interactions");
}

export async function createInteraction(
  data: InteractionData
): Promise<string> {
  const collection = await getInteractionCollection();

  const now = new Date();
  const startTime = Date.now();

  const document: Omit<InteractionDocument, "_id"> = {
    ...data,
    createdAt: now,
    completedAt: now,
    duration: data.duration || 0,
  };

  const result = await collection.insertOne(document as InteractionDocument);
  return result.insertedId.toString();
}

export async function findInteractionByMessageId(
  messageId: string
): Promise<InteractionDocument | null> {
  const collection = await getInteractionCollection();
  return await collection.findOne({ messageId });
}

export async function listInteractionsByConversation(
  conversationId: string,
  limit: number = 100,
  skip: number = 0
): Promise<InteractionDocument[]> {
  const collection = await getInteractionCollection();
  return await collection
    .find({ conversationId })
    .sort({ createdAt: 1 })
    .limit(limit)
    .skip(skip)
    .toArray();
}

export async function createIndexes(): Promise<void> {
  const collection = await getInteractionCollection();

  await collection.createIndex({ conversationId: 1, createdAt: 1 });
  await collection.createIndex({ messageId: 1 }, { unique: true });
  await collection.createIndex({ createdAt: -1 });
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/persistence/interaction-store.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/persistence/interaction-store.ts
git commit -m "feat(persistence): add interactions collection

Add MongoDB interactions collection for stateless audit trail.
Each interaction is independent with optional conversationId link.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 11: Create Conversation Persister

**Files:**
- Create: `apps/api/src/routes/v1/llm/persistence/conversation-persister.ts`

**Step 1: Create persistence module**

Create `apps/api/src/routes/v1/llm/persistence/conversation-persister.ts`:

```typescript
import { createLogger } from "@llm-service/logger";
import { createInteraction } from "./interaction-store";
import type { InteractionData } from "./types";

const logger = createLogger("CONVERSATION_PERSISTER");

export async function persistInteraction(
  data: InteractionData
): Promise<void> {
  try {
    await createInteraction(data);
    logger.info(
      `Persisted interaction ${data.messageId} (conversationId: ${data.conversationId || "none"})`
    );
  } catch (error) {
    logger.error("Failed to persist interaction", error);
    // Don't throw - persistence failure shouldn't block response
  }
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/persistence/conversation-persister.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/persistence/conversation-persister.ts
git commit -m "feat(persistence): add conversation persister

Add helper to persist interactions without blocking responses.
Logs errors but doesn't throw.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 12: Update Session Manager

**Files:**
- Modify: `apps/api/src/routes/v1/llm/persistence/session-manager.ts` (create new)

**Step 1: Create session manager**

Create `apps/api/src/routes/v1/llm/persistence/session-manager.ts`:

```typescript
import { createConversation } from "../conversation-store";
import type { BasicUIMessage } from "../messages";

export async function createSession(label?: string): Promise<{
  conversationId: string;
  createdAt: Date;
}> {
  // Create empty conversation (no messages)
  const emptyMessages: BasicUIMessage[] = [];
  const result = await createConversation(emptyMessages);

  // If label provided, we'd update it here
  // For now, conversation-store doesn't support label-only creation
  // This is fine - we're moving away from storing messages anyway

  return {
    conversationId: result.conversationId,
    createdAt: new Date(),
  };
}
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/persistence/session-manager.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/persistence/session-manager.ts
git commit -m "feat(persistence): add session manager

Add helper for creating conversation sessions (metadata only).

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 13: Update Stream Cache (messageId-based)

**Files:**
- Modify: `apps/api/src/routes/v1/llm/stream-service.ts` → `apps/api/src/routes/v1/llm/streaming/stream-cache.ts`

**Step 1: Copy and refactor stream-service.ts**

Copy `apps/api/src/routes/v1/llm/stream-service.ts` to `apps/api/src/routes/v1/llm/streaming/stream-cache.ts`

Then modify all functions to use `messageId` instead of `conversationId`:

```typescript
// Change function signatures and keys
function getStreamKey(messageId: string): string {
  return `llm:stream:${messageId}`;
}

function getMetadataKey(messageId: string): string {
  return `llm:stream:meta:${messageId}`;
}

function getCancellationKey(messageId: string): string {
  return `llm:stream:cancel:${messageId}`;
}

export interface StreamMetadata {
  messageId: string; // Changed from conversationId
  conversationId?: string; // Optional grouping
  status: StreamStatus;
  startedAt: string;
  completedAt?: string;
  error?: string;
  model?: string;
  totalChunks?: number;
}

// Update all function signatures
export async function initializeStream(
  messageId: string,
  conversationId: string | undefined,
  model: string
): Promise<void> { ... }

export async function writeChunk(messageId: string, chunk: string): Promise<void> { ... }

export async function completeStream(messageId: string): Promise<void> { ... }

// ... update all other functions similarly
```

**Step 2: Verify no syntax errors**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/streaming/stream-cache.ts
```

Expected: No errors

**Step 3: Commit**

```bash
git add apps/api/src/routes/v1/llm/streaming/stream-cache.ts
git commit -m "refactor(streaming): change from conversationId to messageId

Move stream-service.ts to streaming/stream-cache.ts and refactor
to use messageId as primary key. Enables concurrent requests in
same conversation.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 14: Initialize MongoDB Indexes

**Files:**
- Modify: `apps/api/src/index.ts`

**Step 1: Add index initialization on startup**

In `apps/api/src/index.ts`, add after MongoDB connection:

```typescript
import { createIndexes } from "./routes/v1/llm/persistence/interaction-store";

// After connecting to MongoDB
await createIndexes();
logger.info("MongoDB indexes created");
```

**Step 2: Test server starts**

Run:
```bash
bun --env-file ../../.env src/index.ts
```

Expected: Server starts, logs "MongoDB indexes created"

Press Ctrl+C to stop.

**Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: initialize MongoDB indexes on startup

Create indexes for interactions collection during server startup.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 15: Initialize MCP Manager on Startup

**Files:**
- Modify: `apps/api/src/index.ts`

**Step 1: Add MCP initialization**

In `apps/api/src/index.ts`, add:

```typescript
import { mcpManager } from "./routes/v1/llm/tools/mcp/mcp-manager";
import { config } from "./config";

// During startup (after MongoDB)
await mcpManager.initialize(config.mcp.servers);
logger.info("MCP manager initialized");

// On shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, cleaning up...");
  await mcpManager.cleanup();
  process.exit(0);
});
```

**Step 2: Test server starts**

Run:
```bash
bun --env-file ../../.env src/index.ts
```

Expected: Server starts, logs "MCP manager initialized"

**Step 3: Commit**

```bash
git add apps/api/src/index.ts
git commit -m "feat: initialize MCP manager on startup

Connect to configured MCP servers during startup and cleanup on
shutdown.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 16: Update Tool Registry with MCP Support

**Files:**
- Modify: `apps/api/src/routes/v1/llm/tools-registry.ts`

This is a large refactor. Key changes:

1. Add `async initialize()` method that calls `mcpManager.initialize()`
2. Update `listAllTools()` to include MCP tools
3. Update `getTool()` to check MCP tools (format: "server:tool")
4. Update `getOpenAITools()` to handle MCP tools

**Step 1: Review current tools-registry.ts**

Read the file and identify areas to modify.

**Step 2: Add MCP imports**

```typescript
import { mcpManager } from "./mcp/mcp-manager";
import { createMCPToolAdapter } from "./mcp/mcp-adapter";
```

**Step 3: Add initialize method**

```typescript
async initialize(): Promise<void> {
  // MCP manager is already initialized in index.ts
  // This method can be used for future registry setup
}
```

**Step 4: Update listAllTools**

```typescript
listAllTools(): Array<{ name: string; type: "native" | "mcp"; description?: string }> {
  const tools: Array<{ name: string; type: "native" | "mcp"; description?: string }> = [];

  // Native tools
  for (const [name, config] of this.nativeTools) {
    tools.push({ name, type: "native", description: config.description });
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
```

**Step 5: Update getTool**

```typescript
getTool(name: string, context: ToolContext): Tool | undefined {
  // Check native tools first
  const nativeConfig = this.nativeTools.get(name);
  if (nativeConfig) {
    return nativeConfig.definition(context);
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
```

**Step 6: Commit**

```bash
git add apps/api/src/routes/v1/llm/tools-registry.ts
git commit -m "feat(tools): add MCP support to registry

Update tool registry to discover and provide MCP tools alongside
native tools. Supports 'server:tool' naming format.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task 17: Refactor Handler (Part 1 - Validation)

**Files:**
- Modify: `apps/api/src/routes/v1/llm/handler.ts`

This is the most critical refactor. We'll do it in phases.

**Phase 1: Replace validation logic**

**Step 1: Add imports**

At top of handler.ts:

```typescript
import { validateRequestBody, validateTools } from "./validation/request-validator";
import { validateMessages, containsUserMessage } from "./validation/message-validator";
import { RequestValidationError } from "./validation/types";
```

**Step 2: Replace request body parsing**

Replace the manual parsing section (lines ~115-195) with:

```typescript
let validated;
try {
  validated = validateRequestBody(body);
} catch (error) {
  if (error instanceof RequestValidationError) {
    const response: ApiResponse = {
      success: false,
      error: {
        message: error.message,
        code: error.code,
        field: error.field,
      },
    };
    return Response.json(response, { status: 400 });
  }
  throw error;
}

const {
  messages: rawMessages,
  conversationId: conversationIdFromBody,
  model,
  modelParams,
  documentReferences,
  stream: streamRequested,
} = validated;

// Validate tools exist
const invalidTools = await validateTools(modelParams.tools, toolRegistry);
if (invalidTools.length > 0) {
  const response: ApiResponse = {
    success: false,
    error: {
      message: `Invalid tools: ${invalidTools.join(", ")}`,
      code: "INVALID_TOOLS",
      field: "modelParams.tools",
    },
  };
  return Response.json(response, { status: 400 });
}
```

**Step 3: Replace message validation**

Replace the message validation section with:

```typescript
const buildResult = buildMessagesFromBody({ messages: rawMessages });
if (!buildResult.success) {
  return Response.json(buildResult.response, { status: 400 });
}

const { messages: parsedRequestMessages } = buildResult;

let validatedMessages;
try {
  validatedMessages = await validateMessages(parsedRequestMessages);
} catch (error) {
  const response: ApiResponse = {
    success: false,
    error: {
      message: error instanceof Error ? error.message : "Invalid messages",
      code: "MESSAGE_VALIDATION_FAILED",
    },
  };
  return Response.json(response, { status: 400 });
}

if (!containsUserMessage(validatedMessages)) {
  const response: ApiResponse = {
    success: false,
    error: {
      message: "At least one user message is required",
      code: "MISSING_USER_MESSAGE",
    },
  };
  return Response.json(response, { status: 400 });
}
```

**Step 4: Test handler still compiles**

Run:
```bash
bunx tsc --noEmit apps/api/src/routes/v1/llm/handler.ts
```

Expected: No errors (some unused variable warnings OK)

**Step 5: Commit**

```bash
git add apps/api/src/routes/v1/llm/handler.ts
git commit -m "refactor(handler): use extracted validation modules

Replace inline validation with request-validator and message-validator
modules. First step in handler refactoring.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Next Steps

The plan continues with:

- Task 18-22: Continue refactoring handler (documents, tools, streaming, persistence)
- Task 23-25: Update stream routes to use messageId
- Task 26-28: Update conversation endpoints
- Task 29-30: Integration testing
- Task 31: Final cleanup and documentation

**Due to length constraints, stopping here. The remaining tasks follow the same pattern:**
1. Create/extract module
2. Verify compilation
3. Commit with descriptive message
4. Move to next component

---

## Testing Strategy

After implementation:

1. **Unit Tests** - Test each module independently
2. **Integration Tests** - Test full request flow
3. **MCP Tests** - Test with mock MCP server
4. **Load Tests** - Verify stateless scalability
5. **Migration Tests** - Test with existing data

---

## Rollback Plan

If issues arise:

1. Each task is atomic commit - can revert individually
2. Feature flag can disable new code path
3. Old handler preserved as reference
4. Database migrations are additive (new collection, old still works)

---

## Success Criteria

Implementation complete when:

- [ ] All modules extracted and tested
- [ ] Handler.ts < 200 lines
- [ ] MCP tools discoverable and callable
- [ ] MessageId-based streaming works
- [ ] Interactions collection populated correctly
- [ ] No regression in existing functionality
- [ ] Documentation updated

---

## Estimated Timeline

- Tasks 1-10: 3-4 hours (setup, validation, MCP, tools)
- Tasks 11-17: 3-4 hours (persistence, streaming, registry)
- Tasks 18-25: 4-5 hours (handler refactor, routes)
- Tasks 26-30: 2-3 hours (testing, cleanup)

**Total: 12-16 hours for complete implementation**
