import { experimental_generateImage as generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createLogger } from "@llm-service/logger";
import { config } from "../../../config";
import { uploadGeneratedImage } from "../../../lib/image-storage";
import { getFileUrlFromPath } from "../../../lib/storage-url";
import type { ImageReference, ImageGenerationOptions } from "./types";
import { initializeAzureStorage } from "@llm-service/azure-storage";

const logger = createLogger("IMAGE_GENERATION_SERVICE");

const openai = createOpenAI({
  apiKey: config.openai.apiKey,
});

// Initialize Azure Storage if not already initialized
let azureStorageInitialized = false;
function ensureAzureStorage(): void {
  if (!azureStorageInitialized) {
    initializeAzureStorage(config.azure.connectionString);
    azureStorageInitialized = true;
  }
}

export interface GenerateImageResult {
  imageReference: ImageReference;
  imageUrl: string;
  revisedPrompt?: string;
}

/**
 * Core image generation logic that can be used by both the endpoint and the tool
 */
export async function generateImageWithDallE(
  options: ImageGenerationOptions,
): Promise<GenerateImageResult> {
  ensureAzureStorage();

  logger.info(`Generating image with prompt: ${options.prompt}`);

  // Generate image using DALL-E 3
  const generateResult = await generateImage({
    model: openai.image("dall-e-3"),
    prompt: options.prompt,
    size: (options.size || "1024x1024") as
      | "1024x1024"
      | "1792x1024"
      | "1024x1792",
    providerOptions: {
      openai: {
        quality: (options.quality || "standard") as "standard" | "hd",
        style: (options.style || "vivid") as "vivid" | "natural",
      },
    },
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });

  // Process the generated image (DALL-E 3 returns single image in `image` property)
  const imagesToProcess = generateResult.image
    ? [generateResult.image]
    : generateResult.images || [];

  if (imagesToProcess.length === 0) {
    throw new Error("No images were generated");
  }

  const image = imagesToProcess[0];

  // Upload image to Azure Storage
  const uploadResult = await uploadGeneratedImage(
    image.uint8Array,
    options.prompt,
    {
      model: "dall-e-3",
      size: options.size || "1024x1024",
      quality: options.quality || "standard",
      style: options.style || "vivid",
    },
  );

  // Create image reference
  const imageId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Extract revised prompt from provider metadata if available
  let revisedPrompt: string | undefined;
  if (generateResult.providerMetadata?.openai) {
    const openaiMetadata = generateResult.providerMetadata.openai as Record<
      string,
      unknown
    >;
    if (openaiMetadata.images && Array.isArray(openaiMetadata.images)) {
      const firstImageMeta = openaiMetadata.images[0] as
        | Record<string, unknown>
        | undefined;
      revisedPrompt = firstImageMeta?.revised_prompt as string | undefined;
    }
    // Fallback: check direct revised_prompt property
    if (!revisedPrompt) {
      revisedPrompt = openaiMetadata.revised_prompt as string | undefined;
    }
  }

  const imageRef: ImageReference = {
    imageId,
    path: uploadResult.path,
    prompt: options.prompt,
    revisedPrompt,
    size: options.size || "1024x1024",
    model: "dall-e-3",
    createdAt: new Date().toISOString(),
  };

  // Generate URL dynamically for response
  const imageUrl = getFileUrlFromPath(uploadResult.path);

  return {
    imageReference: imageRef,
    imageUrl,
    revisedPrompt: imageRef.revisedPrompt,
  };
}
