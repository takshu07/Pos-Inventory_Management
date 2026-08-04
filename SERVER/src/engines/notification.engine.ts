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
   *
   * DELIVERED CHANNEL: In-App (database row, read via `/notifications`).
   *
   * TODO — EMAIL / SMS / PUSH DELIVERY. Not implemented, and deliberately NOT
   * stubbed. Each requires infrastructure this deployment does not have:
   *
   *   • Email — an SMTP/provider credential (SES, SendGrid…), a from-address on
   *     a verified domain, and bounce handling.
   *   • SMS   — a gateway account (Twilio, MSG91…), per-message billing, and
   *     DLT/sender-ID registration for Indian numbers.
   *   • Push  — a web-push VAPID keypair or FCM project, plus a service worker
   *     and per-device subscription storage on the client.
   *
   * The owner-facing Preferences tab already persists per-channel toggles in
   * `integrationConfig`; those toggles record INTENT and are read by nothing on
   * this path yet. Wiring a channel means: read its toggle here, add a driver
   * behind an interface mirroring `sendInAppNotification`, and — importantly —
   * make its failure non-fatal, because a dead SMTP host must not roll back an
   * in-app alert that was written successfully.
   *
   * ⚠ Do NOT add a no-op or log-only "sender" in the meantime. A channel that
   * reports success without delivering anything is worse than an absent one:
   * the toggle would read as working, and a store would trust an out-of-stock
   * email that was never sent.
   */
  static async dispatch(payload: NotificationPayload): Promise<void> {
    try {
      // 1. In-App Channel (Database) — the only implemented channel.
      await this.sendInAppNotification(payload);

      // 2. Push  — see the TODO above. Infrastructure absent; no stub on purpose.
      // 3. Email — see the TODO above. Infrastructure absent; no stub on purpose.
      // 4. SMS   — see the TODO above. Infrastructure absent; no stub on purpose.

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
