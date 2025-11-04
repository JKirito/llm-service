import { createLogger } from "@llm-service/logger";
import { handleRequest } from "./router";
import { config } from "./config";
import { getDatabase } from "./lib/mongodb";
import { initializeRedis } from "@llm-service/redis";

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
