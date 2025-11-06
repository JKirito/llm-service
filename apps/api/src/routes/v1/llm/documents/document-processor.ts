import { downloadFile } from "@llm-service/azure-storage";
import { parseDocument } from "../../../../lib/document-parser";
import { getFileUrlFromPath } from "../../../../lib/storage-url";
import { parseDocumentPath } from "../types";
import type { DocumentContext, MessageFileReference } from "../types";
import { createLogger } from "@llm-service/logger";

const logger = createLogger("DOCUMENT_PROCESSOR");

export interface ProcessedDocument {
  documentContext: DocumentContext;
  fileReference: MessageFileReference;
  openAIFileId?: string;
}

/**
 * Process multiple document references in parallel
 * Downloads from Azure Storage, parses content, and optionally uploads to OpenAI
 *
 * @param documentReferences - Array of document path strings (format: "containerName/path/to/file")
 * @param needsCodeInterpreter - Whether to upload files to OpenAI for code_interpreter tool
 * @param uploadToOpenAI - Function to upload file buffer to OpenAI and return file ID
 * @returns Array of processed documents with context, references, and OpenAI file IDs
 */
export async function processDocuments(
  documentReferences: string[],
  needsCodeInterpreter: boolean,
  uploadToOpenAI: (buffer: Buffer, filename: string) => Promise<string>
): Promise<ProcessedDocument[]> {
  try {
    // Process documents in parallel (Azure download + OpenAI upload)
    const documentPromises = documentReferences.map(async (docRef) => {
      try {
        const { containerName, filePath } = parseDocumentPath(docRef);

        // Download file from Azure Storage
        const downloadResult = await downloadFile(containerName, filePath);

        // Extract filename from metadata or use fileName
        const filename =
          downloadResult.metadata?.originalName || downloadResult.fileName;

        // Run Azure processing and OpenAI upload in parallel
        const [parsedContent, openAIFileId] = await Promise.all([
          // Parse document content for system prompt
          parseDocument(
            downloadResult.content,
            downloadResult.contentType || "application/octet-stream",
            downloadResult.fileName,
          ),
          // Upload to OpenAI Files API if code_interpreter is requested
          needsCodeInterpreter
            ? uploadToOpenAI(downloadResult.content, filename)
            : Promise.resolve(undefined),
        ]);

        // Generate file URL dynamically using path format
        const fullPath = `${containerName}/${filePath}`;
        const fileUrl = getFileUrlFromPath(fullPath);

        // Build DocumentContext
        const docContext: DocumentContext = {
          filename,
          content: parsedContent,
          url: fileUrl,
          containerName,
          filePath,
        };

        // Build file reference for message metadata
        const fileRef: MessageFileReference = {
          path: `${containerName}/${filePath}`,
          filename,
        };

        return {
          documentContext: docContext,
          fileReference: fileRef,
          openAIFileId,
        };
      } catch (error) {
        logger.error(
          `Failed to process document reference: ${docRef}`,
          error,
        );
        throw error;
      }
    });

    const results = await Promise.all(documentPromises);

    logger.info(
      `Successfully processed ${results.length} document(s)`,
    );

    return results;
  } catch (error) {
    logger.error("Failed to process documents", error);
    throw error;
  }
}
