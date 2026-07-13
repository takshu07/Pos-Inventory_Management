import { Router } from "express";
import * as notificationController from "../controllers/notification.controller";
import { authenticate } from "../middleware/auth.middleware";

const router = Router();

// Notifications are available to all authenticated employees
router.use(authenticate);

router.get("/", notificationController.getMyNotifications);
router.post("/read-all", notificationController.markAllAsRead);
router.patch("/:id/read", notificationController.markAsRead);

export default router;
