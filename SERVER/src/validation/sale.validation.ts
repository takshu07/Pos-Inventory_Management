import { z } from "zod";
import { paginationSchema } from "./common.validation";
import { PaymentMethod, SaleStatus } from "../../generated/prisma";

// ============================================================================
// ITEM & PAYMENT SUB-SCHEMAS
// ============================================================================

const saleItemSchema = z.object({
  variantId: z.string().cuid("Invalid Variant ID format"),
  quantity: z.number().int().positive("Quantity must be greater than zero"),
});

const paymentSchema = z.object({
  method: z.nativeEnum(PaymentMethod, {
    message: "Invalid payment method",
  }),
  amount: z.number().nonnegative("Payment amount cannot be negative"),
  transactionRef: z.string().trim().max(100).optional().nullable(),
});

// ============================================================================
// MAIN SCHEMAS
// ============================================================================

export const saleValidation = {
  /**
   * Validation for creating a new Sale (Checkout).
   * Notice that the frontend is STRICTLY FORBIDDEN from sending
   * financial totals (subtotal, tax, grandTotal, etc).
   */
  checkout: z.object({
    customer: z.object({
      id: z.string().cuid().optional(),
      phone: z.string().max(20).optional(),
      name: z.string().max(100).optional(),
    }).optional().nullable(),
    manualDiscountAmount: z.number().nonnegative("Manual discount cannot be negative").default(0),
    manualDiscountReason: z
      .string()
      .trim()
      .max(500, "Reason too long")
      .optional()
      .nullable()
      // If manualDiscountAmount is > 0, the service will enforce that a reason is present.
      ,
    notes: z.string().trim().max(1000).optional().nullable(),
    couponId: z.string().cuid().optional().nullable(),

    items: z.array(saleItemSchema).min(1, "A sale must contain at least one item"),
    payments: z.array(paymentSchema),
  }),

  /**
   * Validation for listing and filtering sales
   */
  listQuery: paginationSchema.extend({
    status: z.nativeEnum(SaleStatus).optional(),
    customerId: z.string().cuid().optional(),
    employeeId: z.string().cuid().optional(),
    search: z.string().optional(), // Used for searching by invoiceNumber
    startDate: z.string().datetime().optional(), // For reporting
    endDate: z.string().datetime().optional(),
  }),

  /**
   * Validation for Voiding a sale
   */
  voidSale: z.object({
    reason: z.string().trim().min(5, "A detailed void reason is required").max(500),
  }),
} as const;

// ============================================================================
// TYPES
// ============================================================================

export type CheckoutInput = z.infer<typeof saleValidation.checkout>;
export type ListSalesQuery = z.infer<typeof saleValidation.listQuery>;
export type VoidSaleInput = z.infer<typeof saleValidation.voidSale>;
