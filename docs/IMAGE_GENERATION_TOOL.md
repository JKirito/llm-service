# Image Generation Tool

## Overview

The LLM service now supports automatic image generation through an agentic tool. When users request image generation in their conversation, the LLM can automatically call the image generation tool without requiring a separate endpoint call.

## How It Works

The image generation capability is implemented as a **custom Vercel AI SDK tool** that:

1. Detects when the user wants to generate an image
2. Automatically calls DALL-E 3 to generate the image
3. Uploads the image to Azure Storage
4. Returns the image URL and metadata in the conversation

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    /api/v1/llm/answers                      │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              LLM (GPT-4, etc.)                       │  │
│  │                                                      │  │
│  │  Detects: "Generate an image of a sunset"           │  │
│  │                      ↓                               │  │
│  │  Calls: image_generation tool                       │  │
│  └──────────────────────────────────────────────────────┘  │
│                        ↓                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │         Image Generation Service                     │  │
│  │  - Uses DALL-E 3                                     │  │
│  │  - Uploads to Azure Storage                          │  │
│  │  - Returns image URL + metadata                      │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Files Modified/Created

### New Files

1. **`apps/api/src/routes/v1/llm/image-generation-service.ts`**
   - Shared service for image generation logic
   - Exports `generateImageWithDallE()` function
   - Used by both the tool and the standalone endpoint

### Modified Files

1. **`apps/api/src/routes/v1/llm/tools-registry.ts`**
   - Added `image_generation` tool registration
   - Tool uses Vercel AI SDK's `tool()` function
   - Defines Zod schema for parameters
   - Implements `execute` function

2. **`apps/api/src/routes/v1/llm/images.ts`**
   - Refactored to use shared service
   - Reduces code duplication
   - Maintains backward compatibility

3. **`apps/api/package.json`**
   - Added `zod` dependency for schema validation

## Usage

### Option 1: Automatic via LLM Tool (NEW)

Simply ask the LLM to generate an image in a conversation:

```bash
POST /api/v1/llm/answers
Content-Type: application/json

{
  "messages": [
    {
      "role": "user",
      "content": "Generate an image of a futuristic city at sunset"
    }
  ],
  "tools": ["image_generation"],
  "stream": true
}
```

The LLM will:
1. Detect the image generation request
2. Automatically call the `image_generation` tool
3. Return the image in the conversation flow

**Response (streaming):**
```
# The LLM response will include:
1. Tool call indication
2. Image generation progress
3. Final message with image URL

"I've generated an image of a futuristic city at sunset.
You can view it here: [image URL]"
```

### Option 2: Direct Endpoint (Existing)

Use the dedicated endpoint for direct image generation:

```bash
POST /api/v1/llm/images
Content-Type: application/json

{
  "prompt": "A futuristic city at sunset",
  "size": "1024x1024",
  "quality": "hd",
  "style": "vivid"
}
```

## Tool Configuration

### Available Tools

To use image generation, include it in the `tools` array:

```json
{
  "tools": ["image_generation"]
}
```

You can combine it with other tools:

```json
{
  "tools": ["web_search", "image_generation"]
}
```

### Tool Parameters

The `image_generation` tool accepts:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `prompt` | string | Yes | - | Text description of the image (max 1000 chars) |
| `size` | enum | No | `"1024x1024"` | Image size: `"1024x1024"`, `"1792x1024"`, or `"1024x1792"` |
| `quality` | enum | No | `"standard"` | Image quality: `"standard"` or `"hd"` |
| `style` | enum | No | `"vivid"` | Image style: `"vivid"` or `"natural"` |

### Tool Schema

```typescript
{
  prompt: z.string()
    .min(1)
    .max(1000)
    .describe("A detailed text description of the image to generate"),

  size: z.enum(["1024x1024", "1792x1024", "1024x1792"])
    .optional()
    .describe("The size of the generated image"),

  quality: z.enum(["standard", "hd"])
    .optional()
    .describe("The quality of the image"),

  style: z.enum(["vivid", "natural"])
    .optional()
    .describe("The style of the generated image")
}
```

## Example Conversations

### Example 1: Simple Image Generation

**Request:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Can you generate an image of a cat wearing a space suit?"
    }
  ],
  "tools": ["image_generation"],
  "model": "gpt-4o"
}
```

**LLM Behavior:**
- Detects image generation intent
- Calls `image_generation` tool with prompt: "A cat wearing a space suit"
- Returns image URL in response

### Example 2: Multi-turn Conversation

**Request:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "I need ideas for a logo"
    },
    {
      "role": "assistant",
      "content": "I can help with that! What's your company about?"
    },
    {
      "role": "user",
      "content": "It's a tech startup focused on AI. Can you generate a modern, minimalist logo?"
    }
  ],
  "tools": ["image_generation"],
  "model": "gpt-4o"
}
```

**LLM Behavior:**
- Understands context from previous messages
- Generates appropriate prompt
- Calls tool to create the logo
- Returns image with explanation

### Example 3: Combined Tools

