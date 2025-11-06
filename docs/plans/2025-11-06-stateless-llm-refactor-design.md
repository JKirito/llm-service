# Stateless LLM Service Refactor Design

**Date:** 2025-11-06
**Status:** Approved
**Type:** Major Refactor

## Overview

Refactor the `/v1/llm/answers` endpoint and related infrastructure to be stateless, modular, and fully leverage the Vercel AI SDK capabilities. This refactor addresses architectural debt, improves maintainability, and enables better scalability.

## Goals

1. **Stateless Architecture** - Server never fetches conversation history; clients send full message context
2. **Modular Codebase** - Break monolithic 1167-line handler into reusable, testable components
3. **AI SDK Best Practices** - Fully utilize AI SDK patterns and capabilities
4. **MCP Support** - Enable extensibility through Model Context Protocol integration
5. **Better Streaming** - Use messageId-based streaming instead of conversationId for concurrency

## Current Problems

### Architecture Issues
- **Stateful Design**: Server fetches conversation history from MongoDB, making it stateful
- **Monolithic Handler**: 1167 lines in `handler.ts` with mixed responsibilities
- **Inline Tools**: 200+ line `generate_image` tool embedded in handler
- **Hard to Test**: Tightly coupled code makes unit testing difficult
- **No MCP Support**: Can't leverage external tools/capabilities

### Scaling Limitations
- **Conversation Lock**: Only one request per conversationId can stream at a time (Redis key collision)
- **Database Dependency**: Every request requires MongoDB read, adding latency
- **Session Affinity**: Stateful design requires sticky sessions for load balancing

---

## New Architecture

### 1. API Design

#### Request Format

**POST `/v1/llm/answers`**

```typescript
{
  // Full message history (client-managed state)
  messages: [
    {
      id: "msg-uuid-1",
      role: "user",
      parts: [{type: "text", text: "What is TypeScript?"}]
    },
    {
      id: "msg-uuid-2",
      role: "assistant",
      parts: [{type: "text", text: "TypeScript is..."}]
    }
  ],

  // Optional: Links to conversation for persistence
  conversationId?: "conv-uuid",

  // Model selection
  model: "gpt-4o",

  // Unified model parameters (replaces separate reasoningEffort, tools, etc.)
  modelParams: {
    tools?: ["web_search", "code_interpreter", "github:create_issue"],
    reasoningEffort?: "low" | "medium" | "high",
    temperature?: number,
    includeSearch?: boolean
  },

  // Document references (unchanged)
  documentReferences?: ["container/file.pdf"],

  // Streaming flag
  stream?: boolean
}
```

#### Response Formats

**Streaming Response (SSE):**
```typescript
// Headers
X-Message-Id: msg-uuid-4
X-Conversation-Id: conv-uuid (if provided)

// Body: AI SDK SSE stream
data: 0:"text-delta"
data: 0:"Hello"
data: 0:"text-delta"
data: 0:" world"
...
```

**Non-Streaming Response:**
```typescript
{
  success: true,
  data: {
    messageId: "msg-uuid-4",
    conversationId?: "conv-uuid",
    message: {
      id: "msg-uuid-4",
      role: "assistant",
      parts: [{type: "text", text: "..."}],
      metadata: {
        model: "gpt-4o",
        usage: {...}
      }
    },
    usage: {...},
    sources?: [...]
  }
}
```

#### Session Management

**POST `/v1/llm/conversations`** - Create new conversation session
```typescript
// Request
{
  label?: "My conversation about TypeScript"
}

// Response
{
  success: true,
  data: {
    conversationId: "conv-uuid",
    createdAt: "2025-11-06T..."
  }
}
```

**GET `/v1/llm/conversations`** - List conversations (unchanged)

**GET `/v1/llm/conversations/:id`** - Get conversation interactions

**DELETE `/v1/llm/conversations/:id`** - Delete conversation

---

### 2. Database Schema

#### Conversations Collection (Modified)
```typescript
{
  _id: string,              // conversationId
  label?: string,           // User-provided label
  createdAt: Date,
  updatedAt: Date
  // NO messages array - just metadata
}
```

