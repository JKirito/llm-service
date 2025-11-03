#!/usr/bin/env bun

/**
 * Test script for edge cases and error handling
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const CONTAINER_NAME = process.env.CONTAINER_NAME || "test-documents";
const API_URL = `${API_BASE_URL}/api`;

function log(message: string, type: "info" | "success" | "error" = "info") {
  const colors = {
    info: "\x1b[36m",
    success: "\x1b[32m",
    error: "\x1b[31m",
    reset: "\x1b[0m",
  };
  const prefix = {
    info: "ℹ",
    success: "✓",
    error: "✗",
  };
  console.log(`${colors[type]}${prefix[type]} ${message}${colors.reset}`);
}

async function testInvalidDocumentReference() {
  log("\n▶ Test: Invalid document reference format", "info");
  try {
    const response = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test",
        documentReferences: ["invalid-no-slash"],
      }),
    });

    const result = await response.json();
    if (!result.success && result.error) {
      log(`Expected error handled: ${result.error}`, "success");
      return true;
    }
    log("Expected error but got success", "error");
    return false;
  } catch (error) {
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, "error");
    return false;
  }
}

async function testMissingFile() {
  log("\n▶ Test: Non-existent document reference", "info");
  try {
    const response = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "Test",
        documentReferences: [`${CONTAINER_NAME}/non-existent-file.txt`],
      }),
    });

    const result = await response.json();
    if (!result.success && result.error) {
      log(`Expected error handled: ${result.error}`, "success");
      return true;
    }
    log("Expected error but got success", "error");
    return false;
  } catch (error) {
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, "error");
    return false;
  }
}

async function testEmptyDocumentReferences() {
  log("\n▶ Test: Empty document references array", "info");
  try {
    const response = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: "What is 2+2?",
        documentReferences: [],
      }),
    });

    const result = await response.json();
    if (result.success) {
      log("Request handled without documents (expected)", "success");
      return true;
    }
    log(`Got error: ${result.error}`, "error");
    return false;
  } catch (error) {
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, "error");
    return false;
  }
}

async function testMissingPrompt() {
  log("\n▶ Test: Request without prompt", "info");
  try {
    const response = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentReferences: [`${CONTAINER_NAME}/test.txt`],
      }),
    });

    const result = await response.json();
    if (!result.success && result.error) {
      log(`Expected error handled: ${result.error}`, "success");
      return true;
    }
    log("Expected error but got success", "error");
    return false;
  } catch (error) {
    log(`Unexpected error: ${error instanceof Error ? error.message : String(error)}`, "error");
    return false;
  }
}

async function runEdgeCaseTests() {
  log("=".repeat(60), "info");
  log("Edge Case & Error Handling Tests", "info");
  log("=".repeat(60), "info");

  const results = [];

  results.push({
    test: "Invalid document reference format",
    passed: await testInvalidDocumentReference(),
  });

  results.push({
    test: "Non-existent document",
    passed: await testMissingFile(),
  });

  results.push({
    test: "Empty document references",
    passed: await testEmptyDocumentReferences(),
  });

  results.push({
    test: "Missing prompt",
    passed: await testMissingPrompt(),
  });

  // Summary
  log("\n" + "=".repeat(60), "info");
  log("Test Summary", "info");
  log("=".repeat(60), "info");

  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    if (result.passed) {
      log(`${result.test} - PASSED`, "success");
    } else {
      log(`${result.test} - FAILED`, "error");
    }
  });

  log(`\nTests passed: ${passed}/${total}`, passed === total ? "success" : "error");
}

runEdgeCaseTests().catch((error) => {
  log(`Test suite failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  process.exit(1);
});

