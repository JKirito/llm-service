# Test Scripts

Test scripts for verifying the document upload and LLM generate flow.

## Prerequisites

1. **API Server Running**: Ensure the API server is running on `http://localhost:4000` (or set `API_BASE_URL` env var)
2. **Environment Variables**: Make sure your `.env` file has:
   - `AZURE_STORAGE_CONNECTION_STRING`
   - `OPENAI_API_KEY`
   - `MONGODB_URI`

## Available Test Scripts

### 1. Quick Test (`test:quick`)

Fast test of basic upload → generate flow.

```bash
bun run test:quick
```

**What it tests:**
- Uploads a single test file
- Generates an answer using the document reference
- Verifies basic functionality

### 2. Full Document Flow Test (`test:docs`)

Comprehensive test suite covering all features.

```bash
bun run test:docs
```

**What it tests:**
- ✅ Upload single file
- ✅ Generate answer with document reference
- ✅ Continue conversation
- ✅ Upload multiple files
- ✅ Generate with multiple documents
- ✅ Upload with nested file paths

**Output:** Detailed test results with pass/fail status for each test.

### 3. Edge Cases Test (`test:edge`)

Tests error handling and edge cases.

```bash
bun run test:edge
```

**What it tests:**
- Invalid document reference format
- Non-existent document references
- Empty document references array
- Missing prompt in request

## Configuration

You can configure the tests using environment variables:

```bash
# Set custom API base URL
API_BASE_URL=http://localhost:4000 bun run test:docs

# Set custom container name
CONTAINER_NAME=my-test-container bun run test:docs

# Combine both
API_BASE_URL=http://localhost:4000 CONTAINER_NAME=test-docs bun run test:docs
```

**Environment Variables:**
- `API_BASE_URL` - Base URL for API (default: `http://localhost:4000`)
- `CONTAINER_NAME` - Container name for uploads (default: `test-documents`)

## Example Usage

```bash
# Quick test
bun run test:quick

# Full test suite
bun run test:docs

# Edge cases only
bun run test:edge

# All tests
bun run test:quick && bun run test:docs && bun run test:edge
```

## Expected Output

### Quick Test
```
🚀 Quick Test: Upload & Generate Flow

1️⃣ Uploading test file...
✅ Uploaded: test-documents/test.txt

2️⃣ Generating answer with document...
✅ Generated response:
   Conversation ID: abc-123-def-456
   Response: Based on the document provided...

✨ Test completed successfully!
```

### Full Test Suite
```
============================================================
Document Upload & Generate Flow Test Suite
============================================================
ℹ API URL: http://localhost:4000/api
ℹ Container: test-documents

------------------------------------------------------------
▶ Test 1: Uploading file "test-document-1.txt"
✓ File uploaded: test-document-1.txt (1234 bytes)
ℹ Document reference: test-documents/test-document-1.txt
...

============================================================
Test Summary
============================================================
✓ Upload single file - PASSED
✓ Generate with document - PASSED
✓ Continue conversation - PASSED
...
------------------------------------------------------------
Tests passed: 6/6
============================================================
```

## Troubleshooting

### API Server Not Running
```
Error: fetch failed
```
**Solution:** Start the API server with `bun run dev:api`

### Azure Storage Connection Failed
```
Error: Failed to initialize Azure Storage
```
**Solution:** Check your `AZURE_STORAGE_CONNECTION_STRING` in `.env`

### OpenAI API Error
```
Error: Failed to generate answer
```
**Solution:** Check your `OPENAI_API_KEY` in `.env`

### MongoDB Connection Failed
```
Error: Failed to persist conversation
```
**Solution:** Check your `MONGODB_URI` in `.env` and ensure MongoDB is running

## Manual Testing

If you prefer to test manually:

1. **Upload a file:**
```bash
curl -X POST http://localhost:4000/api/v1/files/upload \
  -F "file=@/path/to/file.pdf" \
  -F "containerName=test-documents"
```

2. **Generate with document:**
```bash
curl -X POST http://localhost:4000/api/v1/llm/answers \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "What is in this document?",
    "documentReferences": ["test-documents/file.pdf"]
  }'
```