#### Interactions Collection (New)
```typescript
{
  _id: string,                      // Auto-generated
  conversationId?: string,          // Optional link to conversation
  messageId: string,                // Assistant message ID (unique)
  model: string,

  // Request context
  requestMessages: BasicUIMessage[],  // Full history sent by client

  // Response
  responseMessage: BasicUIMessage,    // Assistant's response

  // Metadata
  usage?: {
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    reasoningTokens?: number,
    cachedTokens?: number
  },
  sources?: MessageSource[],
  imageReferences?: ImageReference[],
  documentReferences?: string[],

  // Timestamps
  createdAt: Date,
  completedAt: Date,
  duration?: number,

  // Streaming info
  wasStreamed: boolean,
  streamMessageId?: string
}
```

**Benefits:**
- Each interaction is independent (true stateless)
- Easy to query by conversationId for history
- Scalable - can shard by date or conversationId
- Complete audit trail of all interactions
- Simple analytics queries

**Indexes:**
```typescript
interactions.createIndex({ conversationId: 1, createdAt: 1 })
interactions.createIndex({ messageId: 1 }, { unique: true })
interactions.createIndex({ createdAt: -1 })
```

---

### 3. Modular File Structure

```
apps/api/src/routes/v1/llm/
├── handler.ts                          # Main orchestrator (50-100 lines)
├── types.ts                            # Shared types
│
├── validation/
│   ├── request-validator.ts            # Request parsing, modelParams validation
│   └── message-validator.ts            # Message array validation
│
├── tools/
│   ├── registry.ts                     # Enhanced tool registry with MCP
│   ├── types.ts                        # Tool types
│   ├── definitions/
│   │   ├── image-generator.ts          # generate_image tool (extracted)
│   │   ├── code-interpreter.ts         # code_interpreter tool
│   │   └── web-search.ts               # web_search tool
│   └── mcp/
│       ├── mcp-manager.ts              # MCP server connection management
│       └── mcp-adapter.ts              # Convert MCP tools to AI SDK tools
│
├── documents/
│   ├── document-processor.ts           # Orchestrates document processing
│   ├── azure-downloader.ts             # Azure Storage download logic
│   └── openai-uploader.ts              # OpenAI Files API upload logic
│
├── streaming/
│   ├── stream-orchestrator.ts          # AI SDK streaming handler
│   ├── stream-cache.ts                 # Redis caching (refactored)
│   └── stream-types.ts                 # Streaming types
│
├── generation/
│   ├── text-generator.ts               # Non-streaming generation
│   └── model-factory.ts                # Model instance creation
│
├── persistence/
│   ├── conversation-persister.ts       # Save interactions to MongoDB
│   └── session-manager.ts              # Create conversation sessions
│
├── system-prompt-builder.ts            # Existing (unchanged)
├── messages.ts                         # Existing (unchanged)
├── conversation-store.ts               # Legacy (may deprecate)
├── conversations.ts                    # Existing conversation endpoints
├── images.ts                           # Existing (may deprecate)
├── tools.ts                            # Tool listing endpoint
├── stream-routes.ts                    # Stream subscription endpoints
└── index.ts                            # Route registration
```

**Key Principles:**
1. **Single Responsibility** - Each file has one clear purpose
2. **Dependency Injection** - Components receive dependencies (writer, config, etc.)
3. **Testability** - Pure functions, mockable dependencies
4. **Reusability** - Components used across multiple endpoints

---

### 4. Request Flow

