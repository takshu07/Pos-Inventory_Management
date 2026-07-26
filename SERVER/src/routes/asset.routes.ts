import { Router } from "express";
import multer from "multer";
import * as assetController from "../controllers/asset.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";

const router = Router();

// Configure Multer for memory storage since AssetEngine handles the provider logic
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (can be overridden by ConfigurationEngine later)
  }
});

router.use(authenticate);

router.post("/upload", requireRole("OWNER"), upload.single("file"), assetController.uploadAsset);
router.get("/", requireRole("OWNER"), assetController.getAssets);

router.get("/:id/download", assetController.downloadAsset); // Anyone authenticated can attempt, AssetEngine checks permissions
router.delete("/:id", requireRole("OWNER"), assetController.deleteAsset);

export default router;
