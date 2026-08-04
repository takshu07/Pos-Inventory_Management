import { notificationRepository } from "../repositories/notification.repository";
import type { EmployeeRole } from "../../generated/prisma";

export const notificationService = {
  async getMyNotifications(userId: string, role: string) {
    return notificationRepository.getUnreadForUser(userId, role);
  },

  /**
   * `role` is forwarded (2026-08-03) so the repository can scope the update to
   * what this user is allowed to see. Without it the row must be addressed to
   * them personally — correct, but it would refuse role-targeted and broadcast
   * notifications, which are the majority.
   */
  async markAsRead(notificationId: string, userId: string, role?: string) {
    return notificationRepository.markAsRead(notificationId, userId, role);
  },

  async markAllAsRead(userId: string, role: string) {
    return notificationRepository.markAllAsRead(userId, role);
  }
};
