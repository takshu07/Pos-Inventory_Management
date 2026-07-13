import { logger } from "../config/logger";
import { notificationRepository } from "../repositories/notification.repository";
import type { Prisma, EmployeeRole } from "../../generated/prisma";

export interface NotificationPayload {
  type: string;
  title: string;
  message: string;
  referenceId?: string;
  referenceType?: string;
  targetUserId?: string;
  targetRole?: EmployeeRole;
}

export class NotificationEngine {
  /**
   * Dispatches a notification across all enabled channels.
   * Currently supports: In-App (Database).
   * Architecture supports adding Email, SMS, WhatsApp without changing callers.
   */
  static async dispatch(payload: NotificationPayload): Promise<void> {
    try {
      // 1. In-App Channel (Database)
      await this.sendInAppNotification(payload);

      // 2. Push Notification Channel (Future)
      // if (ConfigurationEngine.getNotificationSettings().pushEnabled) { ... }

      // 3. Email Channel (Future)
      // if (ConfigurationEngine.getNotificationSettings().emailEnabled) { ... }

      logger.info(`[NotificationEngine] Dispatched ${payload.type} notification.`);
    } catch (error) {
      logger.error({ err: error, payload }, "[NotificationEngine] Failed to dispatch notification");
      throw error;
    }
  }

  private static async sendInAppNotification(payload: NotificationPayload) {
    await notificationRepository.create({
      type: payload.type,
      title: payload.title,
      message: payload.message,
      referenceId: payload.referenceId ?? null,
      referenceType: payload.referenceType ?? null,
      targetUserId: payload.targetUserId ?? null,
      targetRole: payload.targetRole ?? null,
    });
  }
}
