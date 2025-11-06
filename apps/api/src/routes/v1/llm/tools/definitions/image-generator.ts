import { createOpenAI } from "@ai-sdk/openai";
import { experimental_generateImage as generateImage, tool } from "ai";
import { z } from "zod";
import { createLogger } from "@llm-service/logger";
import { config } from "../../../../../config";
import { getFileUrlFromPath } from "../../../../../lib/storage-url";
import { uploadGeneratedImage } from "../../../../../lib/image-storage";
import { initializeAzureStorage } from "@llm-service/azure-storage";
import type { StreamWriter } from "../../streaming/stream-types";
import type { ImageReference } from "../../types";

const logger = createLogger("IMAGE_GENERATION_TOOL");

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

interface ImageGenerationResult {
  urls: string[];
  prompt: string;
  provider: string;
  model: string;
  size: string;
  count: number;
}

interface ImageGeneratorConfig {
  writer: StreamWriter;
  onImageGenerated?: (imageReferences: ImageReference[]) => void;
}

/**
 * Creates an image generation tool that uses DALL-E 3 via Azure OpenAI
 * and uploads generated images to Azure Blob Storage.
 *
 * @param config - Configuration object containing StreamWriter and optional callback
 * @returns A tool instance configured for image generation
 */
export function createImageGenerationTool(config: ImageGeneratorConfig) {
  const { writer, onImageGenerated } = config;

  return tool({
    description:
      "Generate one or more images. Returns public URLs so the client can render them immediately.",
    inputSchema: z.object({
      prompt: z.string().describe("What to draw. Be descriptive and clear."),
      n: z
        .number()
        .int()
        .min(1)
        .max(4)
        .default(1)
        .describe("Number of images to generate (1-4)"),
      size: z
        .enum(["1024x1024", "1792x1024", "1024x1792"])
        .default("1024x1024")
        .describe("Image size"),
      quality: z
        .enum(["standard", "hd"])
        .default("standard")
        .describe("Image quality (standard or hd)"),
      style: z
        .enum(["vivid", "natural"])
        .default("vivid")
        .describe("Image style"),
      seed: z.number().optional().describe("Seed for reproducibility"),
    }),
    async execute(
      {
        prompt,
        n: _n,
        size,
        quality,
        style,
        seed,
      }: {
        prompt: string;
        n: number;
        size: "1024x1024" | "1792x1024" | "1024x1792";
        quality: "standard" | "hd";
        style: "vivid" | "natural";
        seed?: number;
      },
      {
        toolCallId,
        abortSignal,
      }: {
        toolCallId: string;
        abortSignal?: AbortSignal;
      },
    ): Promise<ImageGenerationResult> {
      try {
        // Notify client that image generation started
        writer.write({
          type: "data-toolStatus",
          id: toolCallId,
          data: {
            name: "generate_image",
            status: "started",
          },
          transient: true,
        });

        // Ensure Azure Storage is initialized
        ensureAzureStorage();

        // Generate image using AI SDK
        logger.info(`Generating image with prompt: ${prompt}`);
        const generateResult = await generateImage({
          model: openai.image("dall-e-3"),
          prompt,
          size: size as "1024x1024" | "1792x1024" | "1024x1792",
          providerOptions: {
            openai: {
              quality: quality as "standard" | "hd",
              style: style as "vivid" | "natural",
            },
          },
          ...(seed !== undefined ? { seed } : {}),
          abortSignal,
        });

        // Process generated images
        const imagesToProcess = generateResult.image
          ? [generateResult.image]
          : generateResult.images || [];

        // Extract revised prompt from provider metadata if available
        let revisedPrompt: string | undefined;
        if (generateResult.providerMetadata?.openai) {
          const openaiMetadata = generateResult.providerMetadata
            .openai as Record<string, unknown>;
          if (openaiMetadata.images && Array.isArray(openaiMetadata.images)) {
            const firstImageMeta = openaiMetadata.images[0] as
              | Record<string, unknown>
              | undefined;
            revisedPrompt = firstImageMeta?.revised_prompt as
              | string
              | undefined;
          }
          // Fallback: check direct revised_prompt property
          if (!revisedPrompt) {
            revisedPrompt = openaiMetadata.revised_prompt as string | undefined;
          }
        }

        const imageUrls: string[] = [];
        const imageReferences: ImageReference[] = [];

        for (const image of imagesToProcess) {
          try {
            // Upload to Azure Storage using uint8Array property
            const imageData = image.uint8Array || new Uint8Array();

            if (imageData.length > 0) {
              const uploadResult = await uploadGeneratedImage(
                imageData,
                prompt,
                {
                  model: "dall-e-3",
                  size,
                  quality,
                  style,
                  ...(seed !== undefined ? { seed: seed.toString() } : {}),
                },
              );

              // Get public URL
              const publicUrl = getFileUrlFromPath(uploadResult.path);
              imageUrls.push(publicUrl);
              imageReferences.push({
                imageId: crypto.randomUUID(),
                path: uploadResult.path,
                prompt,
                revisedPrompt,
                size,
                model: "dall-e-3",
                quality,
                style,
                createdAt: new Date().toISOString(),
              });
            }
          } catch (uploadError) {
            logger.error("Failed to upload generated image", uploadError);
            // If upload fails, we still need to return something
            // The image data should be available for fallback
            throw uploadError;
          }
        }

        if (imageUrls.length === 0) {
          throw new Error("No images were generated");
        }

        // Call optional callback with image references
        if (onImageGenerated) {
          onImageGenerated(imageReferences);
        }

        // Stream image data to client
        writer.write({
          type: "data-image",
          id: toolCallId,
          data: {
            urls: imageUrls,
            prompt,
            provider: "openai",
            model: "dall-e-3",
            size,
          },
        });

        // Return compact result for LLM
        return {
          urls: imageUrls,
          prompt,
          provider: "openai",
          model: "dall-e-3",
          size,
          count: imageUrls.length,
        };
      } catch (error) {
        logger.error("Image generation failed", error);
        const errorMessage =
          error instanceof Error ? error.message : "Image generation failed";

        // Notify client of error
        writer.write({
          type: "data-toolStatus",
          id: toolCallId,
          data: {
            name: "generate_image",
            status: "error",
          },
          transient: true,
        });

        writer.write({
          type: "data-notification",
          data: {
            message: `Image generation failed: ${errorMessage}`,
            level: "error",
          },
          transient: true,
        });

        throw error;
      }
    },
  });
}
