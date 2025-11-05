# Event-Driven Streaming System

This document describes the Redis Stream-based event-driven architecture for LLM conversation streaming.

## Overview

The LLM service now uses Redis Streams for a more scalable, event-driven streaming architecture. This allows:

- **Decoupled streaming**: Stream generation and consumption are independent
- **Stream replay**: Clients can resume or replay conversations from any point
- **Cancellation support**: Active streams can be cancelled via API
- **Scalability**: Multiple consumers can subscribe to the same stream
- **Fault tolerance**: Streams persist in Redis, allowing recovery from disconnections

## Architecture

### Flow Diagram

```
┌─────────┐                  ┌──────────────┐                ┌───────────┐
│ Client  │  1. POST         │   API        │   2. Write    │  Redis    │
│         ├─────────────────►│  /answers    ├──────────────►│  Stream   │
│         │  stream=true     │              │   chunks      │           │
└────┬────┘                  └──────────────┘                └─────┬─────┘
     │                                                              │
     │ 3. GET /stream/status/:conversationId                       │
     ├────────────────────────────────────────────────────────────►│
     │                                                              │
     │ 4. GET /stream/subscribe/:conversationId                    │
     ├────────────────────────────────────────────────────────────►│
     │                         5. SSE events                        │
     │◄─────────────────────────────────────────────────────────────┤
     │                                                              │
     │ 6. POST /stream/cancel/:conversationId (optional)           │
     ├─────────────────────────────────────────────────────────────►│
```

### Components

1. **Stream Service** (`stream-service.ts`)
   - Manages Redis Stream lifecycle
   - Writes chunks, metadata, and sources to Redis
   - Handles stream status (streaming, completed, error, cancelled)

2. **Stream Routes** (`stream-routes.ts`)
   - Status endpoint: Check if conversation is streaming
   - Subscribe endpoint: Receive stream events via SSE
   - Cancel endpoint: Cancel active streams

3. **Handler Updates** (`handler.ts`)
   - Modified `/v1/llm/answers` endpoint
   - Writes to Redis Stream instead of direct SSE
   - Returns immediately with conversationId

## API Endpoints

### 1. Start Streaming (Modified)

**POST** `/v1/llm/answers`

Start a streaming conversation. Instead of returning an SSE stream directly, it now:
- Initializes a Redis Stream
- Returns immediately with conversationId
- Streams data to Redis in the background

**Request:**
```json
{
  "prompt": "Tell me about quantum computing",
  "stream": true,
  "conversationId": "optional-existing-id"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_abc123",
    "streaming": true,
    "message": "Stream started. Use /v1/llm/stream/subscribe/:conversationId to receive events."
  }
}
```

**Headers:**
- `X-Conversation-Id`: The conversation ID for subscribing to the stream

---

### 2. Check Stream Status

**GET** `/v1/llm/stream/status/:conversationId`

Check if a conversation is actively streaming and get metadata.

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_abc123",
    "status": "streaming",
    "startedAt": "2025-11-05T12:00:00.000Z",
    "model": "gpt-4",
    "totalChunks": 42
  }
}
```

**Status Values:**
- `streaming`: Stream is currently active
- `completed`: Stream finished successfully
- `error`: Stream encountered an error
- `cancelled`: Stream was cancelled by user

---

### 3. Subscribe to Stream

**GET** `/v1/llm/stream/subscribe/:conversationId?fromId=<streamId>&replay=<true|false>`

Subscribe to a stream and receive events via Server-Sent Events (SSE).

**Query Parameters:**
- `fromId` (optional): Redis Stream entry ID to start from (default: `"0"` for beginning)
- `replay` (optional): If `true`, replay entire stream and close. If `false`, stream live updates (default: `false`)

**Response:** Server-Sent Events (SSE)

**Event Types:**

1. **metadata** - Initial stream metadata
   ```json
   event: metadata
   data: {"conversationId":"conv_abc123","status":"streaming","startedAt":"...","model":"gpt-4"}
   ```

2. **entry** - Stream entry (chunk, metadata, sources, etc.)
   ```json
   event: entry
   data: {"id":"1699123456789-0","type":"chunk","conversationId":"conv_abc123","timestamp":"...","data":"Hello"}
   ```

   Entry types:
   - `chunk`: Text chunk from LLM
   - `metadata`: Usage statistics and other metadata
   - `sources`: Source references (from web search, etc.)
   - `complete`: Stream completed successfully
   - `error`: Stream encountered an error

3. **done** - Stream subscription ended
   ```json
   event: done
   data: {"message":"Stream complete"}
   ```

4. **error** - Error occurred
   ```json
   event: error
   data: {"error":"Error message"}
   ```

**Example (JavaScript):**
```javascript
const eventSource = new EventSource('/api/v1/llm/stream/subscribe/conv_abc123');

