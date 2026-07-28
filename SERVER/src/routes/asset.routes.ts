import { Router } from "express";
import multer from "multer";
import * as assetController from "../controllers/asset.controller";
import { authenticate, optionalAuthenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Configure Multer for memory storage since AssetEngine handles the provider logic
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (can be overridden by ConfigurationEngine later)
  }
});

// DOWNLOAD IS DECLARED BEFORE THE BLANKET `authenticate` BELOW, and uses
// optional auth instead.
//
// This route is what an <img src="/api/v1/assets/<id>/download"> hits. That is a
// plain browser GET with no Authorization header (our JWT is held in memory,
// not a cookie), so requiring a token here makes every rendered image a
// guaranteed 401 — which is exactly what category thumbnails were doing.
//
// This is NOT a hole: AssetEngine.downloadAsset performs the per-asset check,
// serving PUBLIC assets to anyone while still demanding an identified requester
// for PRIVATE ones. optionalAuthenticate populates req.user when a token IS
// present, so that PRIVATE check keeps working for our own API-client calls.
router.get("/:id/download", optionalAuthenticate, assetController.downloadAsset);

router.use(authenticate);

router.post("/upload", requireRole("OWNER"), upload.single("file"), assetController.uploadAsset);
router.get("/", requireRole("OWNER"), assetController.getAssets);

router.delete("/:id", requireRole("OWNER"), assetController.deleteAsset);

export default router;
