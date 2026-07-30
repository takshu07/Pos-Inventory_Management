/**
 * Workforce Management — transport layer.
 *
 * THE ROLE-AWARE BASE PATH
 * ------------------------
 * The backend exposes two workforce trees: `/owner/workforce` (full surface,
 * every mutation) and `/manager/workforce` (read-only monitoring). Every
 * function here resolves its base path from the CURRENT USER'S ROLE via
 * `basePath()`, so one set of API functions serves both portals.
 *
 * This is a convenience, NOT a security control. A manager who tampers with
 * the client and calls an owner path is rejected by that tree's OWNER guard,
 * and a manager calling a shared read endpoint receives a narrowed result set
 * because the service scopes by the authenticated actor. The client choosing
 * the right path simply avoids a guaranteed 403 on every request.
 */

import { apiClient } from "@/lib/api";
import { ENV } from "@/config/env";
import { useAuthStore } from "@/store/auth.store";
import type {
  ActivityParams,
  ActivityRow,
  AssignShiftPayload,
  AttendanceParams,
  AttendanceRow,
  AttendanceSummary,
  CompareParams,
  ComparisonResponse,
  CreateNotePayload,
  EmployeeNote,
  SecurityOverview,
  SecurityParams,
  ShiftPayload,
  UpdateNotePayload,
  EmployeeAttendanceResponse,
  EmployeeSales,
  LoginHistoryParams,
  LoginHistoryRow,
  Paginated,
  PerformanceParams,
  PerformanceResponse,
  PermissionsResponse,
  RosterParams,
  RosterStats,
  Shift,
  WorkforceEmployee,
  WorkforceEmployeeDetail,
  WorkforceSummary,
} from "../types";

/**
 * Resolves the workforce API root for the signed-in role.
 * Read fresh from the store on every call — a role change mid-session (owner
 * demotes a manager) must not be served from a stale closure.
 */
function basePath(): string {
  const role = useAuthStore.getState().user?.role;
  return role === "OWNER" ? "/owner/workforce" : "/manager/workforce";
}

/**
 * Drops empty params before they reach the query string.
 *
 * Sending `?role=` would make the server parse an empty string as a filter
 * value; dropping the key entirely is what makes "no filter" mean no filter.
 * `false` is preserved deliberately — `isActive=false` is a real filter.
 */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined
    )
  );
}

/** Unwraps the shared `{ data, meta }` envelope into the client's flat shape. */
function toPaginated<T>(response: any, fallbackLimit: number): Paginated<T> {
  return {
    data: response?.data ?? [],
    total: response?.meta?.total ?? 0,
    page: response?.meta?.page ?? 1,
    totalPages: response?.meta?.totalPages ?? Math.max(1, Math.ceil((response?.meta?.total ?? 0) / fallbackLimit)),
  };
}

// =============================================================================
// DASHBOARD
// =============================================================================

export async function fetchWorkforceSummary(): Promise<WorkforceSummary> {
  const res = await apiClient.get<any>(`${basePath()}/summary`);
  return res.data;
}

export async function fetchShifts(): Promise<Shift[]> {
  const res = await apiClient.get<any>(`${basePath()}/shifts`);
  return res.data ?? [];
}

// =============================================================================
// ROSTER
// =============================================================================

export async function fetchManagers(
  params: RosterParams
): Promise<Paginated<WorkforceEmployee>> {
  const res = await apiClient.get<any>(`${basePath()}/managers`, { params: clean(params) });
  return toPaginated<WorkforceEmployee>(res, params.limit ?? 20);
}

export async function fetchManagerStats(): Promise<RosterStats> {
  const res = await apiClient.get<any>(`${basePath()}/managers/stats`);
  return res.data;
}

export async function fetchStaff(
  params: RosterParams
): Promise<Paginated<WorkforceEmployee>> {
  const res = await apiClient.get<any>(`${basePath()}/staff`, { params: clean(params) });
  return toPaginated<WorkforceEmployee>(res, params.limit ?? 20);
}

export async function fetchStaffStats(role?: string): Promise<RosterStats> {
  const res = await apiClient.get<any>(`${basePath()}/staff/stats`, {
    params: role ? { role } : {},
  });
  return res.data;
}

export async function fetchEmployee(id: string): Promise<WorkforceEmployeeDetail> {
  const res = await apiClient.get<any>(`${basePath()}/employees/${id}`);
  return res.data;
}

// =============================================================================
// DRAWER TABS — each fetched only when its tab is opened
// =============================================================================

export async function fetchEmployeeSales(
  id: string,
  params: PerformanceParams
): Promise<EmployeeSales> {
  const res = await apiClient.get<any>(`${basePath()}/employees/${id}/sales`, {
    params: clean(params),
  });
  return res.data;
}

