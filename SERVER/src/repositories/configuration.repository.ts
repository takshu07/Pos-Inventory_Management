import { prisma } from "../config/prisma";
import type { Prisma } from "../../generated/prisma";
import { auditRepository } from "./audit.repository";
import { ActionType, ActionModule, ReferenceType } from "../../generated/prisma";

export const configurationRepository = {
  /**
   * Retrieves the raw configuration payload.
   */
  async getRawSettings() {
    return prisma.settings.findUnique({
      where: { id: "singleton" }
    });
  },

  /**
   * Updates the configuration and increments the version to signal cache invalidation.
   */
  async updateSettings(data: Prisma.SettingsUpdateInput, employeeId: string) {
    const updated = await prisma.settings.update({
      where: { id: "singleton" },
      data: {
        ...data,
        version: { increment: 1 }
      }
    });

    // 100% Auditable Configuration
    await auditRepository.create({
      action: ActionType.UPDATE,
      module: ActionModule.SETTINGS,
      performedBy: employeeId,
      tableName: "settings",
      recordId: updated.id,
      newData: data as Record<string, unknown>
    });

    return updated;
  }
};
