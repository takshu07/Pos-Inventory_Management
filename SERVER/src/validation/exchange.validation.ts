import { z } from "zod";
import { paginationSchema } from "./common.validation";

export const exchangeValidation = {
  create: z.object({
    originalSaleId: z.string().min(1, "Original Sale ID is required"),
    exchangeReason: z.string().min(1, "Exchange reason is required").max(100),
    notes: z.string().max(1000).optional().nullable(),
    
    returnedItems: z.array(
      z.object({
        variantId: z.string().min(1, "Variant ID is required"),
        quantity: z.number().int().positive("Quantity must be positive"),
      })
    ).min(1, "At least one item must be returned"),
    
    issuedItems: z.array(
      z.object({
        variantId: z.string().min(1, "Variant ID is required"),
        quantity: z.number().int().positive("Quantity must be positive"),
      })
    ).min(1, "At least one item must be issued"),
  }),

  query: paginationSchema,
  
  override: z.object({
    reason: z.string().min(1, "Override reason is required"),
  })
};

export type CreateExchangeInput = z.infer<typeof exchangeValidation.create>;
export type OverrideExchangeInput = z.infer<typeof exchangeValidation.override>;