export async function fetchEmployeeAttendance(
  id: string,
  params: AttendanceParams
): Promise<EmployeeAttendanceResponse> {
  // `any` for the same reason as every other call here: the response
  // interceptor returns the envelope itself, so the AxiosResponse type no
  // longer describes what actually arrives.
  const res: any = await apiClient.get<any>(`${basePath()}/employees/${id}/attendance`, {
    params: clean(params),
  });

  // This endpoint is the one place the envelope carries BOTH a composite `data`
  // ({records, summary}) and a sibling `meta` that describes only `records`.
  // Folding meta in here is what lets the drawer page through attendance —
  // reading `records.length` instead would cap it at a single page forever.
  const limit = params.limit ?? 10;
  const total = res?.meta?.total ?? 0;

  return {
    records: res?.data?.records ?? [],
    summary: res?.data?.summary,
    total,
    page: res?.meta?.page ?? 1,
    totalPages: res?.meta?.totalPages ?? Math.max(1, Math.ceil(total / limit)),
  };
}

export async function fetchEmployeeActivity(
  id: string,
  params: ActivityParams
): Promise<Paginated<ActivityRow>> {
  const res = await apiClient.get<any>(`${basePath()}/employees/${id}/activity`, {
    params: clean(params),
  });
  return toPaginated<ActivityRow>(res, params.limit ?? 20);
}

export async function fetchEmployeeLoginHistory(
  id: string,
  params: LoginHistoryParams
): Promise<Paginated<LoginHistoryRow>> {
  const res = await apiClient.get<any>(`${basePath()}/employees/${id}/login-history`, {
    params: clean(params),
  });
  return toPaginated<LoginHistoryRow>(res, params.limit ?? 20);
}

export async function fetchEmployeePermissions(id: string): Promise<PermissionsResponse> {
  const res = await apiClient.get<any>(`${basePath()}/employees/${id}/permissions`);
  return res.data;
}

// =============================================================================
// MODULE PAGES
// =============================================================================

export async function fetchActivity(
  params: ActivityParams
): Promise<Paginated<ActivityRow>> {
  const res = await apiClient.get<any>(`${basePath()}/activity`, { params: clean(params) });
  return toPaginated<ActivityRow>(res, params.limit ?? 25);
}

export async function fetchAttendance(
  params: AttendanceParams
): Promise<Paginated<AttendanceRow>> {
  const res = await apiClient.get<any>(`${basePath()}/attendance`, { params: clean(params) });
  return toPaginated<AttendanceRow>(res, params.limit ?? 25);
}

export async function fetchAttendanceSummary(
  params: AttendanceParams
): Promise<AttendanceSummary> {
  const res = await apiClient.get<any>(`${basePath()}/attendance/summary`, {
    params: clean(params),
  });
  return res.data;
}

export async function fetchLoginHistory(
  params: LoginHistoryParams
): Promise<Paginated<LoginHistoryRow>> {
  const res = await apiClient.get<any>(`${basePath()}/login-history`, {
    params: clean(params),
  });
  return toPaginated<LoginHistoryRow>(res, params.limit ?? 25);
}

export async function fetchPerformance(
  params: PerformanceParams
): Promise<PerformanceResponse> {
  const res = await apiClient.get<any>(`${basePath()}/performance`, { params: clean(params) });
  return res.data;
}

// =============================================================================
// MUTATIONS
//
// These hit the OWNER tree explicitly rather than via basePath(). Hardcoding
// the path makes the requirement visible at the call site: these operations
// exist only for an owner, and a manager reaching one gets a 403 rather than
// silently hitting a manager endpoint that does not implement it.
// =============================================================================

const OWNER_BASE = "/owner/workforce";

export async function clockIn(employeeId?: string): Promise<AttendanceRow> {
  const res = await apiClient.post<any>(`${basePath()}/attendance/clock-in`,
    employeeId ? { employeeId } : {}
  );
  return res.data;
}

export async function clockOut(employeeId?: string): Promise<AttendanceRow> {
  const res = await apiClient.post<any>(`${basePath()}/attendance/clock-out`,
    employeeId ? { employeeId } : {}
  );
  return res.data;
}

export interface ManualAttendancePayload {
  employeeId: string;
  date: string;
  clockInAt?: string;
  clockOutAt?: string;
  status?: string;
  notes?: string;
}

export async function saveAttendance(
  payload: ManualAttendancePayload
): Promise<AttendanceRow> {
  const res = await apiClient.put<any>(`${OWNER_BASE}/attendance`, clean(payload));
  return res.data;
}

export interface UpdateEmployeePayload {
  photoUrl?: string | null;
  employmentStatus?: string;
  shiftId?: string | null;
  storeCode?: string | null;
  isActive?: boolean;
  exitDate?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  assignedRegister?: string | null;
  /** Null CLEARS the target; undefined leaves it untouched. */
  monthlyTarget?: number | null;
}

export async function updateEmployee(
  id: string,
  payload: UpdateEmployeePayload
): Promise<WorkforceEmployeeDetail> {
  const res = await apiClient.patch<any>(`${OWNER_BASE}/employees/${id}`, payload);
  return res.data;
}

export async function resetPassword(id: string, newPassword: string): Promise<void> {
  await apiClient.post(`${OWNER_BASE}/employees/${id}/reset-password`, { newPassword });
}

export async function changeRole(id: string, role: "MANAGER" | "CASHIER"): Promise<void> {
  await apiClient.patch(`${OWNER_BASE}/employees/${id}/role`, { role });
}

