import { AssetEngine } from "../engines/asset.engine";
import type { AssetUploadOptions } from "../engines/asset.engine";
import { assetRepository } from "../repositories/asset.repository";
import { auditRepository } from "../repositories/audit.repository";
import { ActionModule, ActionType, AssetStatus } from "../../generated/prisma";
import type { z } from "zod";
import type { queryAssetsSchema } from "../validation/asset.validation";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";

export const assetService = {
  async uploadFile(options: AssetUploadOptions) {
    // 1. Enforce business limits based on configuration engine
    // Const MAX_SIZE = ConfigurationEngine.getAssetSettings().maxUploadSize;
    // ...

    // 2. Delegate storage and metadata to Engine
    const asset = await AssetEngine.uploadAsset(options);

    // 3. Fire-and-forget Audit
    if (options.uploadedById) {
      auditRepository.create({
        action: ActionType.CREATE,
        module: ActionModule.ASSET,
        performedBy: options.uploadedById,
        tableName: "assets",
        recordId: asset.id,
        newData: asset as any
      }).catch(() => {});
    }

    return asset;
  },

  async downloadFile(id: string, employeeId?: string, employeeRole?: string) {
    const { asset, buffer } = await AssetEngine.downloadAsset(id, employeeId, employeeRole);
    
    if (employeeId) {
      auditRepository.create({
        action: ActionType.UPDATE, // "DOWNLOAD" doesn't exist, UPDATE acts as read-log if strictly needed, or skip.
        module: ActionModule.ASSET,
        performedBy: employeeId,
        tableName: "assets",
        recordId: asset.id,
        newData: { event: "DOWNLOADED" }
      }).catch(() => {});
    }

    return { asset, buffer };
  },

  async deleteAsset(id: string, employeeId: string, permanent = false) {
    const asset = await assetRepository.findById(id);
    if (!asset) throw new AppError(HTTP_STATUS.NOT_FOUND, "Asset not found");

    await AssetEngine.deleteAsset(id, permanent);

    auditRepository.create({
      action: ActionType.DELETE,
      module: ActionModule.ASSET,
      performedBy: employeeId,
      tableName: "assets",
      recordId: id,
      newData: { event: permanent ? "PERMANENT_DELETE" : "SOFT_DELETE" }
    }).catch(() => {});
  },

  async getAssets(query: z.infer<typeof queryAssetsSchema>["query"]) {
    const skip = (query.page - 1) * query.limit;
    
    const where: any = {};
    if (query.ownerModule) where.ownerModule = query.ownerModule;
    if (query.status) where.status = query.status;
    
    if (query.search) {
      where.originalName = { contains: query.search, mode: "insensitive" };
    }

    const { items, total } = await assetRepository.findMany({
      skip,
      take: query.limit,
      where,
      orderBy: query.sortBy ? { [query.sortBy as string]: query.sortOrder || "desc" } : { createdAt: "desc" }
    });

    return {
      data: items,
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) }
    };
  }
};
