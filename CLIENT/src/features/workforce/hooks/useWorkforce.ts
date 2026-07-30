/**
 * Workforce Management — React Query hooks.
 *
 * Caching strategy, and why it differs per surface:
 *
 *   • PRESENCE-BEARING data (summary, roster, stats) is polled. An "online"
 *     dot that is five minutes stale is worse than no dot at all, so these
 *     refetch on an interval. The interval is longer than the server's presence
 *     threshold would strictly require, because these are COUNT queries and the
 *     cost of polling them is what keeps this affordable.
 *
 *   • HISTORICAL data (activity, login history, attendance records, performance)
 *     does not change retroactively, so it gets a real staleTime and no polling.
 *
 *   • DRAWER TABS are `enabled`-gated on the tab being open. That is the lazy
 *     loading requirement: opening a drawer fetches ONE tab, not six.
 *
 * Every list uses `placeholderData: (prev) => prev` so paging and filtering
 * update the table in place instead of flashing a skeleton over it.
 */

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import * as api from "../api/workforceApi";
import type {
  ActivityParams,
  AssignShiftPayload,
  AttendanceParams,
  CompareParams,
  CreateNotePayload,
  LoginHistoryParams,
  PerformanceParams,
  RosterParams,
  SecurityParams,
  ShiftPayload,
  UpdateNotePayload,
} from "../types";

// =============================================================================
// QUERY KEYS
// A single factory so an invalidation can never miss a key by mistyping it.
// =============================================================================

export const workforceKeys = {
  all: ["workforce"] as const,
  summary: () => [...workforceKeys.all, "summary"] as const,
  shifts: () => [...workforceKeys.all, "shifts"] as const,

  managers: (p: RosterParams) => [...workforceKeys.all, "managers", p] as const,
  managerStats: () => [...workforceKeys.all, "managers", "stats"] as const,
  staff: (p: RosterParams) => [...workforceKeys.all, "staff", p] as const,
  staffStats: (role?: string) => [...workforceKeys.all, "staff", "stats", role ?? "all"] as const,

  employee: (id: string) => [...workforceKeys.all, "employee", id] as const,
  employeeSales: (id: string, p: PerformanceParams) =>
    [...workforceKeys.all, "employee", id, "sales", p] as const,
  employeeAttendance: (id: string, p: AttendanceParams) =>
    [...workforceKeys.all, "employee", id, "attendance", p] as const,
  employeeActivity: (id: string, p: ActivityParams) =>
    [...workforceKeys.all, "employee", id, "activity", p] as const,
  employeeLoginHistory: (id: string, p: LoginHistoryParams) =>
    [...workforceKeys.all, "employee", id, "login-history", p] as const,
  employeePermissions: (id: string) =>
    [...workforceKeys.all, "employee", id, "permissions"] as const,

  employeeNotes: (id: string) => [...workforceKeys.all, "employee", id, "notes"] as const,

  security: (p: SecurityParams) => [...workforceKeys.all, "security", p] as const,
  comparison: (p: CompareParams) => [...workforceKeys.all, "compare", p] as const,

  activity: (p: ActivityParams) => [...workforceKeys.all, "activity", p] as const,
  attendance: (p: AttendanceParams) => [...workforceKeys.all, "attendance", p] as const,
  attendanceSummary: (p: AttendanceParams) =>
    [...workforceKeys.all, "attendance", "summary", p] as const,
  loginHistory: (p: LoginHistoryParams) => [...workforceKeys.all, "login-history", p] as const,
  performance: (p: PerformanceParams) => [...workforceKeys.all, "performance", p] as const,
};

// How often presence-bearing queries refetch. Long enough to be cheap, short
// enough that the online/offline dots stay believable.
const PRESENCE_POLL_MS = 60_000;

// Historical data is immutable once written; two minutes of staleness costs
// nothing and removes a great deal of refetching.
const HISTORY_STALE_MS = 120_000;

// =============================================================================
// DASHBOARD
// =============================================================================

export function useWorkforceSummary() {
  return useQuery({
    queryKey: workforceKeys.summary(),
    queryFn: api.fetchWorkforceSummary,
    refetchInterval: PRESENCE_POLL_MS,
    staleTime: 30_000,
  });
}

/** The shift catalogue changes rarely — cache it hard, it drives filter dropdowns. */
export function useShifts() {
  return useQuery({
    queryKey: workforceKeys.shifts(),
    queryFn: api.fetchShifts,
    staleTime: 1000 * 60 * 30,
  });
}

// =============================================================================
// ROSTER
// =============================================================================

