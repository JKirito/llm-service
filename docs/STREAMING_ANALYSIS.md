# Streaming Implementation Analysis

## Current Problems

### What We Did Wrong

We **replaced** Vercel AI SDK's built-in streaming with a custom implementation:

**Before (Correct - Using AI SDK):**
```typescript
const stream = createUIMessageStream({
  async execute({ writer }) {
    const result = streamText({ ... });
    writer.merge(result.toUIMessageStream());
  },
  onFinish: async ({ messages }) => {
    // Persist to MongoDB
  }
});

return createUIMessageStreamResponse({ stream });
```
- ✅ Uses AI SDK's battle-tested streaming
- ✅ Handles SSE protocol correctly
- ✅ Supports tools, sources, metadata automatically
- ✅ Proper error handling
- ✅ Client-side abort signals

**After (Our Custom Implementation - Wrong Approach):**
```typescript
// Background process (non-blocking)
(async () => {
  const result = streamText({ ... });
  for await (const chunk of result.textStream) {
    await writeChunk(conversationId, chunk); // Manual Redis writes
  }
})();

// Return immediately
return Response.json({ conversationId, streaming: true });

// Separate endpoint for subscription
GET /stream/subscribe/:conversationId {
  // Custom SSE implementation
  // Custom polling logic
  // Race conditions we had to fix
}
```
- ❌ Threw away AI SDK streaming features
- ❌ Built custom SSE from scratch
- ❌ Required separate subscription endpoint
- ❌ Manual polling with race conditions
- ❌ Doesn't leverage AI SDK's built-in features

### Why This is a Problem

1. **Reinventing the wheel**: Vercel AI SDK already handles:
   - SSE protocol
   - Streaming chunked responses
   - Tool calls streaming
   - Source references
   - Metadata streaming
   - Error handling
   - Backpressure

2. **Complexity**: We added:
   - Custom Redis Stream service (400+ lines)
   - Custom SSE implementation
   - Polling logic with race conditions
   - Separate subscription endpoint
   - Manual state management

3. **Two-step process**: Client must:
   - POST to start stream → get conversationId
   - GET to subscribe → receive events
   - Instead of one streaming request

4. **Lost features**: AI SDK provides:
   - `streamableValue()` for React Server Components
   - Automatic tool call handling
   - Built-in retry logic
   - Proper TypeScript types

---

## What Vercel AI SDK Provides

### Core Streaming Functions

#### 1. `streamText()`
```typescript
const result = streamText({
  model: openai('gpt-4'),
  messages,
  tools,
  onChunk: ({ chunk }) => { /* side effect */ },
  onFinish: ({ text, usage }) => { /* side effect */ }
});
```

Returns:
- `result.textStream` - async iterable
- `result.toTextStreamResponse()` - HTTP Response with SSE
- `result.toUIMessageStream()` - UI message stream
- `result.fullStream` - combined stream (text + metadata)

#### 2. `createUIMessageStream()`
```typescript
const stream = createUIMessageStream({
  async execute({ writer }) {
    // Stream logic
    writer.write(...); // Write to stream
  },
  onFinish: async ({ messages }) => {
    // Persistence
  }
});
```

#### 3. `createUIMessageStreamResponse()`
```typescript
return createUIMessageStreamResponse({
  stream,
  headers: { 'X-Custom': 'value' }
});
```

Creates proper SSE Response automatically.

---

## Proposed Better Architecture

### Hybrid Approach: AI SDK Streaming + Redis Cache

Use **Vercel AI SDK for primary streaming**, Redis Stream as **side-effect cache** for replay.

```
┌─────────┐                  ┌──────────────┐                ┌───────────┐
│ Client  │  POST /answers   │   Handler    │                │  Redis    │
│         │  stream=true     │              │                │  Stream   │
│         ├─────────────────►│              │                │ (cache)   │
│         │                  │  ┌─────────┐ │   Side Effect  │           │
│         │◄─────────────────┤  │AI SDK   │─┼───────────────►│           │
│         │  SSE Stream      │  │Stream   │ │   writeChunk   │           │
│         │  (direct)        │  └─────────┘ │                │           │
└─────────┘                  └──────────────┘                └─────┬─────┘
                                                                    │
Later...                                                            │
┌─────────┐                  ┌──────────────┐                      │
│ Client  │  GET /replay     │   Handler    │   Read Stream        │
│         ├─────────────────►│              │◄─────────────────────┤
│         │◄─────────────────┤              │                      │
│         │  Replay SSE      │              │                      │
└─────────┘                  └──────────────┘                      │
```

### Implementation Strategy

