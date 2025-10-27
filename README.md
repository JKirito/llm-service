# LLM Service Monorepo

A Bun-powered monorepo for LLM services and applications.

## Structure

```
llm-service/
├── packages/          # Shared libraries
│   ├── shared-utils/  # Common utilities
│   ├── types/         # TypeScript type definitions
│   └── logger/        # Logging utilities
├── apps/              # Applications
│   ├── web-app/       # Web application
│   └── api/           # API service
├── tools/             # Development tools
│   └── eslint-config/ # Shared ESLint configuration
├── docs/              # Documentation
├── scripts/           # Build and utility scripts
└── bunfig.toml        # Bun configuration
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.1.0

### Installation

```bash
bun install
```

### Development

```bash
# Start all applications in development mode
bun run dev

# Start a specific application
bun run --filter="@llm-apps/web-app" dev

# Build all packages and apps
bun run build

# Run tests
bun run test

# Lint code
bun run lint

# Type checking
bun run typecheck
```

## Workspace Scripts

- `bun run bootstrap` - Install dependencies for all workspaces
- `bun run build` - Build all packages and applications
- `bun run dev` - Start all applications in development mode
- `bun run test` - Run tests across all workspaces
- `bun run lint` - Lint code across all workspaces
- `bun run clean` - Clean build artifacts and dependencies

## Adding New Packages

1. Create a new directory in `packages/`, `apps/`, or `tools/`
2. Add a `package.json` with the appropriate naming convention:
   - Packages: `@llm-service/package-name`
   - Apps: `@llm-apps/app-name`
   - Tools: `@llm-service/tool-name`
3. Add workspace dependencies using `workspace:*`
4. Update the root `tsconfig.json` references if needed

## Workspace Dependencies

Use `workspace:*` in package.json to reference other packages in the monorepo:

```json
{
  "dependencies": {
    "@llm-service/shared-utils": "workspace:*"
  }
}
```

## Configuration

- **Bun**: `bunfig.toml`
- **TypeScript**: `tsconfig.json` (root) with project references
- **ESLint**: Shared configuration in `tools/eslint-config`
- **Git**: `.gitignore` with monorepo-specific patterns