```
Client Request
   ↓
[1] Validate Request Body
    - validateRequestBody()
    - parseModelParams()
    - Check tools exist
   ↓
[2] Validate Messages
    - validateMessages()
    - containsUserMessage()
   ↓
[3] Process Documents (if any)
    - downloadFromAzure()
    - uploadToOpenAI() (if code_interpreter)
    - parseContent()
   ↓
[4] Build System Prompt
    - SystemPromptBuilder.build()
    - Inject document contexts
    - Add tool instructions
   ↓
[5] Create Model Instance
    - modelFactory.create()
    - Select openai() vs openai.responses()
   ↓
[6] Generate Assistant Message ID
    - messageId = crypto.randomUUID()
   ↓
[7] Branch: Streaming or Non-Streaming
   ↓
   ┌───────────────────────┬───────────────────────┐
   │                       │                       │
[8a] STREAMING            [8b] NON-STREAMING
    - initializeStream()       - generateText()
    - streamOrchestrator()     - Extract response
    - Cache to Redis
    - Stream to client
   ↓                       ↓
[9] Persist to MongoDB
    - persistInteraction()
    - Save full request + response
   ↓
[10] Return Response
    - Streaming: X-Message-Id header + SSE
    - Non-Streaming: JSON with messageId
```

---

### 5. Streaming Implementation

#### Key Changes

**Old Approach:**
- Stream key: `llm:stream:${conversationId}`
- Problem: Only one active request per conversation

**New Approach:**
- Stream key: `llm:stream:${messageId}`
- Benefit: Multiple concurrent requests in same conversation

#### Stream Lifecycle

```
1. Generate messageId for assistant response
   ↓
2. Initialize Redis stream: llm:stream:{messageId}
   ↓
3. Return response with headers:
   X-Message-Id: {messageId}
   X-Conversation-Id: {conversationId}
   ↓
4. Start AI SDK streaming
   ↓
5. Parallel operations:
   ├─→ Stream chunks to client (SSE)
   ├─→ Cache chunks to Redis (side effect)
   └─→ Capture for persistence
   ↓
6. On completion:
   ├─→ Mark Redis stream complete (TTL: 1 hour)
   ├─→ Persist interaction to MongoDB
   └─→ Close stream
```

#### Stream Endpoints

**GET `/v1/llm/stream/status/:messageId`**
- Check generation status
- Returns: streaming | completed | error | cancelled

**POST `/v1/llm/stream/cancel/:messageId`**
- Cancel ongoing generation
- Sets cancellation flag in Redis

**GET `/v1/llm/stream/subscribe/:messageId`**
- Subscribe to existing stream (reconnection)
- Replays from Redis cache
- Use case: Client disconnected, wants to resume

#### StreamMetadata (Updated)
```typescript
interface StreamMetadata {
  messageId: string,           // Changed from conversationId
  conversationId?: string,     // Optional grouping
  status: "streaming" | "completed" | "error" | "cancelled",
  model: string,
  startedAt: string,
  completedAt?: string,
  totalChunks?: number
}
```

---

### 6. MCP Integration

#### Architecture

**MCP Manager** (`tools/mcp/mcp-manager.ts`):
- Connects to configured MCP servers (stdio or SSE)
- Discovers available tools from each server
- Manages tool execution routing
- Handles server lifecycle

**MCP Adapter** (`tools/mcp/mcp-adapter.ts`):
- Converts MCP tools to AI SDK tool format
- Translates JSON Schema to Zod schema
- Handles tool execution and error handling

#### Configuration

**config.ts:**
```typescript
export const config = {
  // ... existing config
  mcp: {
    servers: [
      {
        name: "filesystem",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/allowed/path"],
        enabled: true
      },
      {
        name: "github",
        type: "sse",
        url: "http://localhost:3001/sse",
        enabled: true
      },
      {
        name: "brave-search",
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-brave-search"],
        env: { BRAVE_API_KEY: process.env.BRAVE_API_KEY },
        enabled: !!process.env.BRAVE_API_KEY
      }
    ]
  }
}
```

#### Tool Naming Convention

**Native tools:** Simple name
- `web_search`
- `code_interpreter`
- `generate_image`

**MCP tools:** `{server}:{tool}` format
- `github:create_issue`
- `github:list_repos`
- `filesystem:read_file`
- `brave-search:search`

#### Request Example
```typescript
{
  messages: [...],
  model: "gpt-4o",
  modelParams: {
    tools: [
      "web_search",              // Native
      "generate_image",          // Native
      "github:create_issue",     // MCP (github server)
      "filesystem:read_file"     // MCP (filesystem server)
    ]
  }
}
```

