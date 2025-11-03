# LLM Service API Documentation

## Base URL

All API endpoints are prefixed with `/api`.

**Local Development (Direct Access):** `http://localhost:4000/api`  
**Docker/Nginx Access:** `http://localhost/api` (requires Basic Authentication)

## Authentication

When running via Docker with Nginx (production setup), all API endpoints require **Basic Authentication**.

### Basic Authentication

Include credentials in your requests:

**Using curl:**
```bash
curl -u username:password http://localhost/api/health
```

**Using JavaScript/TypeScript:**
```javascript
fetch('http://localhost/api/health', {
  headers: {
    'Authorization': 'Basic ' + btoa('username:password')
  }
})
```

**Using Python:**
```python
import requests
from requests.auth import HTTPBasicAuth

response = requests.get(
    'http://localhost/api/health',
    auth=HTTPBasicAuth('username', 'password')
)
```

### Setting Up Credentials

See [Docker Documentation](DOCKER.md#basic-authentication-setup) for instructions on generating Basic Auth credentials.

**Note:** In development mode, the API is accessible both:
- Through Nginx on port 80 (requires Basic Auth)
- Directly on port 4000 (no auth, for debugging)

## Rate Limiting

The API implements rate limiting to protect expensive endpoints from abuse. Rate limits are enforced per IP address using a sliding window algorithm.

### Rate Limit Headers

All responses include rate limit headers:

- `X-RateLimit-Limit`: Maximum number of requests allowed in the time window
- `X-RateLimit-Remaining`: Number of requests remaining in the current window
- `X-RateLimit-Reset`: Unix timestamp (seconds) when the rate limit resets

### Rate Limit by Endpoint

#### High Priority (Expensive Operations)
- **POST /api/v1/files/upload**: 20 requests/hour per IP
- **POST /api/v1/llm/answers**: 60 requests/hour per IP
- **POST /api/v1/llm/images**: 10 requests/hour per IP

#### Medium Priority (Moderate Operations)
- **GET /api/v1/files/download/***: 200 requests/hour per IP
- **POST /api/v1/files/signed-url**: 100 requests/hour per IP
- **DELETE /api/v1/files/***: 50 requests/hour per IP

#### Low Priority (Lightweight Operations)
- **GET /api/v1/llm/tools**: 300 requests/hour per IP
- **GET /api/v1/users**: 300 requests/hour per IP

#### Exempt (No Rate Limiting)
- **GET /api**: No limit
- **GET /api/health**: No limit

### Rate Limit Exceeded Response

When rate limit is exceeded, the API returns `429 Too Many Requests`:

**Response:**
```json
{
  "success": false,
  "error": "Rate limit exceeded. Please try again later."
}
```

**Headers:**
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1731234567
Retry-After: 3600
```

### Checking Rate Limit Status

You can check your current rate limit status by examining the response headers:

```bash
curl -u username:password -i http://localhost/api/v1/llm/answers \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello"}'

# Response headers will include:
# X-RateLimit-Limit: 60
# X-RateLimit-Remaining: 59
# X-RateLimit-Reset: 1731234567
```

### Best Practices

1. **Handle 429 responses gracefully**: Implement exponential backoff when rate limited
2. **Monitor rate limit headers**: Track remaining requests to avoid hitting limits
3. **Use appropriate endpoints**: Use lightweight endpoints (like `/api/v1/llm/tools`) when possible
4. **Batch operations**: Combine multiple operations when possible to reduce request count

### Example: Handling Rate Limits

```javascript
async function makeRequest(url, options) {
  const response = await fetch(url, options);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After');
    const resetTime = response.headers.get('X-RateLimit-Reset');
    
    console.log(`Rate limited. Retry after ${retryAfter} seconds`);
    console.log(`Rate limit resets at: ${new Date(resetTime * 1000)}`);
    
    // Wait and retry
    await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
    return makeRequest(url, options);
  }
  
  return response;
}
```

## Response Format

All API responses follow a consistent format:

```typescript
{
  "success": boolean;
  "data"?: T;           // Present when success is true
  "error"?: string;     // Present when success is false
  "message"?: string;   // Optional success message
}
```

## Error Responses

Error responses follow the standard format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

## Common HTTP Status Codes

- `200 OK` - Request succeeded
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Authentication required or invalid credentials
- `404 Not Found` - Resource not found
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error

---

## Health & Status

### GET /api

Check if the API is running.

**Response:**
```json
{
  "success": true,
  "message": "LLM Service API is running"
}
```

**Example:**
```bash
curl http://localhost:4000/api
```

---

### GET /api/health

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-03T01:53:10.565Z"
}
```

**Example:**
```bash
curl http://localhost:4000/api/health
```

---

## Users

### GET /api/v1/users

Get list of users (placeholder endpoint).

**Response:**
```json
{
  "success": true,
  "data": [],
  "message": "Users retrieved successfully"
}
```

**Example:**
```bash
curl http://localhost:4000/api/v1/users
```

---

## File Management

### POST /api/v1/files/upload

Upload a file to Azure Blob Storage.

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `file` (File, required) - The file to upload
- `containerName` (string, required) - The Azure Storage container name

**Response:**
```json
{
  "success": true,
  "data": {
    "fileName": "document.pdf",
    "size": 12345,
    "contentType": "application/pdf",
    "url": "https://storage.azure.com/container/document.pdf",
    "containerName": "documents",
    "documentReference": "documents/document.pdf"
  },
  "message": "File uploaded successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:4000/api/v1/files/upload \
  -F "file=@document.pdf" \
  -F "containerName=documents"
```

**Note:** The `documentReference` field (`containerName/fileName`) should be used when referencing files in LLM requests.

---

### GET /api/v1/files/download/:containerName/:fileName

Download a file from Azure Blob Storage.

**Path Parameters:**
- `containerName` (string, required) - The Azure Storage container name
- `fileName` (string, required) - The file name to download

**Response:** Binary file stream with appropriate `Content-Type` and `Content-Disposition` headers.

**Example:**
```bash
curl http://localhost:4000/api/v1/files/download/documents/report.pdf \
  --output report.pdf
```

**Example with path segments:**
```bash
curl http://localhost:4000/api/v1/files/download/documents/reports/q1/analysis.pdf \
  --output analysis.pdf
```

---

### DELETE /api/v1/files/:containerName/:fileName

Delete a file from Azure Blob Storage.

**Path Parameters:**
- `containerName` (string, required) - The Azure Storage container name
- `fileName` (string, required) - The file name to delete

**Response:**
```json
{
  "success": true,
  "data": {
    "success": true
  },
  "message": "File deleted successfully"
}
```

**Example:**
```bash
curl -X DELETE http://localhost:4000/api/v1/files/documents/report.pdf
```

---

### POST /api/v1/files/signed-url

Generate a signed URL (SAS token) for a file using a relative path.

**Request Body:**
```json
{
  "path": "containerName/filePath",
  "expiresInMinutes": 60
}
```

**Parameters:**
- `path` (string, required) - Relative path in format `containerName/filePath` (e.g., `documents/reports/q1/analysis.pdf`)
- `expiresInMinutes` (number, optional) - Expiration time in minutes (default: 60, max: 10080 / 7 days)

**Response:**
```json
{
  "success": true,
  "data": {
    "signedUrl": "https://storage.azure.com/container/file.pdf?sv=2021-06-08&sig=...",
    "path": "documents/report.pdf",
    "expiresInMinutes": 60
  },
  "message": "Signed URL generated successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:4000/api/v1/files/signed-url \
  -H "Content-Type: application/json" \
  -d '{
    "path": "documents/report.pdf",
    "expiresInMinutes": 120
  }'
```

---

## LLM Endpoints

### POST /api/v1/llm/answers

Generate text responses using LLM models with optional document context and tool calling.

**Request Body:**
```json
{
  "prompt": "What is the weather like?",
  "model": "gpt-5-nano",
  "temperature": 0.7,
  "stream": false,
  "conversationId": "optional-conversation-id",
  "system": "You are a helpful assistant.",
  "messages": [
    {
      "id": "msg-1",
      "role": "user",
      "parts": [{"type": "text", "text": "Hello"}]
    }
  ],
  "documentReferences": ["documents/report.pdf"],
  "tools": ["web_search"]
}
```

**Parameters:**
- `prompt` (string, optional) - User prompt. If provided, creates a user message. Alternative to `messages`.
- `model` (string, optional) - Model to use (default: `gpt-5-nano`)
- `temperature` (number, optional) - Sampling temperature (0-2)
- `stream` (boolean, optional) - Enable streaming response (default: `false`)
- `conversationId` (string, optional) - Existing conversation ID to continue
- `system` (string, optional) - System message/prompt
- `messages` (array, optional) - Array of message objects (alternative to `prompt`)
- `documentReferences` (array, optional) - Array of document paths in format `containerName/filePath`
- `tools` (array, optional) - Array of tool names to enable (e.g., `["web_search"]`)

**Non-Streaming Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "model": "gpt-5-nano",
    "text": "The weather is sunny...",
    "usage": {
      "promptTokens": 10,
      "completionTokens": 20,
      "totalTokens": 30
    },
    "warnings": [],
    "sources": [
      {
        "url": "https://example.com",
        "title": "Example Source"
      }
    ]
  }
}
```

**Streaming Response:**
Server-Sent Events (SSE) stream with `Content-Type: text/event-stream`.

**Example - Non-Streaming:**
```bash
# Through Nginx (production/Docker - requires Basic Auth)
curl -u username:password -X POST http://localhost/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is artificial intelligence?",
    "model": "gpt-5-nano",
    "stream": false
  }'

# Direct access (development only - no auth)
curl -X POST http://localhost:4000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is artificial intelligence?",
    "model": "gpt-5-nano",
    "stream": false
  }'
```

**Example - With Documents:**
```bash
# Through Nginx (production/Docker - requires Basic Auth)
curl -u username:password -X POST http://localhost/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this document",
    "documentReferences": ["documents/report.pdf"],
    "stream": false
  }'

# Direct access (development only)
curl -X POST http://localhost:4000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Summarize this document",
    "documentReferences": ["documents/report.pdf"],
    "stream": false
  }'
```

**Example - With Tools:**
```bash
# Through Nginx (production/Docker - requires Basic Auth)
curl -u username:password -X POST http://localhost/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the latest news about AI?",
    "tools": ["web_search"],
    "stream": false
  }'

# Direct access (development only)
curl -X POST http://localhost:4000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is the latest news about AI?",
    "tools": ["web_search"],
    "stream": false
  }'
```

**Example - Continue Conversation:**
```bash
# Through Nginx (production/Docker - requires Basic Auth)
curl -u username:password -X POST http://localhost/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "prompt": "Tell me more",
    "stream": false
  }'
```

**Example - Streaming:**
```bash
# Through Nginx (production/Docker - requires Basic Auth)
curl -u username:password -X POST http://localhost/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain quantum computing",
    "stream": true
  }'

# Direct access (development only)
curl -X POST http://localhost:4000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Tell me a story",
    "stream": true
  }'
```

**Note:** 
- When `documentReferences` are provided, the documents are parsed and injected into the system message (hidden from the user).
- File references are stored in message metadata for traceability.
- When `tools` are used, sources (like web search results) are stored in message metadata.
- The `conversationId` is returned in the response header `X-Conversation-Id` for streaming requests.

---

### POST /api/v1/llm/images

Generate images using DALL-E 3.

**Request Body:**
```json
{
  "prompt": "A futuristic cityscape at sunset",
  "size": "1024x1024",
  "quality": "standard",
  "style": "vivid",
  "n": 1,
  "seed": 12345,
  "conversationId": "optional-conversation-id"
}
```

**Parameters:**
- `prompt` (string, required) - Image generation prompt (max 1000 characters)
- `size` (string, optional) - Image size: `1024x1024`, `1792x1024`, or `1024x1792` (default: `1024x1024`)
- `quality` (string, optional) - Image quality: `standard` or `hd` (default: `standard`)
- `style` (string, optional) - Image style: `vivid` or `natural` (default: `vivid`)
- `n` (number, optional) - Number of images (must be 1 for DALL-E 3, default: 1)
- `seed` (number, optional) - Seed for reproducibility
- `conversationId` (string, optional) - Existing conversation ID to continue

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "550e8400-e29b-41d4-a716-446655440000",
    "imageReferences": [
      {
        "imageId": "123e4567-e89b-12d3-a456-426614174000",
        "path": "generated-images/2025-11-03T00-57-09-054Z-xxx.png",
        "url": "https://storage.azure.com/generated-images/...",
        "prompt": "A futuristic cityscape at sunset",
        "revisedPrompt": "A futuristic cityscape at sunset with neon lights",
        "size": "1024x1024",
        "model": "dall-e-3",
        "createdAt": "2025-11-03T00:57:09.376Z"
      }
    ],
    "images": [
      {
        "url": "https://storage.azure.com/generated-images/...",
        "revisedPrompt": "A futuristic cityscape at sunset with neon lights"
      }
    ]
  },
  "message": "Image generated successfully"
}
```

**Example:**
```bash
curl -X POST http://localhost:4000/api/v1/llm/images \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "A serene mountain landscape at dawn",
    "size": "1792x1024",
    "quality": "hd",
    "style": "natural"
  }'
```

**Note:** 
- Generated images are automatically uploaded to Azure Blob Storage.
- Image references are stored in message metadata for traceability.
- Images use relative paths (`containerName/filePath`) stored in the database, with URLs generated dynamically.

---

### GET /api/v1/llm/tools

List all available tools that can be used with the LLM answers endpoint.

**Response:**
```json
{
  "success": true,
  "data": {
    "tools": [
      {
        "name": "web_search",
        "description": "Search the web for current information using OpenAI's web search",
        "requiresResponsesAPI": true
      }
    ]
  },
  "message": "Tools retrieved successfully"
}
```

**Example:**
```bash
curl http://localhost:4000/api/v1/llm/tools
```

**Note:** 
- Tool names returned here can be used in the `tools` array when calling `/api/v1/llm/answers`.
- `requiresResponsesAPI: true` indicates the tool requires OpenAI's Responses API.

---

## Data Models

### Message Format

Messages follow the UI message format:

```typescript
{
  "id": string;
  "role": "system" | "user" | "assistant";
  "parts": Array<{
    "type": "text";
    "text": string;
  }>;
  "metadata"?: {
    "model"?: string;
    "usage"?: Record<string, unknown>;
    "fileReferences"?: Array<{
      "path": string;
      "filename": string;
    }>;
    "imageReferences"?: Array<{
      "imageId": string;
      "path": string;
      "prompt": string;
      "revisedPrompt"?: string;
      "size": string;
      "model": string;
      "createdAt": string;
    }>;
    "sources"?: Array<{
      "type": string;
      "sourceType": string;
      "id": string;
      "url": string;
      "title"?: string;
      "sourceOrigin"?: "tool" | "rag" | "mcp" | "document" | "other";
      "sourceProvider"?: string;
      "metadata"?: Record<string, unknown>;
    }>;
  };
}
```

### Document Reference Format

Document references use relative paths:

```
containerName/filePath
```

**Examples:**
- `documents/report.pdf`
- `documents/reports/q1/analysis.pdf`
- `generated-images/2025-11-03-image.png`

---

## Error Examples

### Invalid Request
```json
{
  "success": false,
  "error": "Prompt is required and must be a non-empty string"
}
```

### Invalid Tool
```json
{
  "success": false,
  "error": "Invalid tool names: invalid_tool"
}
```

### Conversation Not Found
```json
{
  "success": false,
  "error": "Conversation 550e8400-e29b-41d4-a716-446655440000 not found"
}
```

---

## Best Practices

1. **Conversation Management**: Use `conversationId` to maintain context across multiple requests.
2. **Document References**: Upload files first using `/api/v1/files/upload`, then use the returned `documentReference` in LLM requests.
3. **Streaming**: Use streaming (`stream: true`) for long responses to improve user experience.
4. **Tool Usage**: Check available tools with `/api/v1/llm/tools` before requesting them.
5. **Error Handling**: Always check the `success` field in responses before accessing `data`.
6. **File Paths**: Use relative paths (`containerName/filePath`) when referencing files - URLs are generated dynamically to avoid migration issues.

---

## Rate Limiting

Currently, there are no rate limits enforced. Consider implementing rate limiting in production environments.

---

## Support

For issues or questions, please refer to the project repository or contact the development team.