**Request:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Search for the latest trends in web design, then generate an image showcasing those trends"
    }
  ],
  "tools": ["web_search", "image_generation"],
  "model": "gpt-4o"
}
```

**LLM Behavior:**
1. Calls `web_search` to find current design trends
2. Analyzes the results
3. Calls `image_generation` with a prompt based on the findings
4. Returns both the research and the generated image

## Tool Implementation Details

### Tool Definition

Located in `apps/api/src/routes/v1/llm/tools-registry.ts`:

```typescript
toolRegistry.registerTool({
  name: "image_generation",
  openaiToolName: "image_generation",
  description: "Generate images using DALL-E 3 based on text descriptions",
  requiresResponsesAPI: false, // Custom tool
  getTool: () => {
    return tool({
      description: "Generate an image using DALL-E 3...",
      parameters: z.object({ /* ... */ }),
      execute: async ({ prompt, size, quality, style }) => {
        // Calls generateImageWithDallE()
        // Returns image metadata
      }
    });
  }
});
```

### Service Function

Located in `apps/api/src/routes/v1/llm/image-generation-service.ts`:

```typescript
export async function generateImageWithDallE(
  options: ImageGenerationOptions
): Promise<GenerateImageResult>
```

**What it does:**
1. Initializes Azure Storage
2. Calls DALL-E 3 via Vercel AI SDK
3. Uploads generated image to Azure
4. Creates image reference metadata
5. Returns image URL and metadata

## Benefits

### 1. **Unified Endpoint**
- No need to call separate endpoints
- Seamless conversation flow
- Better user experience

### 2. **Intelligent Context**
- LLM understands when to generate images
- Can refine prompts based on conversation
- Combines with other tools naturally

### 3. **Code Reusability**
- Shared service used by both tool and endpoint
- DRY principle
- Easier maintenance

### 4. **Extensibility**
- Easy to add more image tools (editing, variations, etc.)
- Can combine with other AI capabilities
- Future-proof architecture

## Comparison: Before vs After

### Before

```
User Flow:
1. User asks: "Generate an image of X"
2. Frontend/Client must:
   - Detect this is an image request
   - Call /api/v1/llm/images separately
   - Handle the response separately
   - Integrate back into conversation
```

### After (NEW)

```
User Flow:
1. User asks: "Generate an image of X"
2. LLM automatically:
   - Detects the intent
   - Calls the tool
   - Returns image in conversation
3. Everything handled in one request
```

## Error Handling

The tool includes comprehensive error handling:

```typescript
try {
  const result = await generateImageWithDallE(options);
  return {
    success: true,
    imageUrl: result.imageUrl,
    // ... other metadata
  };
} catch (error) {
  return {
    success: false,
    error: error instanceof Error
      ? error.message
      : "Failed to generate image"
  };
}
```

Errors are returned to the LLM, which can:
- Inform the user about the issue
- Retry with different parameters
- Suggest alternatives

## Future Enhancements

Possible extensions to this feature:

1. **Image Editing Tool**
   - Modify existing images
   - Change specific elements
   - Combine with vision models

2. **Image Variation Tool**
   - Generate variations of an existing image
   - Different styles
   - Different perspectives

3. **Image Analysis + Generation**
   - Analyze uploaded images
   - Generate similar images
   - Extract and recreate elements

4. **Batch Generation**
   - Generate multiple images at once
   - Different variations
   - A/B testing

## Testing

### Manual Testing

```bash
# Test with curl
curl -X POST http://localhost:3000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Generate a beautiful landscape image"
      }
    ],
    "tools": ["image_generation"],
    "model": "gpt-4o"
  }'
```

### Expected Tool Call

The LLM should make a tool call like:

```json
{
  "type": "tool-call",
  "toolName": "image_generation",
  "args": {
    "prompt": "A beautiful landscape with mountains, a lake, and a sunset sky",
    "size": "1024x1024",
    "quality": "standard",
    "style": "vivid"
  }
}
```

## Troubleshooting

### Issue: Tool not being called

**Possible causes:**
- `tools` array doesn't include `"image_generation"`
- User prompt doesn't clearly indicate image generation
- Model doesn't support tool calling

**Solution:**
- Ensure `tools: ["image_generation"]` in request
- Use clear language like "generate an image", "create a picture"
- Use a model that supports tools (gpt-4o, gpt-4-turbo, etc.)

### Issue: Image generation fails

**Possible causes:**
- Azure Storage not configured
- OpenAI API key invalid
- Prompt violates content policy

**Solution:**
- Check Azure connection string
- Verify OpenAI API key
- Review and adjust prompt

## Configuration

### Environment Variables

Required for image generation:

```bash
# OpenAI API Key
OPENAI_API_KEY=sk-...

# Azure Storage
AZURE_STORAGE_CONNECTION_STRING=DefaultEndpointsProtocol=https;...

# Container name (default: "generated-images")
AZURE_IMAGES_CONTAINER=generated-images
```

## API Reference

### List Available Tools

```bash
GET /api/v1/llm/tools
```

**Response:**
```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "web_search",
        "description": "Search the web for current information",
        "requiresResponsesAPI": true
      },
      {
        "name": "code_interpreter",
        "description": "Write and execute Python code",
        "requiresResponsesAPI": true
      },
      {
        "name": "image_generation",
        "description": "Generate images using DALL-E 3",
        "requiresResponsesAPI": false
      }
    ]
  }
}
```

## Conclusion

The image generation tool brings powerful AI image creation capabilities directly into your LLM conversations. By leveraging Vercel AI SDK's tool calling features, it provides a seamless, intelligent, and context-aware image generation experience.
