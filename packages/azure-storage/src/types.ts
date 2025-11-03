export interface FileUploadOptions {
  containerName: string;
  fileName: string;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface UploadResult {
  url: string;
  fileName: string;
  size: number;
  etag: string;
}

export interface DeleteResult {
  success: boolean;
  fileName: string;
}

export interface DownloadResult {
  content: Buffer;
  fileName: string;
  contentType?: string;
  size: number;
  etag?: string;
  metadata?: Record<string, string>;
}
