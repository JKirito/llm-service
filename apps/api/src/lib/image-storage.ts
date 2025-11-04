import { uploadFile } from "@llm-service/azure-storage";
import { createLogger } from "@llm-service/logger";
import { config } from "../config";

const logger = createLogger("IMAGE_STORAGE");

function generateImageId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function generateImageFilename(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const imageId = generateImageId();
  return `${timestamp}-${imageId}.png`;
}

export interface UploadImageResult {
  path: string;
}

/**
 * Uploads a generated image to Azure Blob Storage
 * Returns relative path in format "containerName/filePath"
 * URLs should be generated dynamically using getFileUrlFromPath
 */
export async function uploadGeneratedImage(
  imageData: Uint8Array,
  prompt: string,
  metadata: Record<string, string> = {},
): Promise<UploadImageResult> {
  try {
    const fileName = generateImageFilename();
    const containerName = config.images.containerName;

    logger.info(`Uploading generated image: ${fileName}`);

    const buffer = Buffer.from(imageData);

    await uploadFile(buffer, {
      containerName,
      fileName,
      contentType: "image/png",
      metadata: {
        originalPrompt: prompt,
        uploadedAt: new Date().toISOString(),
        ...metadata,
      },
    });

    logger.info(`Successfully uploaded image: ${fileName}`);

    return {
      path: `${containerName}/${fileName}`,
    };
  } catch (error) {
    logger.error("Failed to upload generated image", error);
    throw error;
  }
}
