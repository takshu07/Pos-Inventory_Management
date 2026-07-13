import { z } from "zod";
import { AssetStatus } from "../../generated/prisma";
import { paginationSchema } from "./common.validation";

export const queryAssetsSchema = z.object({
  query: paginationSchema.extend({
    ownerModule: z.string().optional(),
    status: z.nativeEnum(AssetStatus).optional(),
  })
});

// For uploads, Multer handles the parsing, so Zod mostly validates the body metadata
export const uploadAssetMetadataSchema = z.object({
  body: z.object({
    ownerModule: z.string(),
    ownerEntityId: z.string().optional(),
    visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
  })
});