#### Primary Flow (Live Streaming)
```typescript
// POST /v1/llm/answers?stream=true
export const generateAnswerHandler: RouteHandler = async (req) => {
  // ... validation ...

  if (streamRequested) {
    // Initialize Redis stream for caching
    await initializeStream(conversationId, model);

    // Use AI SDK's built-in streaming
    const stream = createUIMessageStream({
      async execute({ writer }) {
        const result = streamText({
          model: modelInstance,
          messages: modelMessages,
          tools: openAITools,
          abortSignal: req.signal,
        });

        // Merge AI SDK stream
        writer.merge(result.toUIMessageStream());

        // Side effect: Cache to Redis
        for await (const chunk of result.textStream) {
          await writeChunk(conversationId, chunk).catch(err =>
            logger.error('Failed to cache chunk', err)
          );
        }

        // Cache completion
        await completeStream(conversationId);
      },
      onFinish: async ({ messages }) => {
        // Persist to MongoDB
        await replaceConversationMessages(conversationId, messages);
      }
    });

    // Return AI SDK's response (proper SSE)
    return createUIMessageStreamResponse({
      stream,
      headers: {
        'X-Conversation-Id': conversationId
      }
    });
  }

  // Non-streaming...
};
```

#### Replay Flow (From Redis Cache)
```typescript
// GET /v1/llm/stream/replay/:conversationId
export const replayStreamHandler: RouteHandler = async (req) => {
  const conversationId = getConversationId(req);

  // Check if stream exists
  const metadata = await getStreamMetadata(conversationId);
  if (!metadata) {
    return Response.json({ error: 'Stream not found' }, { status: 404 });
  }

  // Get all cached entries
  const entries = await getAllStreamEntries(conversationId);

  // Convert to AI SDK format and stream
  const stream = createUIMessageStream({
    async execute({ writer }) {
      for (const { entry } of entries) {
        if (entry.type === 'chunk') {
          writer.writeTextDelta(entry.data);
        } else if (entry.type === 'sources') {
          // Write sources
        }
      }
    }
  });

  return createUIMessageStreamResponse({ stream });
};
```

---

## Benefits of Hybrid Approach

### ✅ Best of Both Worlds

1. **Proper Streaming**: Uses AI SDK's battle-tested implementation
2. **Replay Capability**: Redis cache allows reconnection/replay
3. **Simpler Code**: Removes 90% of our custom SSE logic
4. **All AI SDK Features**: Tools, sources, metadata, etc.
5. **One Request**: Client just calls POST /answers, gets stream
6. **Backward Compatible**: Add replay as separate endpoint

### ✅ Eliminates Problems

- ❌ No more custom SSE implementation
- ❌ No more polling logic
- ❌ No more race conditions
- ❌ No two-step subscription process
- ❌ No manual chunk management

### ✅ Keeps Good Features

- ✅ Redis caching for replay
- ✅ Stream status tracking
- ✅ Cancellation support (via req.signal)
- ✅ Conversation persistence

---

## Migration Plan

### Phase 1: Restore AI SDK Streaming
- Revert to `createUIMessageStream` + `createUIMessageStreamResponse`
- Add Redis caching as side effect in `execute()`
- Keep existing `/answers` endpoint

### Phase 2: Add Replay Endpoint
- Create `/v1/llm/stream/replay/:conversationId`
- Use cached Redis Stream data
- Convert to AI SDK stream format

### Phase 3: Simplify
- Remove custom SSE implementation from stream-routes.ts
- Remove `/subscribe` endpoint (use `/replay` instead)
- Simplify stream-service.ts (just caching, no serving)

### Phase 4: Optional Enhancements
- Add `resumeFrom` parameter for partial replay
- Add stream compression
- Add rate limiting

---

## Code Changes Required

### Files to Modify
1. `handler.ts` - Restore AI SDK streaming, add Redis caching
2. `stream-routes.ts` - Simplify to just replay endpoint
3. `stream-service.ts` - Keep caching logic, remove serving logic
4. `index.ts` - Update route definitions

### Files to Remove/Deprecate
- Custom SSE polling logic
- Subscription endpoint

### Estimated Changes
- **Remove**: ~200 lines of custom SSE
- **Add**: ~50 lines for Redis side-effect caching
- **Net**: Simpler, more maintainable codebase

---

## Decision Points

### Option A: Full Hybrid (Recommended)
- Use AI SDK for all live streaming
- Redis Stream only for caching/replay
- Clean, simple, leverages SDK

### Option B: Keep Current with Fixes
- Keep custom implementation
- Fix remaining race conditions
- More maintenance burden

### Option C: Pure AI SDK (No Redis)
- Remove Redis streaming entirely
- Use MongoDB conversation history for replay
- Simplest, but no mid-stream replay

---

## Recommendation

**Go with Option A (Full Hybrid)**

Reasoning:
1. Uses tools correctly (AI SDK + Redis for their strengths)
2. Simpler codebase (less custom code)
3. More maintainable (leverage SDK updates)
4. Better features (all AI SDK capabilities)
5. Keeps replay capability (Redis cache)

The key insight: **Redis Stream should be a cache/log, not the primary streaming mechanism.**
