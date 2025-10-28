import { createLogger } from "@llm-service/logger";
import type { ApiResponse } from "@llm-service/types";
import { formatMessage } from "@llm-service/shared-utils";

const logger = createLogger("API");

const port = parseInt(process.env.API_PORT || process.env.PORT || "4000");
const host = process.env.HOST || "localhost";

Bun.serve({
  port,
  hostname: host,
  fetch(req: Request) {
    const url = new URL(req.url);

    logger.info(`${req.method} ${url.pathname}`);

    switch (url.pathname) {
      case "/":
        const response: ApiResponse = {
          success: true,
          message: "LLM Service API is running",
        };
        return Response.json(response);

      case "/health":
        return Response.json({
          status: "ok",
          timestamp: new Date().toISOString(),
        });

      case "/api/users":
        logger.info("Fetching users");
        const usersResponse: ApiResponse = {
          success: true,
          data: [],
          message: "Users retrieved successfully",
        };
        return Response.json(usersResponse);

      default:
        return new Response("Not Found", { status: 404 });
    }
  },
});

logger.info(formatMessage(`API server started on http://${host}:${port}`));
