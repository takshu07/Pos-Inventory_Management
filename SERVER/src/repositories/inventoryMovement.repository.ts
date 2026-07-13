import type { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListInventoryMovementsQuery } from "../validation/inventoryMovement.validation";

export const inventoryMovementRepository = {
  async findMany(query: ListInventoryMovementsQuery) {
    const { page, limit, variantId, employeeId, type } = query;
    const skip = (page - 1) * limit;

    const where: Prisma.InventoryMovementWhereInput = {
      ...(variantId && { variantId }),
      ...(employeeId && { employeeId }),
      ...(type && { type }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.inventoryMovement.count({ where }),
      prisma.inventoryMovement.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          employee: { select: { id: true, firstName: true, lastName: true } },
          variant: {
            select: {
              sku: true,
              barcode: true,
              product: { select: { name: true } },
              size: { select: { name: true } },
              color: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    return { total, data };
  },

  async findById(id: string) {
    return prisma.inventoryMovement.findUnique({
      where: { id },
      include: {
        employee: { select: { id: true, firstName: true, lastName: true } },
        variant: {
          select: {
            sku: true,
            product: { select: { name: true } },
          },
        },
      },
    });
  },

  // The create method is intentionally omitted from the standard repo object
  // because Inventory Movements MUST be created within a Prisma transaction
  // alongside the Variant stock update in the Service layer.
};
