#!/usr/bin/env bun

/**
 * Test script for document upload and LLM generate flow
 * 
 * Usage:
 *   bun scripts/test-document-flow.ts
 * 
 * Environment variables (optional):
 *   API_BASE_URL - Base URL for API (default: http://localhost:4000)
 *   CONTAINER_NAME - Container name for uploads (default: test-documents)
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const CONTAINER_NAME = process.env.CONTAINER_NAME || "test-documents";
const API_URL = `${API_BASE_URL}/api`;

// Colors for console output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color: keyof typeof colors = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message: string) {
  log(`✓ ${message}`, "green");
}

function logError(message: string) {
  log(`✗ ${message}`, "red");
}

function logInfo(message: string) {
  log(`ℹ ${message}`, "blue");
}

function logStep(message: string) {
  log(`\n▶ ${message}`, "cyan");
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

interface UploadResponse {
  url: string;
  fileName: string;
  containerName: string;
  documentReference: string;
  size: number;
  etag: string;
}

interface GenerateResponse {
  conversationId: string;
  model: string;
  text: string;
  usage?: unknown;
  warnings?: unknown;
}

/**
 * Test 1: Upload a single file
 */
async function testUploadFile(
  fileName: string,
  content: string,
  contentType = "text/plain",
): Promise<string | null> {
  logStep(`Test 1: Uploading file "${fileName}"`);

  try {
    const formData = new FormData();
    const blob = new Blob([content], { type: contentType });
    const file = new File([blob], fileName, { type: contentType });
    formData.append("file", file);
    formData.append("containerName", CONTAINER_NAME);

    const response = await fetch(`${API_URL}/v1/files/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<UploadResponse> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || "Upload failed");
    }

    logSuccess(
      `File uploaded: ${result.data.fileName} (${result.data.size} bytes)`,
    );
    logInfo(`Document reference: ${result.data.documentReference}`);
    logInfo(`URL: ${result.data.url}`);

    return result.data.documentReference;
  } catch (error) {
    logError(`Upload failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Test 2: Generate answer with document reference
 */
async function testGenerateWithDocument(
  prompt: string,
  documentReferences: string[],
  stream = false,
): Promise<GenerateResponse | null> {
  logStep(
    `Test 2: Generating answer with ${documentReferences.length} document(s)`,
  );

  try {
    const response = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        documentReferences,
        stream,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    if (stream) {
      logInfo("Streaming response...");
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          fullText += chunk;
          process.stdout.write(chunk);
        }
      }

      logSuccess("\nStream completed");
      return {
        conversationId: response.headers.get("X-Conversation-Id") || "",
        model: "unknown",
        text: fullText,
      };
    } else {
      const result: ApiResponse<GenerateResponse> = await response.json();

      if (!result.success || !result.data) {
        throw new Error(result.error || "Generate failed");
      }

      logSuccess(`Response received (${result.data.text.length} chars)`);
      logInfo(`Conversation ID: ${result.data.conversationId}`);
      logInfo(`Model: ${result.data.model}`);
      logInfo(`Usage: ${JSON.stringify(result.data.usage || {})}`);
      logInfo(`Response preview: ${result.data.text.substring(0, 200)}...`);

      return result.data;
    }
  } catch (error) {
    logError(`Generate failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Test 3: Continue conversation
 */
async function testContinueConversation(
  conversationId: string,
  prompt: string,
): Promise<GenerateResponse | null> {
  logStep(`Test 3: Continuing conversation ${conversationId}`);

  try {
    const response = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        conversationId,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    const result: ApiResponse<GenerateResponse> = await response.json();

    if (!result.success || !result.data) {
      throw new Error(result.error || "Generate failed");
    }

    logSuccess("Conversation continued");
    logInfo(`Response preview: ${result.data.text.substring(0, 200)}...`);

    return result.data;
  } catch (error) {
    logError(`Continue failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Test 4: Multiple documents
 */
async function testMultipleDocuments(
  documentReferences: string[],
): Promise<GenerateResponse | null> {
  logStep(`Test 4: Testing with ${documentReferences.length} documents`);

  return await testGenerateWithDocument(
    "Compare and summarize the key points from all documents.",
    documentReferences,
  );
}

/**
 * Test 5: Nested path
 */
async function testNestedPath(): Promise<string | null> {
  logStep("Test 5: Testing nested file path");

  const content = "This is a document stored in a nested folder structure.";
  const fileName = "nested/path/test-document.txt";

  return await testUploadFile(fileName, content);
}

/**
 * Main test runner
 */
async function runTests() {
  log("\n" + "=".repeat(60), "cyan");
  log("Document Upload & Generate Flow Test Suite", "cyan");
  log("=".repeat(60), "cyan");
  logInfo(`API URL: ${API_URL}`);
  logInfo(`Container: ${CONTAINER_NAME}`);

  const results: {
    test: string;
    passed: boolean;
    details?: string;
  }[] = [];

  // Test 1: Upload single file
  log("\n" + "-".repeat(60));
  const doc1Content = `Document 1: Project Overview

This document contains information about our project.
Key points:
- Project started in 2024
- Main goal is to build an LLM service
- Using Bun runtime
- Azure Blob Storage for file management

This is a test document for verifying the document parsing and LLM integration flow.`;

  const doc1Ref = await testUploadFile("test-document-1.txt", doc1Content);
  results.push({
    test: "Upload single file",
    passed: doc1Ref !== null,
    details: doc1Ref || undefined,
  });

  if (!doc1Ref) {
    logError("Cannot continue tests without successful upload");
    return;
  }

  // Test 2: Generate with document
  log("\n" + "-".repeat(60));
  const generateResult = await testGenerateWithDocument(
    "What is the main goal of the project mentioned in the document?",
    [doc1Ref],
  );
  results.push({
    test: "Generate with document",
    passed: generateResult !== null,
    details: generateResult?.conversationId,
  });

  if (!generateResult) {
    logError("Cannot continue tests without successful generate");
    return;
  }

  // Test 3: Continue conversation
  log("\n" + "-".repeat(60));
  const continueResult = await testContinueConversation(
    generateResult.conversationId,
    "What technology stack is mentioned?",
  );
  results.push({
    test: "Continue conversation",
    passed: continueResult !== null,
  });

  // Test 4: Upload second document
  log("\n" + "-".repeat(60));
  const doc2Content = `Document 2: Technical Details

Technical specifications:
- Runtime: Bun
- Database: MongoDB
- Storage: Azure Blob Storage
- AI SDK: Vercel AI SDK v5
- Language: TypeScript

This document provides technical implementation details.`;

  const doc2Ref = await testUploadFile("test-document-2.txt", doc2Content);
  results.push({
    test: "Upload second file",
    passed: doc2Ref !== null,
  });

  // Test 5: Multiple documents
  if (doc2Ref) {
    log("\n" + "-".repeat(60));
    const multiDocResult = await testMultipleDocuments([doc1Ref, doc2Ref]);
    results.push({
      test: "Generate with multiple documents",
      passed: multiDocResult !== null,
    });
  }

  // Test 6: Nested path
  log("\n" + "-".repeat(60));
  const nestedRef = await testNestedPath();
  results.push({
    test: "Upload with nested path",
    passed: nestedRef !== null,
  });

  // Summary
  log("\n" + "=".repeat(60), "cyan");
  log("Test Summary", "cyan");
  log("=".repeat(60), "cyan");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    if (result.passed) {
      logSuccess(`${result.test} - PASSED`);
    } else {
      logError(`${result.test} - FAILED`);
    }
    if (result.details) {
      logInfo(`  Details: ${result.details}`);
    }
  });

  log("\n" + "-".repeat(60));
  log(`Tests passed: ${passed}/${total}`, passed === total ? "green" : "yellow");
  log("=".repeat(60), "cyan");
}

// Run tests
runTests().catch((error) => {
  logError(`Test suite failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