#### Enhanced Tool Registry

```typescript
class ToolRegistry {
  private nativeTools: Map<string, ToolConfig>;

  async initialize() {
    // Connect to all MCP servers
    await mcpManager.initialize(config.mcp.servers);
  }

  listAllTools(): Array<{name: string, type: "native" | "mcp"}> {
    // Returns both native and MCP tools
  }

  getTool(name: string, context: ToolContext): Tool | undefined {
    // Check native first, then MCP
    // Handles both "tool_name" and "server:tool" formats
  }
}
```

#### Initialization

**app startup (index.ts):**
```typescript
import { toolRegistry } from "./routes/v1/llm/tools/registry";
import { mcpManager } from "./routes/v1/llm/tools/mcp/mcp-manager";

// On startup
await toolRegistry.initialize();  // Connects to MCP servers

// On shutdown
await mcpManager.cleanup();  // Graceful MCP disconnect
```

---

### 7. Error Handling

#### Error Types

**RequestValidationError:**
```typescript
{
  success: false,
  error: {
    message: "messages array is required and must not be empty",
    code: "MISSING_MESSAGES",
    field: "messages"
  }
}
```

**Tool Validation Error:**
```typescript
{
  success: false,
  error: {
    message: "Invalid tools: unknown_tool, invalid_mcp_server:tool",
    code: "INVALID_TOOLS",
    field: "modelParams.tools",
    details: {
      invalid: ["unknown_tool", "invalid_mcp_server:tool"]
    }
  }
}
```

**Document Processing Error:**
```typescript
{
  success: false,
  error: {
    message: "Failed to process document",
    code: "DOCUMENT_PROCESSING_FAILED",
    field: "documentReferences[0]",
    details: {
      document: "container/file.pdf",
      reason: "File not found in Azure Storage"
    }
  }
}
```

**AI Provider Error:**
```typescript
{
  success: false,
  error: {
    message: "AI provider error",
    code: "AI_PROVIDER_ERROR",
    details: {
      provider: "openai",
      statusCode: 429,
      message: "Rate limit exceeded"
    }
  }
}
```

#### Error Handler Pattern

```typescript
// handler.ts
try {
  const validated = validateRequestBody(body);
  // ... process request
} catch (error) {
  return handleError(error);
}

function handleError(error: unknown): Response {
  if (error instanceof RequestValidationError) {
    return Response.json({...}, { status: 400 });
  }

  if (error instanceof TypeValidationError) {
    return Response.json({...}, { status: 400 });
  }

  if (error.name === "AI_APICallError") {
    return Response.json({...}, { status: 502 });
  }

  // Generic fallback
  logger.error("Unhandled error", error);
  return Response.json({
    success: false,
    error: {
      message: "Internal server error",
      code: "INTERNAL_ERROR"
    }
  }, { status: 500 });
}
```

---

## Component Details

### validation/request-validator.ts

**Responsibilities:**
- Parse and validate request body structure
- Extract and validate modelParams
- Validate tool names (check registry)
- Validate conversationId format
- Validate documentReferences format

**Key Functions:**
```typescript
validateRequestBody(body: unknown): ValidatedRequest
parseModelParams(params: unknown): ModelParams
validateTools(tools: string[]): Promise<string[]>
```

### validation/message-validator.ts

**Responsibilities:**
- Validate message array structure
- Ensure at least one user message
- Validate message roles and parts
- Generate message IDs if missing

**Key Functions:**
```typescript
validateMessages(messages: unknown[]): BasicUIMessage[]
containsUserMessage(messages: BasicUIMessage[]): boolean
```

### tools/definitions/image-generator.ts

**Responsibilities:**
- Define generate_image tool schema
- Handle image generation via AI SDK
- Upload images to Azure Storage
- Stream progress updates to client
- Return image URLs and metadata

**Key Functions:**
```typescript
createImageGenerationTool(writer: StreamWriter, config: ServerConfig): Tool
```

