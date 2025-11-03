# Use Bun official image - match local version
FROM oven/bun:1.3.1 AS base

# Set working directory
WORKDIR /app

# Install dependencies into temp directory
# This will cache them and speed up future builds
FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json /temp/dev/
RUN mkdir -p /temp/dev/packages /temp/dev/apps /temp/dev/tools/placeholder
COPY packages/*/package.json /temp/dev/packages/
COPY apps/*/package.json /temp/dev/apps/
# Create minimal package.json in tools/placeholder to satisfy workspace reference
RUN echo '{"name":"tools-placeholder","version":"1.0.0","private":true}' > /temp/dev/tools/placeholder/package.json
# Install dependencies (Bun will create lockfile if needed)
RUN cd /temp/dev && bun install

# Install with --production (exclude devDependencies)
RUN mkdir -p /temp/prod
COPY package.json /temp/prod/
RUN mkdir -p /temp/prod/packages /temp/prod/apps /temp/prod/tools/placeholder
COPY packages/*/package.json /temp/prod/packages/
COPY apps/*/package.json /temp/prod/apps/
# Create minimal package.json in tools/placeholder to satisfy workspace reference
RUN echo '{"name":"tools-placeholder","version":"1.0.0","private":true}' > /temp/prod/tools/placeholder/package.json
# Copy lockfile from dev install to prod for consistency
RUN cp /temp/dev/bun.lockb /temp/prod/bun.lockb 2>/dev/null || true
# Install production dependencies (Bun will create lockfile if needed)
RUN cd /temp/prod && bun install --production

# Copy source code and build
FROM base AS prerelease
COPY --from=install /temp/dev/node_modules ./node_modules
COPY --from=install /temp/prod/node_modules /prod/node_modules

# Copy package.json files
COPY package.json ./
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.json ./

# Create tools placeholder directory for workspace
RUN mkdir -p tools/placeholder && echo '{"name":"tools-placeholder","version":"1.0.0","private":true}' > tools/placeholder/package.json

# Install workspace dependencies for building
RUN bun install

# Build packages first
RUN bun tsc --build packages/*/tsconfig.json

# Build apps directly (avoiding root build script which causes loops)
RUN cd apps/api && bun build ./src/index.ts --outdir ./dist --target bun
RUN cd apps/web-app && bun build ./src/index.ts --outdir ./dist --target bun

# Production image
FROM base AS release
WORKDIR /app

# Copy production dependencies
COPY --from=prerelease /prod/node_modules ./node_modules

# Copy built packages and their package.json files
COPY --from=prerelease /app/packages ./packages

# Copy built API app and its package.json
COPY --from=prerelease /app/apps/api ./apps/api

# Copy root package.json and bunfig (if exists)
COPY --from=prerelease /app/package.json ./
# Copy bunfig.toml only if it exists (optional)
RUN cp /app/bunfig.toml . 2>/dev/null || true

# Set environment variables
ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Expose port
EXPOSE 4000

# Run the API service
# Use the built file directly instead of start script (which expects .env file)
CMD ["bun", "apps/api/dist/index.js"]

