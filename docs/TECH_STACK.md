# Tech Stack

This document provides an overview of the technologies, frameworks, and libraries used in the LLM Service.

## Runtime & Language

### Bun 1.3.x
- **Version**: 1.3.1
- **Purpose**: JavaScript runtime, bundler, test runner, and package manager
- **Why Bun**: 
  - Fast execution and startup times
  - Native TypeScript support
  - Built-in bundler and test runner
  - Web API compatibility (fetch, WebSocket, etc.)
  - Native support for ESM modules

## Core Framework

### Vercel AI SDK v5
- **Version**: ^5.0.68
- **Purpose**: Core framework for LLM interactions
- **Features Used**:
  - `generateText` - Non-streaming text generation
  - `streamText` - Streaming text generation
  - `experimental_generateImage` - Image generation (DALL-E 3)
  - `createUIMessageStream` - UI message streaming
  - `createUIMessageStreamResponse` - SSE response streaming
  - `convertToModelMessages` - Message format conversion
  - `validateUIMessages` - Message validation
  - Tool calling support
  - Source extraction from Responses API

### OpenAI Provider (@ai-sdk/openai)
- **Version**: ^2.0.56
- **Purpose**: OpenAI integration for AI SDK
- **Features Used**:
  - `openai()` - Standard Chat API
  - `openai.responses()` - Responses API (for tool calling)
  - `openai.image('dall-e-3')` - DALL-E 3 image generation
  - `openai.tools.webSearchPreview` - Web search tool

## Database

### MongoDB
- **Version**: ^6.9.0
- **Purpose**: Persistent storage for conversations and messages
- **Usage**:
  - Storing conversation history
  - Message persistence with metadata
  - File and image references
  - Tool sources tracking

## Storage

### Azure Blob Storage
- **SDK Version**: @azure/storage-blob ^12.17.0
- **Purpose**: File and image storage
- **Features Used**:
  - File upload/download
  - Container management
  - SAS token generation for secure access
  - Metadata storage
- **Containers**:
  - `documents` - User uploaded documents
  - `generated-images` - DALL-E 3 generated images

## Type System

### TypeScript
- **Version**: ^5.5.0
- **Configuration**:
  - Strict mode enabled
  - ES2022 target
  - ESNext modules
  - Project references for monorepo
- **Path Aliases**:
  - `@llm-service/*` → `packages/*/src`
  - `@llm-apps/*` → `apps/*/src`

## Logging

### Winston
- **Version**: ^3.11.0
- **Purpose**: Structured logging
- **Usage**: Custom logger package (`@llm-service/logger`)
- **Features**:
  - Multiple log levels (debug, info, warn, error)
  - Context-based logging
  - Timestamp formatting

## Code Quality

### ESLint
- **Version**: ^9.0.0
- **Plugins**:
  - `@typescript-eslint/eslint-plugin` ^7.0.0
  - `@typescript-eslint/parser` ^7.0.0
  - `eslint-plugin-prettier` ^5.5.4
- **Config**: `eslint-config-prettier` ^9.1.2

### Prettier
- **Version**: ^3.6.2
- **Purpose**: Code formatting

## Architecture

### Monorepo Structure
The project uses Bun workspaces for managing multiple packages:

```
llm-service/
├── packages/              # Shared libraries
│   ├── azure-storage/     # Azure Blob Storage client
│   ├── logger/            # Winston-based logging
│   ├── shared-utils/      # Common utilities
│   └── types/             # TypeScript type definitions
├── apps/                  # Applications
│   ├── api/               # Main API service
│   └── web-app/           # Web application
└── tools/                 # Development tools
```

### Package Naming Convention
- **Shared Packages**: `@llm-service/package-name`
- **Applications**: `@llm-apps/app-name`

## API Framework

### Bun.serve
- **Purpose**: Built-in HTTP server
- **Features**:
  - Native fetch API compatibility
  - WebSocket support
  - Streaming support
  - High performance

### Custom Router
- **Purpose**: Lightweight routing system
- **Features**:
  - Path parameter extraction
  - Method-based routing
  - Middleware support

## Development Tools

### Bun Built-in Tools
- **Bundler**: `bun build` for production builds
- **Test Runner**: `bun test` for testing
- **Package Manager**: `bun install` with workspace support
- **Hot Reload**: `bun --watch` for development

## Infrastructure

### Docker
- **Base Image**: `oven/bun:1.3.1`
- **Orchestration**: Docker Compose
- **Services**:
  - API service (Bun)
  - MongoDB 7.0

### Environment Configuration
- **Format**: `.env` files
- **Required Variables**:
  - `AZURE_STORAGE_CONNECTION_STRING`
  - `OPENAI_API_KEY`
  - `MONGODB_URI`
- **Optional Variables**:
  - `OPENAI_MODEL` (default: `gpt-5-nano`)
  - `MONGODB_DB_NAME` (default: `llm-service`)
  - `IMAGE_CONTAINER_NAME` (default: `generated-images`)
  - `API_PORT` (default: `4000`)

## Key Design Decisions

### 1. Relative Path Storage
- Files and images are stored using relative paths (`containerName/filePath`)
- URLs are generated dynamically to avoid migration issues
- Enables easy switching between storage providers

### 2. Generic Source System
- `MessageSource` interface supports multiple source types:
  - Tools (web_search)
  - RAG (future)
  - MCP (future)
  - Documents
  - Other sources
- Extensible with `sourceOrigin` and `sourceProvider` fields

### 3. Tool Registry Pattern
- Centralized tool management
- User-facing names mapped to OpenAI tool names
- Supports both Chat API and Responses API
- Easy to add new tools

### 4. Conversation Persistence
- All conversations stored in MongoDB
- Messages include metadata (usage, file references, image references, sources)
- Supports conversation continuation via `conversationId`

### 5. System Prompt Builder
- Dynamic system message construction
- Supports document context injection
- Tool instructions
- Custom instructions
- Hidden from users (only in system message)

## Performance Considerations

- **Bun Runtime**: Fast JavaScript execution
- **Streaming Support**: Server-Sent Events for real-time responses
- **Multi-stage Docker Builds**: Optimized image sizes
- **Workspace Dependencies**: Efficient monorepo builds

## Security

- **SAS Tokens**: Time-limited signed URLs for file access
- **Environment Variables**: Sensitive data in `.env` files
- **Input Validation**: Request validation at API boundaries
- **Error Handling**: Proper error messages without exposing internals

## Future Considerations

- **RAG Integration**: Vector search for document retrieval
- **MCP Support**: Model Context Protocol integration
- **Authentication**: User authentication and authorization
- **Rate Limiting**: API rate limiting middleware
- **Caching**: Response caching for frequently accessed data

