import fs from "fs/promises";
import path from "path";
import type { StorageProvider, UploadOptions } from "./IStorageProvider";
import { logger } from "../../config/logger";

export class LocalStorageProvider implements StorageProvider {
  private baseDir: string;

  constructor() {
    this.baseDir = path.join(process.cwd(), "uploads");
    // Ensure directory exists asynchronously
    fs.mkdir(this.baseDir, { recursive: true }).catch(err => {
      logger.error({ err }, "Failed to create local uploads directory");
    });
  }

  getProviderName(): string {
    return "LOCAL";
  }

  async upload(options: UploadOptions): Promise<string> {
    const filePath = path.join(this.baseDir, options.filename);
    await fs.writeFile(filePath, options.buffer);
    return `/uploads/${options.filename}`;
  }

  async download(storagePath: string): Promise<Buffer> {
    const filename = path.basename(storagePath);
    const filePath = path.join(this.baseDir, filename);
    return fs.readFile(filePath);
  }

  async delete(storagePath: string): Promise<void> {
    const filename = path.basename(storagePath);
    const filePath = path.join(this.baseDir, filename);
    try {
      await fs.unlink(filePath);
    } catch (error: any) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
