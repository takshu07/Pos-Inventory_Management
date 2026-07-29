// =============================================================================
// WORKFORCE VALIDATION SCHEMAS
//
// Every query string is a string until proven otherwise, so numbers, booleans
// and dates are coerced here rather than defensively re-parsed in the service.
// A schema that rejects unknown sort fields is also a security control: it is
// what stops `sortBy` from becoming an injection surface into the ORDER BY.
// =============================================================================

import { z } from "zod";

// =============================================================================
// SHARED FIELDS
// =============================================================================

const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
};

/** Query-string booleans arrive as "true"/"false" literals, never as booleans. */
const queryBoolean = z
  .union([z.literal("true"), z.literal("false"), z.boolean()])
  .transform((v) => v === true || v === "true")
  .optional();

const roleEnum = z.enum(["OWNER", "MANAGER", "CASHIER"]);

const employmentStatusEnum = z.enum([
  "ACTIVE", "PROBATION", "ON_LEAVE", "SUSPENDED", "TERMINATED",
]);

const attendanceStatusEnum = z.enum([
  "PRESENT", "LATE", "HALF_DAY", "ABSENT", "ON_LEAVE", "HOLIDAY", "WEEK_OFF",
]);

const periodEnum = z
  .enum(["today", "week", "month", "quarter", "year", "custom"])
  .default("month");

/**
 * Sort fields, split by where they are evaluated.
 *   - DB columns sort in SQL.
 *   - Computed columns (revenue, attendance %) are joined from other tables and
 *     are sorted in the service after aggregation.
 * Both are enumerated so an arbitrary string can never reach the query builder.
 */
const rosterSortEnum = z
  .enum([
    "firstName", "lastName", "createdAt", "joiningDate", "role",
    "employeeCode", "lastLogin", "employmentStatus",
    "todayRevenue", "todayTransactions", "attendancePercentage", "workedMinutes",
  ])
  .default("firstName");

// =============================================================================
// ROSTER
// =============================================================================

const rosterQuerySchema = z.object({
  ...paginationSchema,
  search: z.string().trim().max(100).optional(),
  role: roleEnum.optional(),
  isActive: queryBoolean,
  employmentStatus: employmentStatusEnum.optional(),
  shiftId: z.string().trim().optional(),
  storeCode: z.string().trim().optional(),
  joinedFrom: z.coerce.date().optional(),
  joinedTo: z.coerce.date().optional(),
  /** Window (in days) used for the attendance-% column. */
  attendanceWindowDays: z.coerce.number().int().min(1).max(365).default(30),
  sortBy: rosterSortEnum,
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

// =============================================================================
// ACTIVITY
// =============================================================================

const activityQuerySchema = z.object({
  ...paginationSchema,
  employeeId: z.string().trim().optional(),
  // Mirrors the Prisma ActionType/ActionModule enums. Left as a permissive
  // string with a length bound rather than a 30-member enum duplicate: the
  // Prisma query rejects an invalid value anyway, and duplicating the enum here
  // would guarantee it drifts.
  actionType: z.string().trim().max(50).optional(),
  module: z.string().trim().max(50).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// =============================================================================
// LOGIN HISTORY
// =============================================================================

const loginHistoryQuerySchema = z.object({
  ...paginationSchema,
  employeeId: z.string().trim().optional(),
  search: z.string().trim().max(100).optional(),
  isSuccessful: queryBoolean,
  activeOnly: queryBoolean,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// =============================================================================
// ATTENDANCE
// =============================================================================

const attendanceQuerySchema = z.object({
  ...paginationSchema,
  employeeId: z.string().trim().optional(),
  status: attendanceStatusEnum.optional(),
  shiftId: z.string().trim().optional(),
  search: z.string().trim().max(100).optional(),
  period: periodEnum,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

const clockSchema = z.object({
  /** Omitted = the caller clocks themselves. Present = owner acting on behalf. */
  employeeId: z.string().trim().optional(),
  at: z.coerce.date().optional(),
});

const manualAttendanceSchema = z
  .object({
    employeeId: z.string().trim().min(1, "Employee is required"),
    date: z.coerce.date(),
    clockInAt: z.coerce.date().optional(),
    clockOutAt: z.coerce.date().optional(),
    status: attendanceStatusEnum.optional(),
    notes: z.string().trim().max(500).optional(),
  })
  .refine(
    (data) => !data.clockInAt || !data.clockOutAt || data.clockOutAt > data.clockInAt,
    { message: "Clock-out must be after clock-in.", path: ["clockOutAt"] }
  );

// =============================================================================
// PERFORMANCE
// =============================================================================

const performanceQuerySchema = z.object({
  role: roleEnum.optional(),
  period: periodEnum,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// =============================================================================
// OWNER MUTATIONS
// =============================================================================

const updateWorkforceEmployeeSchema = z.object({
  photoUrl: z.string().trim().max(500).nullable().optional(),
  employmentStatus: employmentStatusEnum.optional(),
  shiftId: z.string().trim().nullable().optional(),
  storeCode: z.string().trim().max(50).nullable().optional(),
  isActive: z.boolean().optional(),
  exitDate: z.coerce.date().nullable().optional(),
  emergencyContactName: z.string().trim().max(100).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(20).nullable().optional(),
  emergencyContactRelation: z.string().trim().max(50).nullable().optional(),
});

// Mirrors the password policy in auth.validation — an owner-set password must
// be no weaker than one the employee would choose themselves.
const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain an uppercase letter, a lowercase letter, and a number"
    ),
});

const changeRoleSchema = z.object({
  // OWNER is excluded: promoting someone to owner is an ownership transfer,
  // which is a different, deliberately separate operation.
  role: z.enum(["MANAGER", "CASHIER"]),
});

// =============================================================================
// EXPORTS
// =============================================================================

export const workforceValidation = {
  rosterQuery: rosterQuerySchema,
  activityQuery: activityQuerySchema,
  loginHistoryQuery: loginHistoryQuerySchema,
  attendanceQuery: attendanceQuerySchema,
  performanceQuery: performanceQuerySchema,
  clock: clockSchema,
  manualAttendance: manualAttendanceSchema,
  updateEmployee: updateWorkforceEmployeeSchema,
  resetPassword: resetPasswordSchema,
  changeRole: changeRoleSchema,
} as const;

export type RosterQuery = z.infer<typeof rosterQuerySchema> & {
  role?: import("../../generated/prisma").EmployeeRole | undefined;
};
export type ActivityQuery = z.infer<typeof activityQuerySchema> & {
  actionType?: import("../../generated/prisma").ActionType | undefined;
  module?: import("../../generated/prisma").ActionModule | undefined;
};
export type LoginHistoryQuery = z.infer<typeof loginHistoryQuerySchema>;
export type AttendanceQuery = z.infer<typeof attendanceQuerySchema> & {
  status?: import("../../generated/prisma").AttendanceStatus | undefined;
};
export type PerformanceQuery = z.infer<typeof performanceQuerySchema> & {
  role?: import("../../generated/prisma").EmployeeRole | undefined;
};
export type ClockInput = z.infer<typeof clockSchema>;
export type ManualAttendanceInput = z.infer<typeof manualAttendanceSchema> & {
  status?: import("../../generated/prisma").AttendanceStatus | undefined;
};
export type UpdateWorkforceEmployeeInput = z.infer<typeof updateWorkforceEmployeeSchema> & {
  employmentStatus?: import("../../generated/prisma").EmploymentStatus | undefined;
};
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
