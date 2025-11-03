import { BlobServiceClient, StorageSharedKeyCredential, generateBlobSASQueryParameters, BlobSASPermissions } from "@azure/storage-blob";
import { createLogger } from "@llm-service/logger";
import type {
  FileUploadOptions,
  UploadResult,
  DeleteResult,
  DownloadResult,
} from "./types";

const logger = createLogger("AZURE_STORAGE");

export class AzureBlobStorage {
  private blobServiceClient: BlobServiceClient;
  private connectionString: string;

  constructor(connectionString: string) {
    this.connectionString = connectionString;
    this.blobServiceClient =
      BlobServiceClient.fromConnectionString(connectionString);
  }

  async uploadFile(
    file: ArrayBuffer | Buffer | Blob,
    options: FileUploadOptions,
  ): Promise<UploadResult> {
    try {
      const containerClient = this.blobServiceClient.getContainerClient(
        options.containerName,
      );
      const blockBlobClient = containerClient.getBlockBlobClient(
        options.fileName,
      );

      logger.info(
        `Uploading file: ${options.fileName} to container: ${options.containerName}`,
      );

      const uploadResponse = await blockBlobClient.uploadData(file, {
        blobHTTPHeaders: { blobContentType: options.contentType },
        metadata: options.metadata,
      });

      const result: UploadResult = {
        url: blockBlobClient.url,
        fileName: options.fileName,
        size:
          uploadResponse._response.status === 201
            ? file instanceof ArrayBuffer
              ? file.byteLength
              : file instanceof Blob
                ? file.size
                : (file as Buffer).length
            : 0,
        etag: uploadResponse.etag || "",
      };

      logger.info(`Successfully uploaded file: ${options.fileName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to upload file: ${options.fileName}`, error);
      throw error;
    }
  }

  async deleteFile(
    containerName: string,
    fileName: string,
  ): Promise<DeleteResult> {
    try {
      const containerClient =
        this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      logger.info(
        `Deleting file: ${fileName} from container: ${containerName}`,
      );

      await blockBlobClient.delete();

      logger.info(`Successfully deleted file: ${fileName}`);
      return { success: true, fileName };
    } catch (error) {
      logger.error(`Failed to delete file: ${fileName}`, error);
      return { success: false, fileName };
    }
  }

  async downloadFile(
    containerName: string,
    fileName: string,
  ): Promise<DownloadResult> {
    try {
      const containerClient =
        this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      logger.info(
        `Downloading file: ${fileName} from container: ${containerName}`,
      );

      const downloadResponse = await blockBlobClient.download();
      const content = await this.streamToBuffer(
        downloadResponse.readableStreamBody!,
      );

      const result: DownloadResult = {
        content,
        fileName,
        contentType: downloadResponse.contentType,
        size: downloadResponse.contentLength || 0,
        etag: downloadResponse.etag,
        metadata: downloadResponse.metadata,
      };

      logger.info(`Successfully downloaded file: ${fileName}`);
      return result;
    } catch (error) {
      logger.error(`Failed to download file: ${fileName}`, error);
      throw error;
    }
  }

  getFileUrl(containerName: string, fileName: string): string {
    const containerClient =
      this.blobServiceClient.getContainerClient(containerName);
    const blockBlobClient = containerClient.getBlockBlobClient(fileName);
    return blockBlobClient.url;
  }

  /**
   * Generates a signed URL (SAS token) for a file
   * @param containerName - Container name
   * @param fileName - File name/path
   * @param expiresInMinutes - Expiration time in minutes (default: 60)
   * @returns Signed URL with SAS token
   */
  generateSignedUrl(
    containerName: string,
    fileName: string,
    expiresInMinutes: number = 60,
  ): string {
    try {
      // Parse connection string to get account name and key
      const connectionStringParts = this.connectionString.split(";");
      const accountNameMatch = connectionStringParts.find((part) =>
        part.startsWith("AccountName="),
      );
      const accountKeyMatch = connectionStringParts.find((part) =>
        part.startsWith("AccountKey="),
      );

      if (!accountNameMatch || !accountKeyMatch) {
        throw new Error(
          "Invalid connection string. AccountName and AccountKey are required.",
        );
      }

      const accountName = accountNameMatch.split("=")[1];
      const accountKey = accountKeyMatch.split("=")[1];

      const sharedKeyCredential = new StorageSharedKeyCredential(
        accountName,
        accountKey,
      );

      const containerClient =
        this.blobServiceClient.getContainerClient(containerName);
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);

      // Set expiration time
      const expiresOn = new Date();
      expiresOn.setMinutes(expiresOn.getMinutes() + expiresInMinutes);

      // Generate SAS token with read permissions
      const sasToken = generateBlobSASQueryParameters(
        {
          containerName,
          blobName: fileName,
          permissions: BlobSASPermissions.parse("r"), // Read permission
          expiresOn,
        },
        sharedKeyCredential,
      ).toString();

      const signedUrl = `${blockBlobClient.url}?${sasToken}`;

      logger.info(
        `Generated signed URL for ${fileName} (expires in ${expiresInMinutes} minutes)`,
      );

      return signedUrl;
    } catch (error) {
      logger.error(
        `Failed to generate signed URL for ${fileName}`,
        error,
      );
      throw error;
    }
  }

  private async streamToBuffer(
    readableStream: NodeJS.ReadableStream,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      readableStream.on("data", (data) => {
        chunks.push(data instanceof Buffer ? data : Buffer.from(data));
      });
      readableStream.on("end", () => {
        resolve(Buffer.concat(chunks));
      });
      readableStream.on("error", reject);
    });
  }
}

// Singleton instance for convenience
let azureStorage: AzureBlobStorage;

export function initializeAzureStorage(connectionString: string): void {
  azureStorage = new AzureBlobStorage(connectionString);
}

export function uploadFile(
  file: ArrayBuffer | Buffer | Blob,
  options: FileUploadOptions,
): Promise<UploadResult> {
  if (!azureStorage) {
    throw new Error(
      "Azure Storage not initialized. Call initializeAzureStorage() first.",
    );
  }
  return azureStorage.uploadFile(file, options);
}

export function deleteFile(
  containerName: string,
  fileName: string,
): Promise<DeleteResult> {
  if (!azureStorage) {
    throw new Error(
      "Azure Storage not initialized. Call initializeAzureStorage() first.",
    );
  }
  return azureStorage.deleteFile(containerName, fileName);
}

export function downloadFile(
  containerName: string,
  fileName: string,
): Promise<DownloadResult> {
  if (!azureStorage) {
    throw new Error(
      "Azure Storage not initialized. Call initializeAzureStorage() first.",
    );
  }
  return azureStorage.downloadFile(containerName, fileName);
}

export function getFileUrl(containerName: string, fileName: string): string {
  if (!azureStorage) {
    throw new Error(
      "Azure Storage not initialized. Call initializeAzureStorage() first.",
    );
  }
  return azureStorage.getFileUrl(containerName, fileName);
}

export function generateSignedUrl(
  containerName: string,
  fileName: string,
  expiresInMinutes?: number,
): string {
  if (!azureStorage) {
    throw new Error(
      "Azure Storage not initialized. Call initializeAzureStorage() first.",
    );
  }
  return azureStorage.generateSignedUrl(
    containerName,
    fileName,
    expiresInMinutes,
  );
}
