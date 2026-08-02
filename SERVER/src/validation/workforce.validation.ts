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

// 200 rather than 100: the roster doubles as the source for pickers that need
// the whole staff list in one shot (shift assignment, the activity filter), and
// a store's headcount comfortably fits under that ceiling.
const paginationSchema = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(20),
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
  assignedRegister: z.string().trim().max(50).nullable().optional(),
  // Nullable on purpose: clearing a target is a legitimate action and must be
  // distinguishable from "leave it as it is" (undefined).
  monthlyTarget: z.coerce.number().min(0).max(99_999_999).nullable().optional(),
});

// =============================================================================
// EMPLOYEE NOTES (OWNER-only — the service enforces the role)
// =============================================================================

const noteCategoryEnum = z.enum([
  "GENERAL", "PRAISE", "TRAINING", "PROMOTION", "WARNING",
]);

const createNoteSchema = z.object({
  category: noteCategoryEnum.default("GENERAL"),
  // A note with no content is not a note. Bounded so one entry cannot become an
  // unbounded blob in a drawer tab that renders every note it is given.
  body: z.string().trim().min(1, "A note cannot be empty").max(2000),
  isPinned: z.boolean().default(false),
});

const updateNoteSchema = z.object({
  category: noteCategoryEnum.optional(),
  body: z.string().trim().min(1).max(2000).optional(),
  isPinned: z.boolean().optional(),
});

// =============================================================================
// SECURITY / SESSIONS
// =============================================================================

/**
 * Window for the security counters. Defaults to today because "failed logins"
 * without a window is a meaningless number that only ever grows.
 */
const securityQuerySchema = z.object({
  period: periodEnum,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// =============================================================================
// EXPORTS
// =============================================================================

/**
 * Both are enumerated rather than free strings: `report` selects a code path
 * and `format` a renderer, so an unvalidated value would be a 500 at best.
 */
const exportQuerySchema = z.object({
  report: z.enum(["attendance", "performance", "login-history", "activity"]),
  format: z.enum(["csv", "excel", "pdf"]).default("csv"),
});

// =============================================================================
// EMPLOYEE COMPARISON
// =============================================================================

/**
 * Exactly two employees. The UI is a side-by-side, and allowing three would
 * silently produce a layout nobody designed.
 */
const compareQuerySchema = z.object({
  employeeA: z.string().trim().min(1, "Select the first employee"),
  employeeB: z.string().trim().min(1, "Select the second employee"),
  period: periodEnum,
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

// =============================================================================
// SHIFT MANAGEMENT
// =============================================================================

const shiftSchema = z.object({
  name: z.string().trim().min(1).max(60),
  code: z.string().trim().min(1).max(20),
  // Minutes from midnight. 1439 = 23:59; a shift may legally end at or before
  // its start (an overnight shift), which the engine handles.
  startMinute: z.coerce.number().int().min(0).max(1439),
  endMinute: z.coerce.number().int().min(0).max(1439),
  breakMinutes: z.coerce.number().int().min(0).max(480).default(0),
  graceMinutes: z.coerce.number().int().min(0).max(120).default(10),
  workingDays: z.array(z.coerce.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  colorHex: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "Use a #RRGGBB colour").nullable().optional(),
  isActive: z.boolean().default(true),
  storeCode: z.string().trim().max(50).nullable().optional(),
});

const updateShiftSchema = shiftSchema.partial();

/** Bulk shift assignment — the "assign employees to a shift" action. */
const assignShiftSchema = z.object({
  shiftId: z.string().trim().min(1).nullable(),
  employeeIds: z.array(z.string().trim().min(1)).min(1, "Select at least one employee").max(200),
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
  createNote: createNoteSchema,
  updateNote: updateNoteSchema,
  securityQuery: securityQuerySchema,
  compareQuery: compareQuerySchema,
  shift: shiftSchema,
  updateShift: updateShiftSchema,
  assignShift: assignShiftSchema,
  exportQuery: exportQuerySchema,
} as const;

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type SecurityQuery = z.infer<typeof securityQuerySchema>;
export type CompareQuery = z.infer<typeof compareQuerySchema>;
export type ShiftInput = z.infer<typeof shiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type AssignShiftInput = z.infer<typeof assignShiftSchema>;

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