eventSource.addEventListener('entry', (event) => {
  const { type, data } = JSON.parse(event.data);

  if (type === 'chunk') {
    console.log('Received chunk:', data);
  } else if (type === 'complete') {
    console.log('Stream complete');
    eventSource.close();
  }
});

eventSource.addEventListener('error', (event) => {
  console.error('Stream error:', event);
  eventSource.close();
});
```

---

### 4. Cancel Stream

**POST** `/v1/llm/stream/cancel/:conversationId`

Cancel an active stream. The stream will stop processing and save any partial response.

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Stream cancelled for conversation conv_abc123"
  }
}
```

**Error Responses:**
- `404`: Stream not found
- `400`: Stream is not active (already completed, errored, or cancelled)

---

## Usage Examples

### Complete Workflow

#### 1. Start Streaming
```bash
curl -X POST http://localhost:4000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain machine learning",
    "stream": true
  }'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_xyz789",
    "streaming": true,
    "message": "Stream started. Use /v1/llm/stream/subscribe/:conversationId to receive events."
  }
}
```

#### 2. Check Status
```bash
curl http://localhost:4000/api/v1/llm/stream/status/conv_xyz789
```

**Response:**
```json
{
  "success": true,
  "data": {
    "conversationId": "conv_xyz789",
    "status": "streaming",
    "startedAt": "2025-11-05T12:00:00.000Z",
    "model": "gpt-4",
    "totalChunks": 15
  }
}
```

#### 3. Subscribe to Stream
```bash
curl -N http://localhost:4000/api/v1/llm/stream/subscribe/conv_xyz789
```

**Output (SSE):**
```
event: metadata
data: {"conversationId":"conv_xyz789","status":"streaming",...}

event: entry
data: {"id":"...","type":"chunk","data":"Machine"}

event: entry
data: {"id":"...","type":"chunk","data":" learning"}

event: entry
data: {"id":"...","type":"complete"}

event: done
data: {"message":"Stream complete"}
```

#### 4. Replay Stream (Later)
```bash
curl -N "http://localhost:4000/api/v1/llm/stream/subscribe/conv_xyz789?replay=true"
```

This replays the entire stream from the beginning and then closes.

#### 5. Resume from Specific Point
```bash
curl -N "http://localhost:4000/api/v1/llm/stream/subscribe/conv_xyz789?fromId=1699123456789-5"
```

This continues from entry ID `1699123456789-5`, allowing you to resume a disconnected stream.

#### 6. Cancel Stream
```bash
curl -X POST http://localhost:4000/api/v1/llm/stream/cancel/conv_xyz789
```

---

## Frontend Integration

### React Example with EventSource

```typescript
import { useEffect, useState } from 'react';

interface StreamMessage {
  type: 'chunk' | 'metadata' | 'sources' | 'complete' | 'error';
  data?: string;
  metadata?: Record<string, unknown>;
  sources?: Array<{ url: string; title?: string }>;
}

function ChatComponent() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Start streaming
  const startConversation = async (prompt: string) => {
    const response = await fetch('/api/v1/llm/answers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, stream: true }),
    });

    const { data } = await response.json();
    setConversationId(data.conversationId);
    setIsStreaming(true);
  };

  // Subscribe to stream
  useEffect(() => {
    if (!conversationId || !isStreaming) return;

    const eventSource = new EventSource(
      `/api/v1/llm/stream/subscribe/${conversationId}`
    );

    eventSource.addEventListener('entry', (event) => {
      const entry: StreamMessage = JSON.parse(event.data);

      if (entry.type === 'chunk') {
        setMessages((prev) => prev + entry.data);
      } else if (entry.type === 'complete') {
        setIsStreaming(false);
        eventSource.close();
      } else if (entry.type === 'error') {
        console.error('Stream error');
        setIsStreaming(false);
        eventSource.close();
      }
    });

    eventSource.addEventListener('error', () => {
      setIsStreaming(false);
      eventSource.close();
    });

    return () => {
      eventSource.close();
    };
  }, [conversationId, isStreaming]);

  // Cancel stream
  const cancelStream = async () => {
    if (!conversationId) return;

    await fetch(`/api/v1/llm/stream/cancel/${conversationId}`, {
      method: 'POST',
    });

    setIsStreaming(false);
  };

  return (
    <div>
      <button onClick={() => startConversation('Hello!')}>
        Start Conversation
      </button>
      {isStreaming && (
        <button onClick={cancelStream}>Cancel Stream</button>
      )}
      <div>{messages}</div>
    </div>
  );
}
```

