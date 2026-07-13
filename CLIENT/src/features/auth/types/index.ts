/**
 * @file features/auth/types/index.ts
 *
 * Purpose: All TypeScript types and interfaces owned exclusively by the Auth feature.
 *
 * Why it exists here and NOT in src/types/index.d.ts:
 *   Global types are reserved for cross-domain primitives (Role, UserInfo,
 *   PaginationMeta). Auth-specific API request/response shapes are auth
 *   implementation details — no other feature needs to know the shape of a
 *   LoginRequest or AuthTokenResponse. Keeping them here enforces feature
 *   isolation and allows future changes (e.g., adding MFA fields) without
 *   touching global types.
 *
 * Future extensibility:
 *   - Add MfaChallenge, OtpRequest, BiometricPayload as new interfaces here.
 *   - Add MultiStoreContext if multi-store login is introduced.
 */

import type { UserInfo, Role } from "@/types";

// ─── API Request Shapes ──────────────────────────────────────────────────────

/** Body sent to POST /auth/login */
export interface LoginRequest {
  email?: string;
  phone?: string;
  password: string;
}

/** Body sent to PATCH /auth/change-password */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
  confirmNewPassword: string;
}

// ─── API Response Shapes ─────────────────────────────────────────────────────

/**
 * Shape of data returned by the backend on successful login.
 * The backend wraps this in { success, message, data: AuthTokenResponse }.
 */
export interface AuthTokenResponse {
  token: string;
  employee: AuthUser;
}

/**
 * The authenticated user object as returned by the backend.
 * Superset of UserInfo — contains auth-related fields.
 * We store this in Zustand, NOT the raw JWT.
 */
export interface AuthUser extends UserInfo {
  email: string | null;
  phone: string | null;
  isActive: boolean;
}

/** Standard backend API envelope */
export interface ApiResponse<T> {
  success: boolean;
  message: string;
  data: T;
}

// ─── Auth Store State ─────────────────────────────────────────────────────────

export type SessionStatus =
  | "idle"       // Initial state — not yet checked
  | "loading"    // Hydrating / checking session
  | "authenticated"
  | "unauthenticated"
  | "expired";   // Token existed but was rejected by server

export interface AuthStoreState {
  // ── Data ──────────────────────────────────────────────────────────────────
  accessToken: string | null;
  user: AuthUser | null;
  sessionStatus: SessionStatus;

  // ── Actions ───────────────────────────────────────────────────────────────
  setSession: (token: string, user: AuthUser) => void;
  clearSession: () => void;
  setSessionStatus: (status: SessionStatus) => void;
  updateUser: (user: AuthUser) => void;
}

// ─── Permission Types ─────────────────────────────────────────────────────────

/**
 * A permission check function signature.
 * Allows composing complex permission rules as pure functions.
 */
export type PermissionCheck = (role: Role | null) => boolean;