**Tool Schema:**
```typescript
{
  prompt: string,
  n: number (1-4),
  size: "1024x1024" | "1792x1024" | "1024x1792",
  quality: "standard" | "hd",
  style: "vivid" | "natural",
  seed?: number
}
```

### tools/mcp/mcp-manager.ts

**Responsibilities:**
- Connect to configured MCP servers (stdio/SSE)
- Discover available tools from each server
- Route tool execution to correct server
- Handle server errors and reconnection
- Manage server lifecycle

**Key Functions:**
```typescript
initialize(servers: MCPServerConfig[]): Promise<void>
listAvailableTools(): MCPToolInfo[]
executeTool(toolKey: string, args: Record<string, unknown>): Promise<unknown>
cleanup(): Promise<void>
```

### tools/mcp/mcp-adapter.ts

**Responsibilities:**
- Convert MCP JSON Schema to Zod schema
- Wrap MCP tools in AI SDK tool format
- Handle tool execution and error translation

**Key Functions:**
```typescript
createMCPToolAdapter(toolKey: string): Tool
convertJsonSchemaToZod(jsonSchema: unknown): z.ZodType
```

### documents/document-processor.ts

**Responsibilities:**
- Orchestrate document processing pipeline
- Download from Azure Storage
- Upload to OpenAI Files API (if code_interpreter)
- Parse document content for system prompt
- Generate file references for messages

**Key Functions:**
```typescript
processDocuments(
  refs: string[],
  needsCodeInterpreter: boolean
): Promise<{
  documentContexts: DocumentContext[],
  fileReferences: MessageFileReference[],
  openAIFileIds: string[]
}>
```

### streaming/stream-orchestrator.ts

**Responsibilities:**
- Initialize Redis stream with messageId
- Create AI SDK stream with tools
- Merge native and MCP tools
- Stream to client via SSE
- Cache chunks to Redis (side effect)
- Capture usage, sources, images for persistence
- Handle errors and cancellation

**Key Functions:**
```typescript
handleStreamingRequest(config: StreamConfig): Promise<Response>
```

**StreamConfig:**
```typescript
interface StreamConfig {
  messageId: string,
  conversationId?: string,
  model: ModelInstance,
  messages: CoreMessage[],
  tools: Record<string, Tool>,
  temperature?: number,
  reasoningEffort?: string,
  request: Request  // For AbortSignal
}
```

### generation/text-generator.ts

**Responsibilities:**
- Handle non-streaming generation
- Call AI SDK generateText()
- Extract response, usage, sources
- Format response message

**Key Functions:**
```typescript
generateTextResponse(config: GenerationConfig): Promise<GenerateTextResult>
```

### persistence/conversation-persister.ts

**Responsibilities:**
- Save interaction to MongoDB
- Build complete interaction document
- Handle both streaming and non-streaming
- Don't block response on persistence failure

**Key Functions:**
```typescript
persistInteraction(data: InteractionData): Promise<void>
```

**InteractionData:**
```typescript
interface InteractionData {
  conversationId?: string,
  messageId: string,
  model: string,
  requestMessages: BasicUIMessage[],
  responseMessage: BasicUIMessage,
  usage?: Record<string, unknown>,
  sources?: MessageSource[],
  imageReferences?: ImageReference[],
  documentReferences?: string[],
  wasStreamed: boolean,
  duration?: number
}
```

### persistence/session-manager.ts

**Responsibilities:**
- Create new conversation sessions
- Generate conversationId
- Store minimal metadata in conversations collection

**Key Functions:**
```typescript
createSession(label?: string): Promise<{
  conversationId: string,
  createdAt: Date
}>
```

---

## Migration Strategy

### Phase 1: Preparation
1. Create new file structure
2. Set up MCP dependencies (`@modelcontextprotocol/sdk`)
3. Create new MongoDB collection: `interactions`
4. Add indexes to `interactions`

### Phase 2: Extract Components
1. Extract validation logic → `validation/`
2. Extract tool definitions → `tools/definitions/`
3. Implement MCP support → `tools/mcp/`
4. Update tool registry
5. Extract document processing → `documents/`
6. Extract streaming logic → `streaming/`
7. Extract generation logic → `generation/`
8. Extract persistence logic → `persistence/`

