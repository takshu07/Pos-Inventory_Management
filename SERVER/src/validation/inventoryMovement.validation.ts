import { z } from "zod";
import { paginationSchema } from "./common.validation";
import { MovementType } from "../../generated/prisma";

// =============================================================================
// INVENTORY MOVEMENT VALIDATION
// =============================================================================

// The API only allows manual adjustment types. 
// System types (SALE, PURCHASE) are triggered internally by other services.
const allowedApiMovementTypes = [
  MovementType.MANUAL_ADJUSTMENT,
  MovementType.DAMAGED,
  MovementType.LOST,
  MovementType.OPENING_STOCK,
] as const;

export const inventoryMovementValidation = {
  create: z
    .object({
      variantId: z.string().cuid("Invalid Variant ID format"),
      type: z.enum(allowedApiMovementTypes),
      quantityChanged: z.number().int().refine((val) => val !== 0, {
        message: "Quantity changed cannot be zero.",
      }),
      reason: z.string().trim().max(500).optional().nullable(),
      referenceNumber: z.string().trim().max(100).optional().nullable(),
    })
    .refine(
      (data) => {
        // If it's a negative adjustment (loss/damage), reason should ideally be provided,
        // but we'll strictly require it for DAMAGED and LOST.
        if ((data.type === MovementType.DAMAGED || data.type === MovementType.LOST) && !data.reason) {
          return false;
        }
        return true;
      },
      {
        message: "A reason must be provided for DAMAGED or LOST stock.",
        path: ["reason"],
      }
    ),

  listQuery: paginationSchema.extend({
    variantId: z.string().cuid().optional(),
    employeeId: z.string().cuid().optional(),
    type: z.nativeEnum(MovementType).optional(), // Can filter by any type, including SALE/PURCHASE
  }),
} as const;

export type CreateInventoryMovementInput = z.infer<typeof inventoryMovementValidation.create>;
export type ListInventoryMovementsQuery = z.infer<typeof inventoryMovementValidation.listQuery>;
