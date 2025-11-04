export interface DocumentContext {
  filename: string;
  content: string;
  url: string;
  containerName: string;
  filePath: string;
}

export interface MessageFileReference {
  path: string;
  filename: string;
}

/**
 * Generic source reference for messages
 * Can be from tools (web_search), RAG, MCP, or other sources
 */
export interface MessageSource {
  type: string;
  sourceType: string;
  id: string;
  url: string;
  title?: string;
  sourceOrigin?: "tool" | "rag" | "mcp" | "document" | "other";
  sourceProvider?: string; // e.g., "web_search", "vector_search", "mcp_service"
  metadata?: Record<string, unknown>; // Additional metadata for extensibility
}

export interface ImageReference {
  imageId: string;
  path: string;
  prompt: string;
  revisedPrompt?: string;
  size: string;
  model: string;
  createdAt: string;
}

export interface ImageGenerationOptions {
  prompt: string;
  size?: string;
  quality?: "standard" | "hd";
  style?: "vivid" | "natural";
  n?: number;
  seed?: number;
}

export interface ParsedDocumentPath {
  containerName: string;
  filePath: string;
}

/**
 * Parses a document reference path string into container name and file path
 * Format: "containerName/path/to/file"
 * Example: "documents/reports/q1/analysis.pdf" -> { containerName: "documents", filePath: "reports/q1/analysis.pdf" }
 */
export function parseDocumentPath(path: string): ParsedDocumentPath {
  if (!path || typeof path !== "string" || path.trim() === "") {
    throw new Error("Document path cannot be empty");
  }

  const trimmedPath = path.trim();
  const firstSlashIndex = trimmedPath.indexOf("/");

  if (firstSlashIndex === -1) {
    throw new Error(
      `Invalid document path format: "${path}". Expected format: "containerName/path/to/file"`,
    );
  }

  const containerName = trimmedPath.substring(0, firstSlashIndex);
  const filePath = trimmedPath.substring(firstSlashIndex + 1);

  if (!containerName || !filePath) {
    throw new Error(
      `Invalid document path format: "${path}". Both container name and file path are required.`,
    );
  }

  return {
    containerName,
    filePath,
  };
}
