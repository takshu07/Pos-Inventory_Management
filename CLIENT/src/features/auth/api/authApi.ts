/**
 * @file features/auth/api/authApi.ts
 *
 * Purpose: All HTTP calls for the auth domain. Pure async functions —
 * no React, no state, no side effects beyond the HTTP call itself.
 *
 * Why it exists:
 *   React components must NEVER call apiClient directly. This layer
 *   provides a clean, typed, mockable boundary between UI and network.
 *   TanStack Query hooks compose these functions — they do NOT inline fetch calls.
 *
 * Why it belongs in features/auth/:
 *   These endpoints are auth-specific. No other feature calls /auth/*.
 *   Co-locating API, types, and validation within the feature means
 *   a developer working on auth finds everything in one folder.
 *
 * Dependencies: apiClient (shared infrastructure), auth types
 *
 * Public API: loginRequest, getCurrentUser, changePassword
 *
 * Future extensibility:
 *   - Add refreshToken() when backend exposes a refresh endpoint.
 *   - Add requestOtp(), verifyOtp() for OTP login.
 *   - Add setupOwner() is already here.
 */

import { apiClient } from "@/lib/api";
import type {
  LoginRequest,
  AuthTokenResponse,
  AuthUser,
  ApiResponse,
  ChangePasswordRequest,
} from "../types";

/**
 * POST /auth/login
 * Authenticates an employee and returns the JWT + user profile.
 * The response interceptor in axios.ts returns response.data directly,
 * so we type this as ApiResponse<AuthTokenResponse>.
 */
export async function loginRequest(
  payload: LoginRequest
): Promise<ApiResponse<AuthTokenResponse>> {
  return apiClient.post("/auth/login", payload);
}

/**
 * GET /auth/me
 * Validates the current access token and returns the user's current profile.
 * Used on app boot to rehydrate the session and on profile screens.
 * Throws on 401 → axios interceptor handles redirect to login.
 */
export async function getCurrentUser(): Promise<ApiResponse<AuthUser>> {
  return apiClient.get("/auth/me");
}

/**
 * PATCH /auth/change-password
 * Updates the authenticated employee's password.
 * Backend invalidates all tokens on success — frontend must logout after.
 */
export async function changePasswordRequest(
  payload: ChangePasswordRequest
): Promise<ApiResponse<null>> {
  return apiClient.patch("/auth/change-password", payload);
}

/**
 * POST /auth/setup
 * One-time owner initialization endpoint. Used only during initial store setup.
 * Exposed here for completeness — future setup wizard will use it.
 */
export async function setupOwner(payload: {
  firstName: string;
  lastName: string;
  employeeCode: string;
  password: string;
}): Promise<ApiResponse<AuthTokenResponse>> {
  return apiClient.post("/auth/setup", payload);
}
