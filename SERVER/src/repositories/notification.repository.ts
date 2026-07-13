import { prisma } from "../config/prisma";
import type { Prisma } from "../../generated/prisma";

export const notificationRepository = {
  async create(data: Prisma.NotificationUncheckedCreateInput) {
    return prisma.notification.create({ data });
  },

  async getUnreadForUser(userId: string, role: string) {
    return prisma.notification.findMany({
      where: {
        isRead: false,
        OR: [
          { targetUserId: userId },
          { targetRole: role as any },
          { targetUserId: null, targetRole: null } // Global broadcasts
        ]
      },
      orderBy: { createdAt: "desc" }
    });
  },

  async markAsRead(notificationId: string, userId: string) {
    return prisma.notification.update({
      where: { id: notificationId },
      data: { isRead: true }
    });
  },
  
  async markAllAsRead(userId: string, role: string) {
    return prisma.notification.updateMany({
      where: {
        isRead: false,
        OR: [
          { targetUserId: userId },
          { targetRole: role as any }
        ]
      },
      data: { isRead: true }
    });
  }
};
