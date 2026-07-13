/**
 * @file features/auth/constants/index.ts
 *
 * Purpose: Centralizes all magic strings and configuration constants for the
 * auth feature. No component or hook should use raw string literals for
 * routes, storage keys, or error messages.
 *
 * Why it exists: Prevents typos, enables refactoring with one change,
 * and makes the codebase self-documenting.
 */

/** TanStack Query keys for the auth domain. Grouped as objects for namespace collision prevention. */
export const AUTH_QUERY_KEYS = {
  /** Key for GET /auth/me — current authenticated user */
  currentUser: ["auth", "currentUser"] as const,
  /** Key for session validation check */
  sessionCheck: ["auth", "session"] as const,
} as const;

/** Route paths used by the auth feature */
export const AUTH_ROUTES = {
  login: "/login",
  unauthorized: "/unauthorized",
  sessionExpired: "/session-expired",
  dashboard: "/",
} as const;

/** localStorage key — must match auth.store.ts persist config */
export const AUTH_STORAGE_KEY = "cex-auth-storage";

/** Human-readable validation messages — must match design-principles.md (plain English) */
export const AUTH_VALIDATION_MESSAGES = {
  identifier: {
    required: "Email or phone number is required.",
    format: "Please enter a valid email address or 10-digit Indian mobile number.",
  },
  password: {
    required: "Password is required.",
    minLength: "Password must be at least 6 characters.",
    maxLength: "Password cannot exceed 128 characters.",
  },
  currentPassword: {
    required: "Current password is required.",
  },
  newPassword: {
    required: "New password is required.",
    minLength: "New password must be at least 8 characters.",
    strength: "Password must contain at least one uppercase letter, one number, and one special character.",
    sameAsCurrent: "New password must be different from your current password.",
  },
  confirmPassword: {
    required: "Please confirm your new password.",
    mismatch: "Passwords do not match.",
  },
} as const;

/** Number of failed login attempts before showing lockout UI */
export const MAX_LOGIN_ATTEMPTS = 5;

/** Milliseconds to wait before allowing retry after lockout */
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
