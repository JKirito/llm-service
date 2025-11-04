#!/usr/bin/env bun

/**
 * Quick test script for basic functionality
 * Tests a simple upload -> generate flow
 */

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:4000";
const CONTAINER_NAME = process.env.CONTAINER_NAME || "test-documents";
const API_URL = `${API_BASE_URL}/api`;

async function quickTest() {
  console.log("🚀 Quick Test: Upload & Generate Flow\n");

  try {
    // Step 1: Upload file
    console.log("1️⃣ Uploading test file...");
    const formData = new FormData();
    const content = "This is a test document for LLM processing.";
    const blob = new Blob([content], { type: "text/plain" });
    const file = new File([blob], "test.txt", { type: "text/plain" });
    formData.append("file", file);
    formData.append("containerName", CONTAINER_NAME);

    const uploadResponse = await fetch(`${API_URL}/v1/files/upload`, {
      method: "POST",
      body: formData,
    });

    if (!uploadResponse.ok) {
      const error = await uploadResponse.json();
      throw new Error(error.error || `Upload failed: ${uploadResponse.status}`);
    }

    const uploadResult = await uploadResponse.json();
    if (!uploadResult.success || !uploadResult.data) {
      throw new Error(uploadResult.error || "Upload failed");
    }

    const documentReference = uploadResult.data.documentReference;
    console.log(`✅ Uploaded: ${documentReference}\n`);

    // Step 2: Generate with document
    console.log("2️⃣ Generating answer with document...");
    const generateResponse = await fetch(`${API_URL}/v1/llm/answers`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: "What does the document say?",
        documentReferences: [documentReference],
      }),
    });

    if (!generateResponse.ok) {
      const error = await generateResponse.json();
      throw new Error(
        error.error || `Generate failed: ${generateResponse.status}`,
      );
    }

    const generateResult = await generateResponse.json();
    if (!generateResult.success || !generateResult.data) {
      throw new Error(generateResult.error || "Generate failed");
    }

    console.log(`✅ Generated response:`);
    console.log(`   Conversation ID: ${generateResult.data.conversationId}`);
    console.log(
      `   Response: ${generateResult.data.text.substring(0, 200)}...\n`,
    );

    console.log("✨ Test completed successfully!");

    return {
      documentReference,
      conversationId: generateResult.data.conversationId,
    };
  } catch (error) {
    console.error(
      "❌ Test failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

quickTest();
