import { z } from "zod";
import { Gender } from "../../generated/prisma";
import { paginationSchema } from "./common.validation";

export const addressSchema = z.object({
  type: z.string().min(1).max(50),
  addressLine1: z.string().min(1).max(255),
  addressLine2: z.string().max(255).optional().nullable(),
  city: z.string().max(100).optional().nullable(),
  state: z.string().max(100).optional().nullable(),
  pincode: z.string().max(20).optional().nullable(),
  isDefault: z.boolean().default(false),
});

export const customerValidation = {
  create: z.object({
    name: z.string().min(2, "Name must be at least 2 characters").max(100),
    phone: z.string().min(10, "Phone number must be at least 10 digits").max(20),
    email: z.string().email("Invalid email format").optional().nullable(),
    gender: z.nativeEnum(Gender).optional().nullable(),
    dateOfBirth: z.coerce.date().optional().nullable(),
    anniversary: z.coerce.date().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    addresses: z.array(addressSchema).optional(),
  }),

  update: z.object({
    name: z.string().min(2).max(100).optional(),
    phone: z.string().min(10).max(20).optional(),
    email: z.string().email().optional().nullable(),
    gender: z.nativeEnum(Gender).optional().nullable(),
    dateOfBirth: z.coerce.date().optional().nullable(),
    anniversary: z.coerce.date().optional().nullable(),
    notes: z.string().max(1000).optional().nullable(),
    isActive: z.boolean().optional(),
    addresses: z.array(addressSchema).optional(),
  }),

  query: paginationSchema,

  /**
   * Owner/manager customer-table query. Extends pagination with the aggregate
   * sort fields and the dashboard filters. Booleans arrive as query strings, so
   * they are coerced from "true"/"false". All filtering/sorting is server-side.
   */
  tableQuery: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional(),
    sortBy: z
      .enum(["name", "lastVisit", "totalSpend", "totalPurchases", "createdAt"])
      .default("lastVisit"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
    // Presence of the key with "true"/"false" narrows; omit for "both".
    active: z.enum(["true", "false"]).optional(),
    hasStoreCredit: z.coerce.boolean().optional(),
    hasRewardPoints: z.coerce.boolean().optional(),
    // "new customers" filter — window in days (defaults applied in service).
    newWithinDays: z.coerce.number().int().min(1).max(365).optional(),
  }),
};
