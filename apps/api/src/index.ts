import { createLogger } from "@llm-service/logger";
import { handleRequest } from "./router";
import { config } from "./config";
import { getDatabase } from "./lib/mongodb";
import { initializeRedis } from "@llm-service/redis";
import { createIndexes } from "./routes/v1/llm/persistence/interaction-store";
import { mcpManager } from "./routes/v1/llm/tools/mcp/mcp-manager";

const logger = createLogger("API");

async function startServer(): Promise<void> {
  try {
    // Initialize Redis connection
    initializeRedis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      lazyConnect: false,
    });

    logger.info(`Redis initialized: ${config.redis.host}:${config.redis.port}`);

    // Initialize MongoDB connection
    await getDatabase();

    // Create MongoDB indexes for interactions collection
    try {
      await createIndexes();
      logger.info("MongoDB indexes created successfully");
    } catch (indexError) {
      // Log error but don't crash the application
      logger.error("Failed to create MongoDB indexes, continuing startup", indexError);
    }

    // Initialize MCP manager (Model Context Protocol)
    try {
      await mcpManager.initialize(config.mcp.servers);
      logger.info("MCP manager initialized successfully");
    } catch (mcpError) {
      // Log error but don't crash the application
      logger.error("Failed to initialize MCP manager, continuing startup", mcpError);
    }
  } catch (error) {
    logger.error("Failed to establish initial database connections", error);
    throw error;
  }

  Bun.serve({
    port: config.server.port,
    hostname: config.server.host,
    fetch: handleRequest,
    idleTimeout: 250, // Maximum allowed timeout (255 seconds = ~4.25 minutes)
  });

  logger.info(
    `API server started on http://${config.server.host}:${config.server.port}`,
  );
}

startServer().catch((error) => {
  logger.error("Server failed to start", error);
  process.exit(1);
});

// Graceful shutdown handler
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, cleaning up...");
  try {
    await mcpManager.cleanup();
    logger.info("MCP manager cleaned up successfully");
  } catch (error) {
    logger.error("Error during MCP cleanup", error);
  }
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, cleaning up...");
  try {
    await mcpManager.cleanup();
    logger.info("MCP manager cleaned up successfully");
  } catch (error) {
    logger.error("Error during MCP cleanup", error);
  }
  process.exit(0);
});
