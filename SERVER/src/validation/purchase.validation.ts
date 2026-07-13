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
    }),

  update: z
    .object({
      supplierInvoiceNumber: z.string().trim().max(100).optional().nullable(),
      notes: z.string().trim().max(1000).optional().nullable(),
      discountAmount: z.number().nonnegative("Discount cannot be negative").optional(),
      taxAmount: z.number().nonnegative("Tax cannot be negative").optional(),
      items: z.array(purchaseItemSchema).min(1, "Purchase must have at least one item").optional(),
    }),

  receive: z
    .object({
      notes: z.string().trim().max(1000).optional().nullable(),
      supplierInvoiceNumber: z.string().trim().max(100).optional().nullable(),
    }),

  listQuery: paginationSchema.extend({
    supplierId: z.string().cuid().optional(),
    status: z.nativeEnum(PurchaseStatus).optional(),
    search: z.string().optional(), // search by purchaseNumber or supplierInvoiceNumber
  }),
} as const;

export type CreatePurchaseInput = z.infer<typeof purchaseValidation.create>;
export type UpdatePurchaseInput = z.infer<typeof purchaseValidation.update>;
export type ReceivePurchaseInput = z.infer<typeof purchaseValidation.receive>;
export type ListPurchasesQuery = z.infer<typeof purchaseValidation.listQuery>;
