import { z } from "zod";
import { paginationSchema } from "./common.validation";
import { PurchaseStatus } from "../../generated/prisma";
import { Prisma } from "../../generated/prisma";

// =============================================================================
// PURCHASE VALIDATION
// =============================================================================

const purchaseItemSchema = z.object({
  variantId: z.string().cuid("Invalid Variant ID format"),
  quantity: z.number().int().positive("Quantity must be greater than zero"),
  costPrice: z.number().nonnegative("Cost price cannot be negative"),
  sellingPriceAtPurchase: z.number().nonnegative("Selling price cannot be negative"),
});

export const purchaseValidation = {
  create: z
    .object({
      supplierId: z.string().cuid("Invalid Supplier ID format"),
      supplierInvoiceNumber: z.string().trim().max(100).optional().nullable(),
      notes: z.string().trim().max(1000).optional().nullable(),
      discountAmount: z.number().nonnegative("Discount cannot be negative").default(0),
      taxAmount: z.number().nonnegative("Tax cannot be negative").default(0),
      items: z.array(purchaseItemSchema).min(1, "Purchase must have at least one item"),
      status: z.enum([PurchaseStatus.DRAFT, PurchaseStatus.ORDERED]).default(PurchaseStatus.DRAFT),
      /**
       * Agreed payment term. Omit when there is none — a NULL dueDate is
       * treated by the settlement engine as "not overdue" rather than
       * "overdue immediately".
       */
      dueDate: z.coerce.date().optional().nullable(),
    }),

  update: z
    .object({
      supplierInvoiceNumber: z.string().trim().max(100).optional().nullable(),
      notes: z.string().trim().max(1000).optional().nullable(),
      discountAmount: z.number().nonnegative("Discount cannot be negative").optional(),
      taxAmount: z.number().nonnegative("Tax cannot be negative").optional(),
      items: z.array(purchaseItemSchema).min(1, "Purchase must have at least one item").optional(),
      dueDate: z.coerce.date().optional().nullable(),
      /** Promote a DRAFT to ORDERED without touching anything else. */
      status: z.enum([PurchaseStatus.DRAFT, PurchaseStatus.ORDERED]).optional(),
    }),

  /**
   * Goods receipt — full or partial.
   *
   * `items` is OPTIONAL and omitting it means "receive everything still
   * outstanding", which is exactly what the endpoint did before partial
   * receipts existed. Existing callers therefore keep working unchanged.
   *
   * When `items` IS supplied, each entry books `quantity` additional units
   * against that line. The service rejects a quantity larger than the line's
   * remaining balance rather than clamping it: over-receipt is a mis-keyed
   * number, and silently absorbing it would put stock on the shelf that the
   * supplier never shipped.
   */
  receive: z.object({
    notes: z.string().trim().max(1000).optional().nullable(),
    supplierInvoiceNumber: z.string().trim().max(100).optional().nullable(),
    items: z
      .array(
        z.object({
          itemId: z.string().cuid("Invalid purchase item ID format"),
          // Zero is allowed so a receive form can submit untouched lines
          // verbatim; those lines are simply skipped.
          quantity: z.number().int().nonnegative("Received quantity cannot be negative"),
        })
      )
      .min(1, "Provide at least one line to receive")
      .optional(),
  }),

  /** Cancel an unreceived purchase order. */
  cancel: z.object({
    reason: z.string().trim().min(3, "Give a reason for the cancellation").max(500),
  }),

  listQuery: paginationSchema.extend({
    supplierId: z.string().cuid().optional(),
    status: z.nativeEnum(PurchaseStatus).optional(),
    search: z.string().optional(), // search by purchaseNumber or supplierInvoiceNumber
    paymentStatus: z
      .enum(["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"])
      .optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    sortBy: z
      .enum(["purchaseDate", "purchaseNumber", "totalAmount", "dueAmount", "status", "createdAt"])
      .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }),
} as const;

export type CancelPurchaseInput = z.infer<typeof purchaseValidation.cancel>;

export type CreatePurchaseInput = z.infer<typeof purchaseValidation.create>;
export type UpdatePurchaseInput = z.infer<typeof purchaseValidation.update>;
export type ReceivePurchaseInput = z.infer<typeof purchaseValidation.receive>;
export type ListPurchasesQuery = z.infer<typeof purchaseValidation.listQuery>;
