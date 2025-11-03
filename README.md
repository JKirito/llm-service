# LLM Service Monorepo

A Bun-powered monorepo for LLM services and applications, providing a wrapper API around LLM models with document context, tool calling, and image generation capabilities.

## Structure

```
llm-service/
├── packages/              # Shared libraries
│   ├── azure-storage/     # Azure Blob Storage client
│   ├── logger/            # Logging utilities
│   ├── shared-utils/      # Common utilities
│   └── types/             # TypeScript type definitions
├── apps/                  # Applications
│   ├── api/               # API service
│   └── web-app/           # Web application
├── tools/                 # Development tools
├── docs/                  # Documentation
│   ├── API.md            # API documentation
│   ├── DOCKER.md         # Docker setup guide
│   └── TECH_STACK.md     # Tech stack overview
├── scripts/               # Build and utility scripts
└── bunfig.toml            # Bun configuration
```

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3.0
- MongoDB (or use Docker Compose)
- Azure Storage Account (for file storage)
- OpenAI API Key

### Installation

```bash
bun install
```

### Development

```bash
# Start API service in development mode
bun run dev:api

# Start all applications
bun run dev

# Build all packages and apps
bun run build
```

### Docker Setup

See [Docker Documentation](docs/DOCKER.md) for detailed setup instructions.

```bash
# Copy environment file
cp .env.example .env

# Edit .env with your credentials
# Then start services
docker-compose up -d
```

## Documentation

- **[API Documentation](docs/API.md)** - Complete API reference with examples
- **[Docker Setup](docs/DOCKER.md)** - Docker and Docker Compose guide
- **[Tech Stack](docs/TECH_STACK.md)** - Technologies and frameworks used

## Features

- ✅ **LLM Text Generation** - Generate text responses with OpenAI models
- ✅ **Streaming Support** - Real-time streaming responses via SSE
- ✅ **Document Context** - Upload and reference documents in LLM responses
- ✅ **Tool Calling** - Web search and extensible tool system
- ✅ **Image Generation** - DALL-E 3 image generation
- ✅ **Conversation Persistence** - MongoDB-based conversation storage
- ✅ **File Management** - Azure Blob Storage integration
- ✅ **Source Tracking** - Track sources from tools, documents, and more

## Tech Stack

- **Runtime**: Bun 1.3.1
- **AI Framework**: Vercel AI SDK v5
- **Database**: MongoDB 6.9.0
- **Storage**: Azure Blob Storage
- **Language**: TypeScript 5.5.0
- **Logging**: Winston 3.11.0

See [Tech Stack Documentation](docs/TECH_STACK.md) for complete details.

## API Endpoints

- `GET /api` - API status
- `GET /api/health` - Health check
- `POST /api/v1/llm/answers` - Generate text responses
- `POST /api/v1/llm/images` - Generate images
- `GET /api/v1/llm/tools` - List available tools
- `POST /api/v1/files/upload` - Upload files
- `GET /api/v1/files/download/:containerName/:fileName` - Download files
- `DELETE /api/v1/files/:containerName/:fileName` - Delete files
- `POST /api/v1/files/signed-url` - Generate signed URLs

See [API Documentation](docs/API.md) for complete endpoint reference.

## Workspace Scripts

- `bun run bootstrap` - Install dependencies for all workspaces
- `bun run build` - Build all packages and applications
- `bun run dev` - Start all applications in development mode
- `bun run dev:api` - Start API service only
- `bun run test` - Run tests across all workspaces
- `bun run lint` - Lint code across all workspaces
- `bun run typecheck` - Type check all packages
- `bun run clean` - Clean build artifacts and dependencies

## Configuration

- **Bun**: `bunfig.toml`
- **TypeScript**: `tsconfig.json` with project references
- **ESLint**: `eslint.config.js`
- **Environment**: `.env` file (see `.env.example`)

## License

Private project - All rights reserved.
