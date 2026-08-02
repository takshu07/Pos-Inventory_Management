/**
 * Users & Roles — transport layer.
 *
 * WHY THIS SPANS TWO BACKEND TREES
 * --------------------------------
 * Account administration is not one endpoint family on the server, and this
 * file does not pretend otherwise:
 *
 *   • `/employees`                     — identity + role + activation.
 *       Owns firstName/lastName/email/phone/role/isActive, the uniqueness
 *       checks on email and phone, and `enforceHierarchy`. List and read are
 *       MANAGER+; create and update are OWNER-only.
 *
 *   • `/owner/workforce/employees/:id` — password reset and role change.
 *       These exist here rather than on `/employees` because they have side
 *       effects the plain PATCH does not: both bump the token version and
 *       close every open session, and reset additionally dispatches a
 *       notification. OWNER-only for the whole tree.
 *
 * ⚠ DO NOT CONSOLIDATE THESE INTO `/employees` PATCH. Routing role changes
 * through it *would appear to work* — the service accepts `role` and enforces
 * the hierarchy — which is exactly what makes the mistake tempting and its
 * consequence invisible in testing. That path does NOT revoke the stale JWT,
 * so a demoted manager keeps manager access until their token expires, and a
 * password reset would leave every existing session live. Session revocation
 * is a SECURITY REQUIREMENT of both operations, not an implementation detail
 * of where they happen to live.
 *
 * `changeUserRole` and `resetUserPassword` below therefore target the workforce
 * endpoints, the only ones that call `invalidateAuthContext` +
 * `closeOpenSessions`. This is asserted by
 * features/users/__tests__/usersApi.test.ts — if you are reading this because
 * that test failed after a refactor, the test is right.
 *
 * None of this is a security control. It is about hitting the endpoint whose
 * semantics match the intent; every one of these is independently guarded
 * server-side, and a tampered client calling the wrong one gets a 403.
 */

import { apiClient } from "@/lib/api";
import type {
  AssignableRole,
  CreateUserPayload,
  Paginated,
  UpdateUserPayload,
  User,
  UserListParams,
} from "../types";

const EMPLOYEES_BASE = "/employees";
const OWNER_WORKFORCE_BASE = "/owner/workforce";

/**
 * Drops empty params before they reach the query string.
 *
 * Sending `?role=` would make the server's zod enum reject an empty string
 * rather than read it as "no filter". `false` is preserved deliberately —
 * `isActive=false` is a real filter meaning "show deactivated accounts".
 */
function clean<T extends object>(params: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).filter(
      ([, v]) => v !== "" && v !== null && v !== undefined
    )
  );
}

/**
 * Unwraps the shared `{ data, meta }` envelope into the client's flat shape.
 *
 * `any` because the axios response interceptor already returns the envelope
 * itself, so the AxiosResponse type no longer describes what actually arrives —
 * the same reason the workforce API layer does this.
 */
function toPaginated<T>(response: any, fallbackLimit: number): Paginated<T> {
  const total = response?.meta?.total ?? 0;
  return {
    data: response?.data ?? [],
    total,
    page: response?.meta?.page ?? 1,
    totalPages:
      response?.meta?.totalPages ?? Math.max(1, Math.ceil(total / fallbackLimit)),
  };
}

// =============================================================================
// READS — MANAGER+ server-side, but this screen is OWNER-only by route guard.
// =============================================================================

export async function fetchUsers(params: UserListParams): Promise<Paginated<User>> {
  const res = await apiClient.get<any>(EMPLOYEES_BASE, { params: clean(params) });
  return toPaginated<User>(res, params.limit ?? 10);
}

export async function fetchUser(id: string): Promise<User> {
  const res = await apiClient.get<any>(`${EMPLOYEES_BASE}/${id}`);
  return res.data;
}

// =============================================================================
// WRITES — every one is OWNER-only server-side.
// =============================================================================

export async function createUser(payload: CreateUserPayload): Promise<User> {
  const res = await apiClient.post<any>(EMPLOYEES_BASE, clean(payload));
  return res.data;
}

/**
 * Partial identity update.
 *
 * `clean()` is NOT applied: `isActive: false` must survive to the wire, and an
 * empty-string email is the server's documented way to CLEAR the address
 * (`if (data.email === "") updateData.email = null`). Stripping either would
 * turn a deliberate change into a silent no-op. The caller is responsible for
 * sending only the keys it means to change — which is what the forms do.
 */
export async function updateUser(
  id: string,
  payload: UpdateUserPayload
): Promise<User> {
  const res = await apiClient.patch<any>(`${EMPLOYEES_BASE}/${id}`, payload);
  return res.data;
}

/**
 * Activate or deactivate an account.
 *
 * A thin wrapper over updateUser rather than its own endpoint, so account
 * status has one write path. Deactivation is the system's "remove access"
 * operation — employee rows are never deleted, because sales, attendance and
 * audit entries reference them (the FKs are `onDelete: Restrict`).
 *
 * The server refuses to deactivate an OWNER regardless of what is sent here.
 */
export async function setUserActive(id: string, isActive: boolean): Promise<User> {
  return updateUser(id, { isActive });
}

/**
 * Role change — routed to the WORKFORCE endpoint, not `/employees` PATCH.
 *
 * This is the one that invalidates the auth-context cache and force-closes
 * open sessions, so the role embedded in the old JWT cannot outlive the change.
 * See the file header.
 */
export async function changeUserRole(
  id: string,
  role: AssignableRole
): Promise<void> {
  await apiClient.patch(`${OWNER_WORKFORCE_BASE}/employees/${id}/role`, { role });
}

/**
 * Owner-initiated password reset.
 *
 * Signs the target out of every device immediately (token version bump + all
 * sessions closed) and notifies them. Distinct from `/auth/change-password`,
 * which is how a user changes their OWN password and requires the current one.
 */
export async function resetUserPassword(
  id: string,
  newPassword: string
): Promise<void> {
  await apiClient.post(`${OWNER_WORKFORCE_BASE}/employees/${id}/reset-password`, {
    newPassword,
  });
}
