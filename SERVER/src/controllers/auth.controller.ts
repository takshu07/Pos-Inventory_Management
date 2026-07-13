// =============================================================================
// AUTH CONTROLLER
// Thin HTTP adapter layer — no business logic, no database logic.
//
// Responsibilities:
// - Parse and validate request bodies via Zod schemas
// - Call the appropriate service method
// - Format and send the HTTP response
//
// All error handling is delegated to the global error middleware.
// asyncHandler ensures thrown errors are passed to next() automatically.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as authService from "../services/auth.service";
import { asyncHandler } from "../utils/asyncHandler";
import { authValidation } from "../validation/auth.validation";

// =============================================================================
// POST /auth/setup
// One-time owner initialization endpoint.
// Disabled after first call (enforced in service layer).
// =============================================================================

export const setup = asyncHandler(async (req: Request, res: Response) => {
  const data = authValidation.setup.parse(req.body);
  const result = await authService.setup(data);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message:
      "Setup completed successfully. Your owner account has been created.",
    data: result,
  });
});

// =============================================================================
// POST /auth/login
// Email or phone + password login.
// Returns a JWT access token and the employee's public profile.
// =============================================================================

export const login = asyncHandler(async (req: Request, res: Response) => {
  const data = authValidation.login.parse(req.body);
  const result = await authService.login(data);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Login successful.",
    data: result,
  });
});

// =============================================================================
// GET /auth/me
// Returns the authenticated employee's current profile.
// Requires: authenticate middleware.
// =============================================================================

export const me = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.me(req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Profile retrieved successfully.",
    data: result,
  });
});

// =============================================================================
// PATCH /auth/change-password
// Allows an authenticated employee to update their own password.
// Requires: authenticate middleware.
// After success: all existing tokens for this employee are invalidated.
// =============================================================================

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    const data = authValidation.changePassword.parse(req.body);
    await authService.changePassword(req.user.id, data);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      message:
        "Password changed successfully. Please log in again on all devices.",
    });
  }
);