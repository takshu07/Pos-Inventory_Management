/**
 * Workforce Management — domain types.
 *
 * These mirror the server's response shapes exactly. They are hand-written
 * rather than generated because the client is a separate package; keeping them
 * in one file means a server contract change surfaces as a compile error in one
 * place instead of silently as `any` scattered through components.
 */

import type { Role } from "@/types";

// =============================================================================
// ENUMS (mirror the Prisma enums)
// =============================================================================

export type EmploymentStatus =
  | "ACTIVE"
  | "PROBATION"
  | "ON_LEAVE"
  | "SUSPENDED"
  | "TERMINATED";

export type AttendanceStatus =
  | "PRESENT"
  | "LATE"
  | "HALF_DAY"
  | "ABSENT"
  | "ON_LEAVE"
  | "HOLIDAY"
  | "WEEK_OFF";

export type AttendanceSource =
  | "SYSTEM"
  | "MANUAL"
  | "LOGIN_DERIVED"
  | "BIOMETRIC"
  | "GEO_FENCE";

export type PresenceStatus = "ONLINE" | "OFFLINE";

export type SessionStatus = "ACTIVE" | "IDLE" | "ENDED";

export type ActivityCategory =
  | "AUTH"
  | "SALE"
  | "INVENTORY"
  | "CUSTOMER"
  | "CATALOG"
  | "PURCHASE"
  | "LABEL"
  | "WORKFORCE"
  | "OTHER";

export type WorkforcePeriod = "today" | "week" | "month" | "quarter" | "year" | "custom";

/** Live-feed severity. Mirrors the engine's activitySeverity() exactly. */
export type ActivitySeverity = "NORMAL" | "WARNING" | "CRITICAL";

export type EmployeeNoteCategory =
  | "GENERAL"
  | "PRAISE"
  | "TRAINING"
  | "PROMOTION"
  | "WARNING";

// =============================================================================
// SHIFT
// =============================================================================

export interface Shift {
  id: string;
  name: string;
  code: string;
  /** Minutes from midnight. 540 = 09:00. */
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  graceMinutes: number;
  expectedMinutes: number;
  workingDays?: number[];
  colorHex: string | null;
  isActive?: boolean;
}

// =============================================================================
// ROSTER
// =============================================================================

/** A row in the Managers / Employees table, with all aggregates attached. */
export interface WorkforceEmployee {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string | null;
  phone: string;
  role: Role;
  photoUrl: string | null;
  isActive: boolean;
  employmentStatus: EmploymentStatus;
  joiningDate: string;
  lastLogin: string | null;
  storeCode: string | null;

  shift: Shift | null;

  presence: PresenceStatus;
  sessionStartedAt: string | null;
  device: string | null;

  attendanceStatus: AttendanceStatus | null;
  clockInAt: string | null;
  clockOutAt: string | null;
  workedMinutesToday: number;
  lateMinutesToday: number;
  isWorkingNow: boolean;

  todayRevenue: number;
  todayTransactions: number;

  currentActivity: string | null;
  currentActivityAt: string | null;

  attendancePercentage: number;
  workedMinutes: number;

  /** The till this employee normally works. Null = unassigned. */
  assignedRegister: string | null;
  /** NULL means no target configured — render "Not set", never 0. */
  monthlyTarget: number | null;

  /** Month-to-date figures for the roster's money columns. */
  monthlyRevenue: number;
  monthlyTransactions: number;
  averageBill: number;
  unitsSold: number;
  lastSaleAt: string | null;

  /**
   * 0–100 composite, or NULL when no target is set. Computed by the same engine
   * call the Performance page uses, so a roster row and the leaderboard can
   * never disagree.
   */
  performanceScore: number | null;
}

/** Full profile for the drawer Overview tab. `salary` is present only for OWNER. */
export interface WorkforceEmployeeDetail extends WorkforceEmployee {
  gender: string | null;
  address: string | null;
  dateOfBirth: string | null;
  salary?: string | number | null;
  exitDate: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  emergencyContactRelation: string | null;
  createdAt: string;
  updatedAt: string;
  permissions: PermissionGrant[];
}

// =============================================================================
// SUMMARY / STATS
// =============================================================================

export interface WorkforceSummary {
  totalEmployees: number;
  managers: number;
  cashiers: number;
  owners: number;
  online: number;
  offline: number;
  workingToday: number;
  onLeave: number;
  absentToday: number;
  lateToday: number;
  employmentStatus: Partial<Record<EmploymentStatus, number>>;

