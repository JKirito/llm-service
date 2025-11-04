import { experimental_generateImage as generateImage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createLogger } from "@llm-service/logger";
import type { ApiResponse } from "@llm-service/types";
import { config } from "../../../config";
import type { RouteHandler } from "../../types";
import {
  createConversation,
  findConversation,
  replaceConversationMessages,
} from "./conversation-store";
import { createTextMessage, type BasicUIMessage } from "./messages";
import { uploadGeneratedImage } from "../../../lib/image-storage";
import { getFileUrlFromPath } from "../../../lib/storage-url";
import type { ImageReference, ImageGenerationOptions } from "./types";
import { initializeAzureStorage } from "@llm-service/azure-storage";

const logger = createLogger("IMAGE_GENERATION");

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

interface GenerateImageResponse {
  conversationId: string;
  imageReferences: Array<ImageReference & { url: string }>;
  images: Array<{
    url: string;
    revisedPrompt?: string;
  }>;
}

const VALID_SIZES = ["1024x1024", "1792x1024", "1024x1792"] as const;
const VALID_QUALITIES = ["standard", "hd"] as const;
const VALID_STYLES = ["vivid", "natural"] as const;

function validateImageGenerationRequest(
  body: Record<string, unknown>,
):
  | { valid: true; options: ImageGenerationOptions }
  | { valid: false; error: string } {
  // Validate prompt
  const prompt = body.prompt;
  if (typeof prompt !== "string" || prompt.trim() === "") {
    return {
      valid: false,
      error: "Prompt is required and must be a non-empty string",
    };
  }

  if (prompt.length > 1000) {
    return {
      valid: false,
      error: "Prompt must be 1000 characters or less",
    };
  }

  const options: ImageGenerationOptions = {
    prompt: prompt.trim(),
  };

  // Validate size
  if (body.size !== undefined) {
    if (
      typeof body.size !== "string" ||
      !VALID_SIZES.includes(body.size as (typeof VALID_SIZES)[number])
    ) {
      return {
        valid: false,
        error: `Size must be one of: ${VALID_SIZES.join(", ")}`,
      };
    }
    options.size = body.size;
  } else {
    options.size = "1024x1024"; // Default
  }

  // Validate quality
  if (body.quality !== undefined) {
    if (
      typeof body.quality !== "string" ||
      !VALID_QUALITIES.includes(
        body.quality as (typeof VALID_QUALITIES)[number],
      )
    ) {
      return {
        valid: false,
        error: `Quality must be one of: ${VALID_QUALITIES.join(", ")}`,
      };
    }
    options.quality = body.quality as "standard" | "hd";
  } else {
    options.quality = "standard"; // Default
  }

  // Validate style
  if (body.style !== undefined) {
    if (
      typeof body.style !== "string" ||
      !VALID_STYLES.includes(body.style as (typeof VALID_STYLES)[number])
    ) {
      return {
        valid: false,
        error: `Style must be one of: ${VALID_STYLES.join(", ")}`,
      };
    }
    options.style = body.style as "vivid" | "natural";
  } else {
    options.style = "vivid"; // Default
  }

  // Validate n (must be 1 for DALL-E 3)
  if (body.n !== undefined) {
    const n =
      typeof body.n === "number" ? body.n : Number.parseInt(String(body.n), 10);
    if (Number.isNaN(n) || n !== 1) {
      return {
        valid: false,
        error:
          "DALL-E 3 only supports generating 1 image per request (n must be 1)",
      };
    }
    options.n = 1;
  } else {
    options.n = 1; // Default
  }

  // Validate seed (optional)
  if (body.seed !== undefined) {
    const seed =
      typeof body.seed === "number"
        ? body.seed
        : Number.parseInt(String(body.seed), 10);
    if (Number.isNaN(seed)) {
      return {
        valid: false,
        error: "Seed must be a valid number",
      };
    }
    options.seed = seed;
  }

  return { valid: true, options };
}

