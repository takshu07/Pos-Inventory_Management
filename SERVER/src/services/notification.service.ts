import { notificationRepository } from "../repositories/notification.repository";
import type { EmployeeRole } from "../../generated/prisma";

export const notificationService = {
  async getMyNotifications(userId: string, role: string) {
    return notificationRepository.getUnreadForUser(userId, role);
  },

  async markAsRead(notificationId: string, userId: string) {
    return notificationRepository.markAsRead(notificationId, userId);
  },

  async markAllAsRead(userId: string, role: string) {
    return notificationRepository.markAllAsRead(userId, role);
  }
};
