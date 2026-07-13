import { z } from "zod";
import { PaymentMethod, CashTransactionType } from "../../generated/prisma";
import { paginationSchema } from "./common.validation";

export const createExpenseSchema = z.object({
  body: z.object({
    categoryId: z.string().cuid(),
    title: z.string().min(3).max(100),
    amount: z.number().positive(),
    vendorName: z.string().max(100).optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CASH),
    referenceNumber: z.string().max(100).optional(),
    description: z.string().max(500).optional(),
    notes: z.string().max(1000).optional(),
    expenseDate: z.string().datetime().optional()
  })
});

export const queryExpensesSchema = z.object({
  query: paginationSchema.extend({
    categoryId: z.string().cuid().optional(),
    paymentMethod: z.nativeEnum(PaymentMethod).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  })
});

export const openCashRegisterSchema = z.object({
  body: z.object({
    openingBalance: z.number().min(0),
    notes: z.string().max(500).optional()
  })
});

export const closeCashRegisterSchema = z.object({
  body: z.object({
    actualBalance: z.number().min(0),
    notes: z.string().max(500).optional()
  })
});

export const createCashTransactionSchema = z.object({
  body: z.object({
    type: z.nativeEnum(CashTransactionType),
    amount: z.number().positive(),
    reason: z.string().min(5).max(200)
  })
});
