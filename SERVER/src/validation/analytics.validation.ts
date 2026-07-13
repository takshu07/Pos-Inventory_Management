import { z } from "zod";

export const analyticsFilterSchema = z.object({
  query: z.object({
    reportName: z.string().min(1, "reportName is required"),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
    granularity: z.enum(["HOUR", "DAY", "WEEK", "MONTH", "YEAR"]).optional(),
    employeeId: z.string().cuid().optional(),
    customerId: z.string().cuid().optional(),
    categoryId: z.string().cuid().optional(),
    brandId: z.string().cuid().optional(),
    supplierId: z.string().cuid().optional(),
  })
});

export type AnalyticsFilterQuery = z.infer<typeof analyticsFilterSchema>["query"];