export function useManagers(params: RosterParams) {
  return useQuery({
    queryKey: workforceKeys.managers(params),
    queryFn: () => api.fetchManagers(params),
    placeholderData: (prev) => prev,
    refetchInterval: PRESENCE_POLL_MS,
  });
}

export function useManagerStats() {
  return useQuery({
    queryKey: workforceKeys.managerStats(),
    queryFn: api.fetchManagerStats,
    refetchInterval: PRESENCE_POLL_MS,
  });
}

export function useStaff(params: RosterParams) {
  return useQuery({
    queryKey: workforceKeys.staff(params),
    queryFn: () => api.fetchStaff(params),
    placeholderData: (prev) => prev,
    refetchInterval: PRESENCE_POLL_MS,
  });
}

export function useStaffStats(role?: string) {
  return useQuery({
    queryKey: workforceKeys.staffStats(role),
    queryFn: () => api.fetchStaffStats(role),
    refetchInterval: PRESENCE_POLL_MS,
  });
}

/**
 * Roster query for a given variant.
 *
 * The Managers and Employees screens are one component (RosterPage) with two
 * endpoints. Dispatching INSIDE a single useQuery — rather than calling
 * useManagers and useStaff side by side and reading one — is what stops the
 * unused variant from firing a real request on every render of the page.
 */
export function useRoster(variant: "managers" | "staff", params: RosterParams) {
  return useQuery({
    queryKey:
      variant === "managers"
        ? workforceKeys.managers(params)
        : workforceKeys.staff(params),
    queryFn: () =>
      variant === "managers" ? api.fetchManagers(params) : api.fetchStaff(params),
    placeholderData: (prev) => prev,
    refetchInterval: PRESENCE_POLL_MS,
  });
}

/** Employee detail — enabled-gated so it only runs when a drawer is actually open. */
export function useEmployee(id: string | undefined) {
  return useQuery({
    queryKey: workforceKeys.employee(id ?? ""),
    queryFn: () => api.fetchEmployee(id as string),
    enabled: Boolean(id),
  });
}

// =============================================================================
// DRAWER TABS — lazy by construction
// =============================================================================