  /** Today's operational counters for the live dashboard strip. */
  salesToday: number;
  transactionsToday: number;
  refundsToday: number;
  refundValueToday: number;
  labelsPrinted: number;
  customersAdded: number;
  inventoryUpdates: number;
}

/** Shared shape for both the Managers and Employees statistics strips. */
export interface RosterStats {
  total: number;
  online: number;
  offline: number;
  working: number;
  onLeave: number;
  absent: number;
  todayRevenue: number;
  todayTransactions: number;
}

// =============================================================================
// SALES / PERFORMANCE
// =============================================================================

export interface EmployeeSales {
  todayRevenue: number;
  todayTransactions: number;
  weeklyRevenue: number;
  weeklyTransactions: number;
  monthlyRevenue: number;
  monthlyTransactions: number;
  periodRevenue: number;
  periodTransactions: number;
  averageBillValue: number;
  unitsSold: number;
  returns: number;
  returnsValue: number;
  exchanges: number;
  exchangeValue: number;
  discountGiven: number;
  discountPercentage: number;

  /** Best-selling category by units in the period. Null = nothing sold. */
  topCategory: string | null;
  topCategoryUnits: number;
  /** Distinct people served, not transactions. */
  customerCount: number;
  workedMinutes: number;
  /** NULL when no hours were clocked — "₹0/hr" would be a lie, not a zero. */
  salesPerHour: number | null;

  trend: Array<{ date: string; revenue: number; transactions: number }>;
}

/** Per-term contribution of the performance score, so the UI can explain it. */
export interface PerformanceBreakdown {
  revenue: number;
  attendance: number;
  returns: number;
  discount: number;
}

export interface PerformanceRow {
  id: string;
  employeeCode: string;
  fullName: string;
  role: Role;
  photoUrl: string | null;
  revenue: number;
  transactions: number;
  averageBill: number;
  unitsSold: number;
  returns: number;
  refundValue: number;
  returnPercentage: number;
  exchanges: number;
  discountGiven: number;
  discountPercentage: number;
  attendancePercentage: number;

  /**
   * All four are NULL when no monthly target is configured. The UI must render
   * "Not set" rather than 0 — a data gap is not a performance finding.
   */
  monthlyTarget: number | null;
  proratedTarget: number | null;
  targetAchievement: number | null;
  performanceScore: number | null;
  performanceBreakdown: PerformanceBreakdown | null;

  rank: number;
}

export interface PerformanceResponse {
  period: { from: string; to: string };
  data: PerformanceRow[];
}

// =============================================================================
// ACTIVITY
// =============================================================================

export interface EmployeeRef {
  id: string;
  fullName: string;
  employeeCode: string;
  role: Role;
  photoUrl: string | null;
}

export interface ActivityRow {
  id: string;
  employeeId: string;
  employee: EmployeeRef | null;
  actionType: string;
  module: string;
  category: ActivityCategory;
  /** Derived server-side from the action — never stored, so it stays retroactive. */
  severity: ActivitySeverity;
  description: string;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
}

// =============================================================================
// LOGIN HISTORY
// =============================================================================

export interface LoginHistoryRow {
  id: string;
  employeeId: string;
  employee: EmployeeRef | null;
  loginAt: string;
  logoutAt: string | null;
  durationMinutes: number;
  device: string | null;
  browser: string | null;
  operatingSystem: string | null;
  ipAddress: string | null;
  isSuccessful: boolean;
  failureReason: string | null;
  endReason: string | null;
  /** True when an owner force-ended this session, vs a self-service logout. */
  wasTerminated: boolean;
  terminatedById: string | null;
  sessionStatus: SessionStatus;
}

// =============================================================================
// ATTENDANCE
// =============================================================================

export interface AttendanceRow {
  id: string;
  employeeId: string;
  employee: EmployeeRef | null;
  date: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  status: AttendanceStatus;
  source: AttendanceSource;
  workedMinutes: number;
  lateMinutes: number;
  earlyExitMinutes: number;
  overtimeMinutes: number;
  /** Accumulated break PLUS any break still running, so it reads live. */
  breakMinutes: number;
  isOnBreak: boolean;
  notes: string | null;
  shift: Pick<Shift, "id" | "name" | "code" | "colorHex"> | null;
}

export interface AttendanceSummary {
  period: { from: string; to: string };
  headcount: number;
  presentToday: number;
  absentToday: number;
  onLeaveToday: number;
  lateToday: number;
  counts: Partial<Record<AttendanceStatus, number>>;
  workedMinutes: number;
  lateMinutes: number;
  overtimeMinutes: number;
  attendancePercentage: number;
  trend: Array<{
    date: string;
    present: number;
    late: number;
    absent: number;
    onLeave: number;
    workedMinutes: number;
  }>;
}

