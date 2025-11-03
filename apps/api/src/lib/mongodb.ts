import { MongoClient, type Db } from "mongodb";
import { createLogger } from "@llm-service/logger";
import { config } from "../config";

const logger = createLogger("MONGODB");

let client: MongoClient | null = null;
let database: Db | null = null;

async function connectClient(): Promise<MongoClient> {
  if (client) {
    return client;
  }

  client = new MongoClient(config.mongodb.uri);
  await client.connect();
  logger.info(`Connected to MongoDB database ${config.mongodb.dbName}`);

  return client;
}

export async function getDatabase(): Promise<Db> {
  if (database) {
    return database;
  }

  const mongoClient = await connectClient();
  database = mongoClient.db(config.mongodb.dbName);
  return database;
}