---

## Redis Stream Structure

### Stream Key Format

- **Stream**: `llm:stream:{conversationId}`
- **Metadata**: `llm:stream:meta:{conversationId}`
- **Cancellation Flag**: `llm:stream:cancel:{conversationId}`

### Stream Entry Format

Each entry in the Redis Stream contains:

```json
{
  "type": "chunk" | "metadata" | "sources" | "complete" | "error",
  "conversationId": "conv_abc123",
  "timestamp": "2025-11-05T12:00:00.000Z",
  "data": "...",           // for type: "chunk"
  "metadata": {...},       // for type: "metadata"
  "sources": [...],        // for type: "sources"
  "error": "..."           // for type: "error"
}
```

### Expiration

- Streams expire after **1 hour** of completion/error
- Metadata expires after **1 hour**
- Cancellation flags expire after **1 minute**

---

## Migration from Old Streaming

### Before (Direct SSE)

```javascript
const response = await fetch('/api/v1/llm/answers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Hello', stream: true }),
});

// Direct SSE stream
const reader = response.body.getReader();
// ... read stream
```

### After (Event-Driven)

```javascript
// 1. Start stream
const response = await fetch('/api/v1/llm/answers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: 'Hello', stream: true }),
});

const { data } = await response.json();
const conversationId = data.conversationId;

// 2. Subscribe to stream
const eventSource = new EventSource(
  `/api/v1/llm/stream/subscribe/${conversationId}`
);

eventSource.addEventListener('entry', (event) => {
  const entry = JSON.parse(event.data);
  // Handle entry
});
```

### Backward Compatibility

Non-streaming requests (`stream: false`) continue to work as before, returning a complete JSON response.

---

## Benefits

1. **Scalability**: Multiple clients can subscribe to the same stream
2. **Fault Tolerance**: Clients can reconnect and resume from last position
3. **Replay**: Complete conversation history available for replay
4. **Cancellation**: Proper cancellation support with partial response preservation
5. **Monitoring**: Stream status can be checked independently
6. **Decoupling**: Stream generation and consumption are independent processes

---

## Configuration

The stream service uses the existing Redis configuration from `@llm-service/redis`.

Ensure Redis is configured properly in your `.env`:

```env
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
```

---

## Troubleshooting

### Stream Not Found

**Error**: `No stream found for conversation conv_abc123`

**Causes**:
- Stream expired (1 hour after completion)
- Invalid conversation ID
- Stream was deleted

**Solution**: Start a new stream with POST `/v1/llm/answers`

### Stream Already Completed

**Error**: `Stream for conversation conv_abc123 is not active (status: completed)`

**Solution**: This is expected. Use `replay=true` to replay the completed stream, or check the conversation history with GET `/v1/llm/conversations/:conversationId`

### EventSource Errors

**Error**: EventSource connection errors

**Causes**:
- Network issues
- Server restart
- Stream cancelled/completed

**Solution**:
- Check stream status with GET `/v1/llm/stream/status/:conversationId`
- Retry connection with last known `fromId`

### Missing Chunks

**Error**: Gaps in received chunks

**Solution**: Use `fromId` parameter to resume from last successfully received entry:
```
GET /v1/llm/stream/subscribe/:conversationId?fromId=1699123456789-42
```

---

## Performance Considerations

1. **Polling Interval**: Subscribe endpoint polls Redis every 100ms for new entries
2. **Max Stream Length**: Streams keep last ~1000 entries (older entries may be trimmed)
3. **Cancellation Check**: Background streaming checks for cancellation every 500ms
4. **Memory**: Each active stream holds conversation context in memory during generation

---

## Future Enhancements

Potential improvements:

- [ ] WebSocket support for lower latency
- [ ] Stream compression for large responses
- [ ] Multi-region stream replication
- [ ] Stream analytics and monitoring
- [ ] Configurable TTL per stream
- [ ] Rate limiting per conversation
