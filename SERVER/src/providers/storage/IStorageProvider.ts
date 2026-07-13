/// <reference types="node" />

export interface UploadOptions {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

export interface StorageProvider {
  /**
   * Uploads a file buffer to storage.
   * @returns The relative or absolute storage path/URL.
   */
  upload(options: UploadOptions): Promise<string>;

  /**
   * Retrieves a file buffer from storage.
   */
  download(storagePath: string): Promise<Buffer>;

  /**
   * Deletes a file from storage.
   */
  delete(storagePath: string): Promise<void>;

  /**
   * Returns the provider identifier (e.g. "LOCAL", "S3")
   */
  getProviderName(): string;
}
