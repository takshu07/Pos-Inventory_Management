import crypto from "crypto";
import type { StorageProvider } from "../providers/storage/IStorageProvider";
import { LocalStorageProvider } from "../providers/storage/localStorageProvider";
import { assetRepository } from "../repositories/asset.repository";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AssetVisibility, AssetStatus } from "../../generated/prisma";
import type { Prisma } from "../../generated/prisma";
import { logger } from "../config/logger";

export interface AssetUploadOptions {
  buffer: Buffer;
  originalName: string;
  mimetype: string;
  ownerModule: string;
  ownerEntityId?: string | undefined;
  uploadedById?: string | undefined;
  visibility?: AssetVisibility | undefined;
}

export class AssetEngine {
  private static provider: StorageProvider;

  static {
    // In the future, this can dynamically load S3Provider based on ConfigurationEngine.
    this.provider = new LocalStorageProvider();
    logger.info(`[AssetEngine] Initialized with ${this.provider.getProviderName()} provider.`);
  }

  static async uploadAsset(options: AssetUploadOptions) {
    const sizeBytes = options.buffer.length;
    const checksum = crypto.createHash("sha256").update(options.buffer).digest("hex");
    
    // Validate uniqueness to prevent duplicates if identical file uploaded to same module
    const existing = await assetRepository.findByChecksum(checksum);
    if (existing && existing.ownerModule === options.ownerModule && existing.ownerEntityId === options.ownerEntityId) {
      return existing; // Idempotent upload
    }

    const ext = options.originalName.split(".").pop() || "bin";
    const storedName = `${crypto.randomUUID()}.${ext}`;

    // 1. Upload to Storage Provider (S3, Local, etc)
    const storagePath = await this.provider.upload({
      filename: storedName,
      mimetype: options.mimetype,
      buffer: options.buffer
    });

    // 2. Persist Metadata
    const assetData: Prisma.AssetUncheckedCreateInput = {
      originalName: options.originalName,
      storedName,
      storagePath,
      provider: this.provider.getProviderName(),
      contentType: options.mimetype,
      sizeBytes,
      checksum,
      ownerModule: options.ownerModule,
      ownerEntityId: options.ownerEntityId ?? null,
      uploadedById: options.uploadedById ?? null,
      visibility: options.visibility || AssetVisibility.PRIVATE,
      status: AssetStatus.ACTIVE
    };

    return assetRepository.create(assetData);
  }

  static async downloadAsset(id: string, requesterId?: string, requesterRole?: string) {
    const asset = await assetRepository.findById(id);
    if (!asset || asset.status === AssetStatus.SOFT_DELETED) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Asset not found");
    }

    if (asset.visibility === AssetVisibility.PRIVATE) {
      // In a real scenario, check if the requester owns the asset or is a Manager/Owner
      if (!requesterId) {
        throw new AppError(HTTP_STATUS.UNAUTHORIZED, "Unauthorized to view private asset");
      }
    }

    const buffer = await this.provider.download(asset.storagePath);
    return { asset, buffer };
  }

  static async deleteAsset(id: string, permanent = false) {
    const asset = await assetRepository.findById(id);
    if (!asset) return;

    if (permanent) {
      await this.provider.delete(asset.storagePath);
      await assetRepository.delete(id);
    } else {
      await assetRepository.updateStatus(id, AssetStatus.SOFT_DELETED);
    }
  }
}
