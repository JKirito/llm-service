import { createLogger } from "@llm-service/logger";

const logger = createLogger("DOCUMENT_PARSER");

/**
 * Mock document parser service
 * TODO: Replace with actual parser service integration
 */
export async function parseDocument(
  content: Buffer,
  contentType: string,
  fileName: string,
): Promise<string> {
  logger.info(`Parsing document: ${fileName} (${contentType}, ${content.length} bytes)`);

  // Mock implementation - simulate parsing delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Return mock parsed content
  // In production, this would call an actual parser service
  const mockContent = `Parsed content from ${fileName}

This is a mock implementation. The actual parser service will extract text content from the uploaded document.
Content type: ${contentType}
File size: ${content.length} bytes

[Actual parsed content would appear here after integrating with the parser service]`;

  logger.info(`Successfully parsed document: ${fileName}`);
  return mockContent;
}

