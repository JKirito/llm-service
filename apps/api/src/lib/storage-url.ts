import { getFileUrl, generateSignedUrl } from "@llm-service/azure-storage";
import { initializeAzureStorage } from "@llm-service/azure-storage";
import { config } from "../config";

// Initialize Azure Storage if not already initialized
let azureStorageInitialized = false;
function ensureAzureStorage(): void {
  if (!azureStorageInitialized) {
    initializeAzureStorage(config.azure.connectionString);
    azureStorageInitialized = true;
  }
}

/**
 * Generates a full URL from a relative path (containerName/filePath)
 * This allows switching storage providers without database migration
 * 
 * @param relativePath - Path in format "containerName/filePath" or "containerName/path/to/file"
 * @returns Full URL to the file
 */
export function getFileUrlFromPath(relativePath: string): string {
  ensureAzureStorage();
  const [containerName, ...pathParts] = relativePath.split("/");
  const filePath = pathParts.join("/");
  return getFileUrl(containerName, filePath);
}

/**
 * Generates a signed URL (SAS token) from a relative path
 * 
 * @param relativePath - Path in format "containerName/filePath" or "containerName/path/to/file"
 * @param expiresInMinutes - Expiration time in minutes (default: 60)
 * @returns Signed URL with SAS token
 */
export function getSignedUrlFromPath(
  relativePath: string,
  expiresInMinutes: number = 60,
): string {
  ensureAzureStorage();
  const [containerName, ...pathParts] = relativePath.split("/");
  const filePath = pathParts.join("/");
  return generateSignedUrl(containerName, filePath, expiresInMinutes);
}