export interface EmployeeAttendanceResponse {
  /** ONE PAGE of records — the server paginates this, so `total`/`totalPages`
   *  (not `records.length`) are what drive the pager. */
  records: AttendanceRow[];
  summary: AttendanceSummary;
  total: number;
  page: number;
  totalPages: number;
}

// =============================================================================
// PERMISSIONS
// =============================================================================

export interface PermissionGrant {
  module: string;
  label: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
}

export interface PermissionsResponse {
  employeeId: string;
  role: Role;
  editable: boolean;
  permissions: PermissionGrant[];
}

// =============================================================================
// EMPLOYEE NOTES — OWNER-only. A manager never receives these.
// =============================================================================

export interface EmployeeNote {
  id: string;
  employeeId: string;
  authorId: string;
  category: EmployeeNoteCategory;
  body: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; fullName: string; employeeCode: string } | null;
}

export interface CreateNotePayload {
  category: EmployeeNoteCategory;
  body: string;
  isPinned: boolean;
}

export interface UpdateNotePayload {
  category?: EmployeeNoteCategory;
  body?: string;
  isPinned?: boolean;
}

// =============================================================================
// SECURITY (Login History dashboard)
// =============================================================================

export interface FailedLoginAttempt {
  employeeId: string;
  fullName: string | null;
  employeeCode: string | null;
  ipAddress: string | null;
  reason: string | null;
  attempts: number;
  lastAttemptAt: string;
  /** Server-flagged at 5+ attempts — the lockout-policy threshold. */
  isSuspicious: boolean;
}

export interface SecurityOverview {
  period: { from: string; to: string };
  activeSessions: number;
  failedLogins: number;
  loggedInToday: number;
  averageSessionMinutes: number;
  concurrentSessions: number;
  failedAttempts: FailedLoginAttempt[];
}

// =============================================================================
// EMPLOYEE COMPARISON (OWNER-only)
// =============================================================================

export interface ComparisonSide {
  id: string;
  employeeCode: string;
  fullName: string;
  role: Role;
  photoUrl: string | null;

  revenue: number;
  transactions: number;
  averageBill: number;
  unitsSold: number;
  returns: number;
  refundValue: number;
  exchanges: number;
  discountGiven: number;
  discountPercentage: number;

  attendancePercentage: number;
  workedMinutes: number;
  overtimeMinutes: number;
  lateMinutes: number;

  targetAchievement: number | null;
  performanceScore: number | null;
}

export interface ComparisonResponse {
  period: { from: string; to: string };
  a: ComparisonSide;
  b: ComparisonSide;
}

// =============================================================================
// SHIFT MANAGEMENT (OWNER-only writes)
// =============================================================================

export interface ShiftPayload {
  name: string;
  code: string;
  startMinute: number;
  endMinute: number;
  breakMinutes: number;
  graceMinutes: number;
  workingDays: number[];
  colorHex?: string | null;
  isActive: boolean;
  storeCode?: string | null;
}

export interface AssignShiftPayload {
  /** Null clears the assignment. */
  shiftId: string | null;
  employeeIds: string[];
}

// =============================================================================
// QUERY PARAMS
// =============================================================================

export interface RosterParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: Role | "";
  isActive?: boolean | "";
  employmentStatus?: EmploymentStatus | "";
  shiftId?: string;
  storeCode?: string;
  joinedFrom?: string;
  joinedTo?: string;
  attendanceWindowDays?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ActivityParams {
  page?: number;
  limit?: number;
  employeeId?: string;
  actionType?: string;
  module?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface LoginHistoryParams {
  page?: number;
  limit?: number;
  employeeId?: string;
  search?: string;
  isSuccessful?: boolean | "";
  activeOnly?: boolean | "";
  dateFrom?: string;
  dateTo?: string;
}

export interface AttendanceParams {
  page?: number;
  limit?: number;
  employeeId?: string;
  status?: AttendanceStatus | "";
  shiftId?: string;
  search?: string;
  period?: WorkforcePeriod;
  dateFrom?: string;
  dateTo?: string;
}

export interface PerformanceParams {
  role?: Role | "";
  period?: WorkforcePeriod;
  dateFrom?: string;
  dateTo?: string;
}

export interface SecurityParams {
  period?: WorkforcePeriod;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface CompareParams {
  employeeA: string;
  employeeB: string;
  period?: WorkforcePeriod;
  dateFrom?: string;
  dateTo?: string;
}

// =============================================================================
// SHARED RESPONSE ENVELOPE
// =============================================================================

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