export const generateImageHandler: RouteHandler = async (req) => {
  let body: Record<string, unknown>;

  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    const response: ApiResponse = {
      success: false,
      error: "Invalid JSON payload",
    };
    return Response.json(response, { status: 400 });
  }

  // Validate request
  const validation = validateImageGenerationRequest(body);
  if (!validation.valid) {
    const response: ApiResponse = {
      success: false,
      error: validation.error,
    };
    return Response.json(response, { status: 400 });
  }

  const options = validation.options;

  // Get conversation ID if provided
  const conversationIdFromBody =
    typeof body.conversationId === "string" && body.conversationId.trim() !== ""
      ? body.conversationId.trim()
      : null;

  let persistedConversationMessages: BasicUIMessage[] = [];

  if (conversationIdFromBody) {
    try {
      const existingConversation = await findConversation(
        conversationIdFromBody,
      );
      if (!existingConversation) {
        const response: ApiResponse = {
          success: false,
          error: `Conversation ${conversationIdFromBody} not found`,
        };
        return Response.json(response, { status: 404 });
      }
      persistedConversationMessages = existingConversation.messages;
    } catch (error) {
      logger.error("Failed to find conversation", error);
      const response: ApiResponse = {
        success: false,
        error: "Failed to retrieve conversation",
      };
      return Response.json(response, { status: 500 });
    }
  }

  try {
    ensureAzureStorage();

    // Generate image using DALL-E 3
    logger.info(`Generating image with prompt: ${options.prompt}`);

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

    const imageReferences: ImageReference[] = [];
    const imageUrls: Array<{ url: string; revisedPrompt?: string }> = [];

    // Process each generated image (DALL-E 3 returns single image in `image` property)
    const imagesToProcess = generateResult.image
      ? [generateResult.image]
      : generateResult.images || [];

    for (const image of imagesToProcess) {
      try {
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
          typeof crypto !== "undefined" &&
          typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

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

        imageReferences.push(imageRef);
        imageUrls.push({
          url: imageUrl,
          revisedPrompt: imageRef.revisedPrompt,
        });
      } catch (error) {
        logger.error("Failed to upload generated image", error);
        const response: ApiResponse = {
          success: false,
          error:
            error instanceof Error
              ? `Failed to upload image: ${error.message}`
              : "Failed to upload image",
        };
        return Response.json(response, { status: 500 });
      }
    }

    // Create or update conversation
    let conversationId = conversationIdFromBody;

    // Create user message with prompt
    const userMessage = createTextMessage("user", options.prompt);

    // Create assistant message with image references
    const assistantMessage = createTextMessage(
      "assistant",
      `Generated ${imageReferences.length} image(s) based on your prompt: "${options.prompt}"`,
      { model: "dall-e-3" },
      undefined,
      imageReferences,
    );

    const updatedMessages: BasicUIMessage[] = [
      ...persistedConversationMessages,
      userMessage,
      assistantMessage,
    ];

    try {
      if (conversationId) {
        await replaceConversationMessages(conversationId, updatedMessages);
      } else {
        const createdConversation = await createConversation(updatedMessages);
        conversationId = createdConversation.conversationId;
      }
    } catch (error) {
      logger.error("Failed to persist conversation", error);
      const response: ApiResponse = {
        success: false,
        error: "Failed to persist conversation",
      };
      return Response.json(response, { status: 500 });
    }

    if (!conversationId) {
      logger.error("Conversation ID missing after persistence");
      const response: ApiResponse = {
        success: false,
        error: "Conversation state is inconsistent",
      };
      return Response.json(response, { status: 500 });
    }

    const responsePayload: ApiResponse<GenerateImageResponse> = {
      success: true,
      data: {
        conversationId,
        imageReferences: imageReferences.map((ref) => ({
          ...ref,
          url: getFileUrlFromPath(ref.path),
        })),
        images: imageUrls,
      },
      message: "Image generated successfully",
    };

    return Response.json(responsePayload);
  } catch (error) {
    logger.error("Failed to generate image", error);

    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to generate image: ${error.message}`
          : "Failed to generate image",
    };
    return Response.json(response, { status: 500 });
  }
};