// =============================================================================
// EMPLOYEE NOTES — OWNER-only.
//
// Pinned to OWNER_BASE rather than basePath(): these endpoints do not exist on
// the manager tree at all, so resolving by role would send a manager to a 404
// instead of making it obvious the feature is not theirs.
// =============================================================================

export async function fetchNotes(employeeId: string): Promise<EmployeeNote[]> {
  const res = await apiClient.get<any>(`${OWNER_BASE}/employees/${employeeId}/notes`);
  return res.data ?? [];
}

export async function createNote(
  employeeId: string,
  payload: CreateNotePayload
): Promise<EmployeeNote> {
  const res = await apiClient.post<any>(
    `${OWNER_BASE}/employees/${employeeId}/notes`,
    payload
  );
  return res.data;
}

export async function updateNote(
  noteId: string,
  payload: UpdateNotePayload
): Promise<EmployeeNote> {
  const res = await apiClient.patch<any>(`${OWNER_BASE}/notes/${noteId}`, payload);
  return res.data;
}

export async function deleteNote(noteId: string): Promise<void> {
  await apiClient.delete(`${OWNER_BASE}/notes/${noteId}`);
}

// =============================================================================
// BREAKS — self-service, so role-resolved like clock-in/out.
// =============================================================================

export async function startBreak(employeeId?: string): Promise<AttendanceRow> {
  const res = await apiClient.post<any>(
    `${basePath()}/attendance/break/start`,
    employeeId ? { employeeId } : {}
  );
  return res.data;
}

export async function endBreak(employeeId?: string): Promise<AttendanceRow> {
  const res = await apiClient.post<any>(
    `${basePath()}/attendance/break/end`,
    employeeId ? { employeeId } : {}
  );
  return res.data;
}

// =============================================================================
// SECURITY — the overview is readable by both roles (server narrows the set);
// terminating a session and forcing a logout are OWNER-only.
// =============================================================================

export async function fetchSecurityOverview(
  params: SecurityParams
): Promise<SecurityOverview> {
  const res = await apiClient.get<any>(`${basePath()}/security/overview`, {
    params: clean(params),
  });
  return res.data;
}

export async function terminateSession(sessionId: string): Promise<void> {
  await apiClient.post(`${OWNER_BASE}/sessions/${sessionId}/terminate`);
}

export async function forceLogout(employeeId: string): Promise<void> {
  await apiClient.post(`${OWNER_BASE}/employees/${employeeId}/force-logout`);
}

// =============================================================================
// COMPARISON & SHIFT MANAGEMENT — OWNER-only.
// =============================================================================

export async function fetchComparison(
  params: CompareParams
): Promise<ComparisonResponse> {
  const res = await apiClient.get<any>(`${OWNER_BASE}/compare`, {
    params: clean(params),
  });
  return res.data;
}

export async function createShift(payload: ShiftPayload): Promise<Shift> {
  const res = await apiClient.post<any>(`${OWNER_BASE}/shifts`, payload);
  return res.data;
}

export async function updateShift(
  id: string,
  payload: Partial<ShiftPayload>
): Promise<Shift> {
  const res = await apiClient.patch<any>(`${OWNER_BASE}/shifts/${id}`, payload);
  return res.data;
}

export async function assignShift(
  payload: AssignShiftPayload
): Promise<{ assigned: number; shiftId: string | null }> {
  const res = await apiClient.post<any>(`${OWNER_BASE}/shifts/assign`, payload);
  return res.data;
}

// =============================================================================
// EXPORTS
// =============================================================================

export type WorkforceReport = "attendance" | "performance" | "login-history" | "activity";
export type ExportFormat = "csv" | "excel" | "pdf";

/**
 * Downloads a report.
 *
 * Deliberately bypasses `apiClient`: that instance's response interceptor
 * unwraps `{ success, data }` JSON, which would mangle a CSV body. It also
 * cannot express `responseType: blob` without special-casing. Building the URL
 * and letting the browser fetch it keeps the transport honest — and means the
 * server's Content-Disposition drives the filename rather than the client
 * guessing one.
 *
 * PDF is served as printable HTML (the server does not lie about the content
 * type), so it opens in a print window instead of downloading.
 */
export async function downloadReport(
  report: WorkforceReport,
  format: ExportFormat,
  filters: Record<string, unknown> = {}
): Promise<void> {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(clean(filters))) {
    params.set(key, String(value));
  }

  // Same validated env the axios instance uses — not a second source of truth
  // for where the API lives.
  const token = useAuthStore.getState().accessToken;

  const response = await fetch(`${ENV.VITE_API_URL}${basePath()}/export/${report}?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    throw new Error(`Export failed (${response.status})`);
  }

  const blob = await response.blob();

  // The server owns the filename; fall back only if the header is absent.
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `${report}.${format === "excel" ? "xls" : format}`;

  if (format === "pdf") {
    // Printable HTML: open it so the browser's own print-to-PDF renders it.
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    // Revoke late — revoking immediately can race the new window's load.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
