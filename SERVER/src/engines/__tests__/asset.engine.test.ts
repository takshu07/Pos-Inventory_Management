import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AssetEngine } from "../asset.engine";
import { assetRepository } from "../../repositories/asset.repository";
import { LocalStorageProvider } from "../../providers/storage/localStorageProvider";
import { AssetVisibility, AssetStatus } from "../../../generated/prisma";
import crypto from "crypto";

describe("AssetEngine", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should upload an asset correctly and delegate to storage provider", async () => {
    // Arrange
    const buffer = Buffer.from("test image content");
    const mockStoragePath = "/uploads/test.png";
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    // We spy on the underlying repository
    vi.spyOn(assetRepository, "findByChecksum").mockResolvedValue(null);
    vi.spyOn(assetRepository, "create").mockResolvedValue({
      id: "asset_123",
      originalName: "test.png",
      storedName: "random.png",
      storagePath: mockStoragePath,
      provider: "LOCAL",
      contentType: "image/png",
      sizeBytes: buffer.length,
      checksum,
      visibility: AssetVisibility.PRIVATE,
      status: AssetStatus.ACTIVE,
      ownerModule: "PRODUCT",
      ownerEntityId: "prod_1",
      uploadedById: "emp_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // We spy on the LocalStorageProvider
    vi.spyOn(LocalStorageProvider.prototype, "upload").mockResolvedValue(mockStoragePath);

    // Act
    const result = await AssetEngine.uploadAsset({
      buffer,
      originalName: "test.png",
      mimetype: "image/png",
      ownerModule: "PRODUCT",
      ownerEntityId: "prod_1",
      uploadedById: "emp_1",
    });

    // Assert
    expect(LocalStorageProvider.prototype.upload).toHaveBeenCalledTimes(1);
    expect(assetRepository.create).toHaveBeenCalledTimes(1);
    expect(result.id).toBe("asset_123");
    expect(result.storagePath).toBe(mockStoragePath);
  });

  it("should return existing asset if checksum and owner match perfectly (Idempotency)", async () => {
    // Arrange
    const buffer = Buffer.from("duplicate content");
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    const existingAsset = {
      id: "asset_existing",
      originalName: "old.png",
      storedName: "old.png",
      storagePath: "/uploads/old.png",
      provider: "LOCAL",
      contentType: "image/png",
      sizeBytes: buffer.length,
      checksum,
      visibility: AssetVisibility.PRIVATE,
      status: AssetStatus.ACTIVE,
      ownerModule: "PRODUCT",
      ownerEntityId: "prod_1",
      uploadedById: "emp_1",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    vi.spyOn(assetRepository, "findByChecksum").mockResolvedValue(existingAsset);
    vi.spyOn(LocalStorageProvider.prototype, "upload");

    // Act
    const result = await AssetEngine.uploadAsset({
      buffer,
      originalName: "new.png",
      mimetype: "image/png",
      ownerModule: "PRODUCT",
      ownerEntityId: "prod_1",
    });

    // Assert
    expect(LocalStorageProvider.prototype.upload).not.toHaveBeenCalled();
    expect(result.id).toBe("asset_existing");
  });
});