export function useEmployeeSales(
  id: string | undefined,
  params: PerformanceParams,
  enabled: boolean
) {
  return useQuery({
    queryKey: workforceKeys.employeeSales(id ?? "", params),
    queryFn: () => api.fetchEmployeeSales(id as string, params),
    enabled: Boolean(id) && enabled,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useEmployeeAttendance(
  id: string | undefined,
  params: AttendanceParams,
  enabled: boolean
) {
  return useQuery({
    queryKey: workforceKeys.employeeAttendance(id ?? "", params),
    queryFn: () => api.fetchEmployeeAttendance(id as string, params),
    enabled: Boolean(id) && enabled,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useEmployeeActivity(
  id: string | undefined,
  params: ActivityParams,
  enabled: boolean
) {
  return useQuery({
    queryKey: workforceKeys.employeeActivity(id ?? "", params),
    queryFn: () => api.fetchEmployeeActivity(id as string, params),
    enabled: Boolean(id) && enabled,
    placeholderData: keepPreviousData,
    staleTime: HISTORY_STALE_MS,
  });
}

export function useEmployeeLoginHistory(
  id: string | undefined,
  params: LoginHistoryParams,
  enabled: boolean
) {
  return useQuery({
    queryKey: workforceKeys.employeeLoginHistory(id ?? "", params),
    queryFn: () => api.fetchEmployeeLoginHistory(id as string, params),
    enabled: Boolean(id) && enabled,
    placeholderData: keepPreviousData,
    staleTime: HISTORY_STALE_MS,
  });
}

/**
 * Employee notes — OWNER-only.
 *
 * `enabled` is gated on BOTH the tab being open and the caller being an owner.
 * A manager must never fire this request: the endpoint does not exist on their
 * route tree, so an ungated call would produce a 404 in the console on every
 * drawer open rather than simply not being offered.
 */
export function useEmployeeNotes(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: workforceKeys.employeeNotes(id ?? ""),
    queryFn: () => api.fetchNotes(id as string),
    enabled: Boolean(id) && enabled,
    staleTime: 30_000,
  });
}

export function useEmployeePermissions(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: workforceKeys.employeePermissions(id ?? ""),
    queryFn: () => api.fetchEmployeePermissions(id as string),
    enabled: Boolean(id) && enabled,
    // The matrix is derived from the role, not stored per employee — it only
    // changes when the role does, which invalidates this key anyway.
    staleTime: 1000 * 60 * 10,
  });
}

// =============================================================================
// MODULE PAGES
// =============================================================================

export function useActivity(params: ActivityParams) {
  return useQuery({
    queryKey: workforceKeys.activity(params),
    queryFn: () => api.fetchActivity(params),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useAttendance(params: AttendanceParams) {
  return useQuery({
    queryKey: workforceKeys.attendance(params),
    queryFn: () => api.fetchAttendance(params),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useAttendanceSummary(params: AttendanceParams) {
  return useQuery({
    queryKey: workforceKeys.attendanceSummary(params),
    queryFn: () => api.fetchAttendanceSummary(params),
    staleTime: 30_000,
  });
}

export function useLoginHistory(params: LoginHistoryParams) {
  return useQuery({
    queryKey: workforceKeys.loginHistory(params),
    queryFn: () => api.fetchLoginHistory(params),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function usePerformance(params: PerformanceParams) {
  return useQuery({
    queryKey: workforceKeys.performance(params),
    queryFn: () => api.fetchPerformance(params),
    placeholderData: (prev) => prev,
    staleTime: HISTORY_STALE_MS,
  });
}

/**
 * Security counters for the Login History dashboard.
 *
 * Polled like the other presence-bearing surfaces: an "active sessions" count
 * that is ten minutes stale is worse than no count, because it invites the
 * owner to terminate a session that already ended.
 */
export function useSecurityOverview(params: SecurityParams) {
  return useQuery({
    queryKey: workforceKeys.security(params),
    queryFn: () => api.fetchSecurityOverview(params),
    placeholderData: (prev) => prev,
    refetchInterval: PRESENCE_POLL_MS,
  });
}

/** Two-employee comparison. Gated on both ids being chosen. */
export function useComparison(params: CompareParams, enabled: boolean) {
  return useQuery({
    queryKey: workforceKeys.comparison(params),
    queryFn: () => api.fetchComparison(params),
    enabled: enabled && Boolean(params.employeeA) && Boolean(params.employeeB),
    staleTime: HISTORY_STALE_MS,
  });
}

// =============================================================================
// MUTATIONS
//
// Each invalidates the whole `workforce` subtree rather than surgically
// patching individual caches. These mutations are rare (an owner edits an
// employee occasionally) and their effects are wide — a deactivation changes
// the roster row, the summary counts, the stats strip and presence at once.
// One broad invalidation is both simpler and less likely to leave a stale card
// than four narrow ones.
// =============================================================================

export function useUpdateEmployee() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: api.UpdateEmployeePayload }) =>
      api.updateEmployee(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api.resetPassword(id, newPassword),
  });
}

export function useChangeRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: "MANAGER" | "CASHIER" }) =>
      api.changeRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useClockIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId?: string) => api.clockIn(employeeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useClockOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId?: string) => api.clockOut(employeeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useSaveAttendance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: api.ManualAttendancePayload) => api.saveAttendance(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

// ── Breaks ───────────────────────────────────────────────────────────────────

export function useStartBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId?: string) => api.startBreak(employeeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useEndBreak() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId?: string) => api.endBreak(employeeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

// ── Notes (OWNER-only) ───────────────────────────────────────────────────────
//
// These invalidate ONLY the one employee's notes key, unlike the roster
// mutations above. A note changes nothing else on any screen, so the broad
// invalidation those use would needlessly refetch the whole module.

export function useCreateNote(employeeId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateNotePayload) =>
      api.createNote(employeeId as string, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.employeeNotes(employeeId ?? "") });
    },
  });
}

export function useUpdateNote(employeeId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, payload }: { noteId: string; payload: UpdateNotePayload }) =>
      api.updateNote(noteId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.employeeNotes(employeeId ?? "") });
    },
  });
}

export function useDeleteNote(employeeId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) => api.deleteNote(noteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.employeeNotes(employeeId ?? "") });
    },
  });
}

// ── Sessions (OWNER-only) ────────────────────────────────────────────────────

export function useTerminateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.terminateSession(sessionId),
    onSuccess: () => {
      // Ending a session changes presence dots across the whole module, not
      // just the login-history row — hence the broad invalidation here.
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useForceLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (employeeId: string) => api.forceLogout(employeeId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

// ── Shifts (OWNER-only) ──────────────────────────────────────────────────────

export function useCreateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: ShiftPayload) => api.createShift(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useUpdateShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Partial<ShiftPayload> }) =>
      api.updateShift(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}

export function useAssignShift() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AssignShiftPayload) => api.assignShift(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workforceKeys.all });
    },
  });
}
