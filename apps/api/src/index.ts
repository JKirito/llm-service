import { createLogger } from "@llm-service/logger";
import { handleRequest } from "./router";
import { config } from "./config";
import { getDatabase } from "./lib/mongodb";

const logger = createLogger("API");

async function startServer(): Promise<void> {
  try {
    await getDatabase();
  } catch (error) {
    logger.error("Failed to establish initial MongoDB connection", error);
    throw error;
  }

  Bun.serve({
    port: config.server.port,
    hostname: config.server.host,
    fetch: handleRequest,
  });

  logger.info(
    `API server started on http://${config.server.host}:${config.server.port}`,
  );
}

startServer().catch((error) => {
  logger.error("Server failed to start", error);
  process.exit(1);
});