### Phase 3: Update Handler
1. Refactor `handler.ts` to use new components
2. Update request/response formats
3. Change from conversationId to messageId for streaming
4. Remove MongoDB history fetching
5. Add interaction persistence

### Phase 4: Update Stream Service
1. Refactor `stream-service.ts` → `stream-cache.ts`
2. Change keys from conversationId to messageId
3. Update stream endpoints in `stream-routes.ts`

### Phase 5: Testing
1. Unit test each component
2. Integration test full flow
3. Test MCP integration
4. Test streaming with messageId
5. Load test stateless architecture

### Phase 6: Deployment
1. Deploy with feature flag (gradual rollout)
2. Monitor performance and errors
3. Migrate existing conversations if needed
4. Full cutover

---

## Benefits

### Scalability
- **True Stateless** - Any server can handle any request
- **No Session Affinity** - Simple load balancing
- **Concurrent Streams** - Multiple requests per conversation
- **Database Efficiency** - No reads during generation, only writes

### Maintainability
- **Modular Code** - 50-100 line files vs 1167 line monolith
- **Single Responsibility** - Each component has one job
- **Testability** - Pure functions, mockable dependencies
- **Reusability** - Components used across endpoints

### Extensibility
- **MCP Support** - Add external tools without code changes
- **Tool Isolation** - Easy to add/modify/remove tools
- **Clear Interfaces** - Well-defined component boundaries

### Developer Experience
- **Type Safety** - Strict TypeScript throughout
- **Error Messages** - Detailed validation errors with field names
- **Documentation** - Self-documenting code structure
- **Debugging** - Isolated components easier to debug

---

## Risks & Mitigations

### Risk: Client Message History Management
**Impact:** Clients must maintain full conversation history
**Mitigation:** Provide client SDK helpers; document best practices; optionally offer conversation history endpoint

### Risk: MCP Server Failures
**Impact:** Tools become unavailable if MCP server crashes
**Mitigation:** Graceful degradation; return available tools only; retry logic; health checks

### Risk: Large Message Arrays
**Impact:** Huge payloads if conversations are very long
**Mitigation:** Document message limits; implement request size limits; provide message pruning guidance

### Risk: Migration Complexity
**Impact:** Breaking changes to existing API
**Mitigation:** This is acceptable - starting from scratch per requirements; can maintain old endpoint during transition if needed

### Risk: Redis Key Collision (messageId)
**Impact:** Unlikely but possible UUID collision
**Mitigation:** Use crypto.randomUUID() (effectively zero collision probability); validate uniqueness before stream init

---

## Success Metrics

### Performance
- Response latency < 200ms (before LLM generation)
- Streaming first chunk < 500ms
- Database write time < 100ms (async, non-blocking)

### Reliability
- 99.9% success rate for valid requests
- MCP server failures don't crash main service
- Graceful error messages for all failure modes

### Code Quality
- Average file size < 200 lines
- Test coverage > 80%
- Zero circular dependencies
- All functions < 50 lines

---

## Future Enhancements

### Short Term
1. Client SDK for message management
2. Message compression for large histories
3. Conversation history API endpoint (GET /conversations/:id/messages)
4. More MCP server integrations

### Long Term
1. Prompt caching (AI SDK supports this)
2. Multi-modal message support (images in user messages)
3. Agent workflows with multi-step reasoning
4. Real-time collaboration on conversations

---

## Conclusion

This refactor transforms the LLM service from a stateful monolith to a modular, stateless architecture that fully leverages the Vercel AI SDK and enables extensibility through MCP. The design prioritizes scalability, maintainability, and developer experience while maintaining all existing functionality.

The modular structure makes it easy to test, modify, and extend individual components without affecting the entire system. MCP integration provides a standardized way to add new capabilities without code changes. The messageId-based streaming eliminates concurrency limitations and simplifies the client-server interaction model.

This design is ready for implementation.
