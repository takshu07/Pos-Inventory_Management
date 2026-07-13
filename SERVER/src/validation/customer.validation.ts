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
};
