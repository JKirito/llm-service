import { createLogger } from "@llm-service/logger";

const logger = createLogger("CONFIG");

const requiredEnvVars = [
  "AZURE_STORAGE_CONNECTION_STRING",
  "OPENAI_API_KEY",
  "MONGODB_URI",
  "REDIS_HOST",
] as const;

type RequiredEnvVar = (typeof requiredEnvVars)[number];

function ensureEnv(name: RequiredEnvVar): string {
  const value = process.env[name];
  if (value && value.trim() !== "") {
    return value;
  }

  const message = `Missing required environment variable: ${name}`;
  logger.error(message);
  throw new Error(message);
}

const port = Number.parseInt(
  process.env.API_PORT || process.env.PORT || "4000",
  10,
);

if (Number.isNaN(port)) {
  const message =
    "Invalid port configuration. Ensure API_PORT or PORT is a valid number.";
  logger.error(message);
  throw new Error(message);
}

const host = process.env.HOST || "localhost";
const nodeEnv = process.env.NODE_ENV || "development";

const azureStorageConnectionString = ensureEnv(
  "AZURE_STORAGE_CONNECTION_STRING",
);
const openAiApiKey = ensureEnv("OPENAI_API_KEY");
const mongoDbUri = ensureEnv("MONGODB_URI");
const defaultOpenAiModel =
  process.env.OPENAI_MODEL && process.env.OPENAI_MODEL.trim() !== ""
    ? process.env.OPENAI_MODEL.trim()
    : "gpt-5-nano";
const mongoDbName =
  process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim() !== ""
    ? process.env.MONGODB_DB_NAME.trim()
    : "llm-service";

const imageContainerName =
  process.env.IMAGE_CONTAINER_NAME &&
  process.env.IMAGE_CONTAINER_NAME.trim() !== ""
    ? process.env.IMAGE_CONTAINER_NAME.trim()
    : "generated-images";

const redisHost = ensureEnv("REDIS_HOST");
const redisPort = Number.parseInt(process.env.REDIS_PORT || "6379", 10);
if (Number.isNaN(redisPort)) {
  const message =
    "Invalid Redis port configuration. Ensure REDIS_PORT is a valid number.";
  logger.error(message);
  throw new Error(message);
}
const redisPassword =
  process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== ""
    ? process.env.REDIS_PASSWORD.trim()
    : undefined;
const redisDb = Number.parseInt(process.env.REDIS_DB || "0", 10);
if (Number.isNaN(redisDb)) {
  const message =
    "Invalid Redis DB configuration. Ensure REDIS_DB is a valid number.";
  logger.error(message);
  throw new Error(message);
}

export const config = Object.freeze({
  nodeEnv,
  server: {
    port,
    host,
  },
  azure: {
    connectionString: azureStorageConnectionString,
  },
  openai: {
    apiKey: openAiApiKey,
    defaultModel: defaultOpenAiModel,
  },
  mongodb: {
    uri: mongoDbUri,
    dbName: mongoDbName,
  },
  images: {
    containerName: imageContainerName,
  },
  redis: {
    host: redisHost,
    port: redisPort,
    password: redisPassword,
    db: redisDb,
  },
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
});

export type AppConfig = typeof config;
