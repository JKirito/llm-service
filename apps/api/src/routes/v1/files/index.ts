import type { ApiResponse } from "@llm-service/types";
import type { Route, RouteHandler } from "../../types";
import {
  initializeAzureStorage,
  uploadFile,
  downloadFile,
  deleteFile,
  type UploadResult,
} from "@llm-service/azure-storage";
import { getSignedUrlFromPath } from "../../../lib/storage-url";
import { config } from "../../../config";

// Initialize Azure Storage (you'll need to call this with your connection string)
const connectionString = config.azure.connectionString;
let azureStorageInitialized = false;

function ensureAzureStorage(): Response | null {
  if (azureStorageInitialized) {
    return null;
  }

  try {
    initializeAzureStorage(connectionString);
    azureStorageInitialized = true;
    return null;
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to initialize Azure Storage",
    };
    return Response.json(response, { status: 500 });
  }
}

/**
 * POST /v1/files/upload
 * Upload a file to Azure Blob Storage
 */
export const uploadFileHandler: RouteHandler = async (req) => {
  try {
    const initResponse = ensureAzureStorage();
    if (initResponse) {
      return initResponse;
    }

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const containerName = formData.get("containerName") as string;

    if (!file) {
      const response: ApiResponse = {
        success: false,
        error: "No file provided",
      };
      return Response.json(response, { status: 400 });
    }

    if (!containerName) {
      const response: ApiResponse = {
        success: false,
        error: "Container name is required",
      };
      return Response.json(response, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const result: UploadResult = await uploadFile(buffer, {
      containerName,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      metadata: {
        originalName: file.name,
        uploadedAt: new Date().toISOString(),
      },
    });

    // Construct document reference path format
    const documentReference = `${containerName}/${result.fileName}`;

    const response: ApiResponse<
      UploadResult & {
        containerName: string;
        documentReference: string;
      }
    > = {
      success: true,
      data: {
        ...result,
        containerName,
        documentReference,
      },
      message: "File uploaded successfully",
    };
    return Response.json(response);
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload file",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * GET /v1/files/download/:containerName/:fileName
 * Download a file from Azure Blob Storage
 */
export const downloadFileHandler: RouteHandler = async (req, params) => {
  try {
    const initResponse = ensureAzureStorage();
    if (initResponse) {
      return initResponse;
    }

    const containerName = params?.containerName;
    const fileName = params?.fileName;

    if (!containerName || !fileName) {
      const response: ApiResponse = {
        success: false,
        error: "Container name and file name are required",
      };
      return Response.json(response, { status: 400 });
    }

    const result = await downloadFile(containerName, fileName);

    return new Response(new Uint8Array(result.content), {
      headers: {
        "Content-Type": result.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${result.fileName}"`,
        "Content-Length": result.size.toString(),
      },
    });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to download file",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * DELETE /v1/files/:containerName/:fileName
 * Delete a file from Azure Blob Storage
 */
export const deleteFileHandler: RouteHandler = async (req, params) => {
  try {
    const initResponse = ensureAzureStorage();
    if (initResponse) {
      return initResponse;
    }

    const containerName = params?.containerName;
    const fileName = params?.fileName;

    if (!containerName || !fileName) {
      const response: ApiResponse = {
        success: false,
        error: "Container name and file name are required",
      };
      return Response.json(response, { status: 400 });
    }

    const result = await deleteFile(containerName, fileName);

    const response: ApiResponse = {
      success: result.success,
      data: result,
      message: result.success
        ? "File deleted successfully"
        : "Failed to delete file",
    };
    return Response.json(response, { status: result.success ? 200 : 500 });
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete file",
    };
    return Response.json(response, { status: 500 });
  }
};

/**
 * POST /v1/files/signed-url
 * Generate a signed URL (SAS token) for a file using relative path
 */
export const generateSignedUrlHandler: RouteHandler = async (req) => {
  try {
    const initResponse = ensureAzureStorage();
    if (initResponse) {
      return initResponse;
    }

    let body: Record<string, unknown>;
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      const response: ApiResponse = {
        success: false,
        error: "Invalid JSON payload",
      };
      return Response.json(response, { status: 400 });
    }

    const path = body.path;
    if (typeof path !== "string" || path.trim() === "") {
      const response: ApiResponse = {
        success: false,
        error: "Path is required and must be a non-empty string",
      };
      return Response.json(response, { status: 400 });
    }

    // Validate path format (should be "containerName/filePath")
    const pathParts = path.trim().split("/");
    if (pathParts.length < 2) {
      const response: ApiResponse = {
        success: false,
        error:
          'Invalid path format. Expected format: "containerName/filePath"',
      };
      return Response.json(response, { status: 400 });
    }

    // Parse expiration time (optional, default: 60 minutes)
    let expiresInMinutes = 60;
    if (body.expiresInMinutes !== undefined) {
      const expiresValue =
        typeof body.expiresInMinutes === "number"
          ? body.expiresInMinutes
          : Number.parseInt(String(body.expiresInMinutes), 10);

      if (Number.isNaN(expiresValue) || expiresValue <= 0) {
        const response: ApiResponse = {
          success: false,
          error: "expiresInMinutes must be a positive number",
        };
        return Response.json(response, { status: 400 });
      }

      // Limit maximum expiration to 7 days (10080 minutes)
      if (expiresValue > 10080) {
        const response: ApiResponse = {
          success: false,
          error: "expiresInMinutes cannot exceed 10080 (7 days)",
        };
        return Response.json(response, { status: 400 });
      }

      expiresInMinutes = expiresValue;
    }

    const signedUrl = getSignedUrlFromPath(path.trim(), expiresInMinutes);

    const response: ApiResponse<{
      signedUrl: string;
      path: string;
      expiresInMinutes: number;
    }> = {
      success: true,
      data: {
        signedUrl,
        path: path.trim(),
        expiresInMinutes,
      },
      message: "Signed URL generated successfully",
    };

    return Response.json(response);
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error:
        error instanceof Error
          ? `Failed to generate signed URL: ${error.message}`
          : "Failed to generate signed URL",
    };
    return Response.json(response, { status: 500 });
  }
};

export const filesRoutes: Route[] = [
  {
    path: "/v1/files/upload",
    handler: uploadFileHandler,
    methods: ["POST"],
  },
  {
    path: "/v1/files/download/:containerName/:fileName",
    handler: downloadFileHandler,
    methods: ["GET"],
  },
  {
    path: "/v1/files/:containerName/:fileName",
    handler: deleteFileHandler,
    methods: ["DELETE"],
  },
  {
    path: "/v1/files/signed-url",
    handler: generateSignedUrlHandler,
    methods: ["POST"],
  },
];
