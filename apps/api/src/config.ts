import { createLogger } from "@llm-service/logger";

const logger = createLogger("CONFIG");

const requiredEnvVars = [
  "AZURE_STORAGE_CONNECTION_STRING",
  "OPENAI_API_KEY",
  "MONGODB_URI",
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
});

export type AppConfig = typeof config;
