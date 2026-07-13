import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/httpStatus";
import { assetService } from "../services/asset.service";
import { queryAssetsSchema, uploadAssetMetadataSchema } from "../validation/asset.validation";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../errors/AppError";
import type { AssetVisibility } from "../../generated/prisma";

export const uploadAsset = asyncHandler(async (req: Request, res: Response) => {
  if (!req.file) throw new AppError(HTTP_STATUS.BAD_REQUEST, "No file uploaded.");

  const payload = uploadAssetMetadataSchema.parse({ body: req.body }).body;
  
  const asset = await assetService.uploadFile({
    buffer: req.file.buffer,
    originalName: req.file.originalname,
    mimetype: req.file.mimetype,
    ownerModule: payload.ownerModule,
    ownerEntityId: payload.ownerEntityId,
    uploadedById: req.user.id,
    visibility: payload.visibility as AssetVisibility,
  });

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "File uploaded successfully.",
    data: asset,
  });
});

export const downloadAsset = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const { asset, buffer } = await assetService.downloadFile(id, req.user?.id, req.user?.role);

  res.setHeader("Content-Type", asset.contentType);
  res.setHeader("Content-Disposition", `inline; filename="${asset.originalName}"`);
  res.send(buffer);
});

export const getAssets = asyncHandler(async (req: Request, res: Response) => {
  const query = queryAssetsSchema.parse({ query: req.query }).query;
  const result = await assetService.getAssets(query);
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Assets retrieved successfully",
    ...result,
  });
});

export const deleteAsset = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const permanent = req.query["permanent"] === "true";
  
  await assetService.deleteAsset(id, req.user.id, permanent);
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Asset deleted successfully",
  });
});
