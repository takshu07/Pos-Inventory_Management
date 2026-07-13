/**
 * @file features/auth/validation/index.ts
 *
 * Purpose: Zod schemas for all auth form inputs.
 *
 * Why it lives here: Validation is form-specific and auth-specific.
 * It must be colocated with the feature so that form components,
 * hooks, and types are always in sync. No other feature needs these
 * schemas — they are not shared.
 *
 * Dependencies: zod, auth constants (for error messages)
 *
 * Future extensibility:
 *   - Add otpSchema for OTP login.
 *   - Add pinSchema for PIN login.
 *   - Add mfaSchema for multi-factor.
 */

import { z } from "zod";
import { AUTH_VALIDATION_MESSAGES as MSG } from "../constants";

// ─── Login Schema ─────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, MSG.identifier.required)
    .trim()
    .refine((val) => {
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val);
      const isPhone = /^[6-9]\d{9}$/.test(val);
      return isEmail || isPhone;
    }, MSG.identifier.format),
  password: z
    .string()
    .min(1, MSG.password.required)
    .min(6, MSG.password.minLength)
    .max(128, MSG.password.maxLength),
});

export type LoginFormValues = z.infer<typeof loginSchema>;

// ─── Change Password Schema ───────────────────────────────────────────────────

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, MSG.currentPassword.required),
    newPassword: z
      .string()
      .min(1, MSG.newPassword.required)
      .min(8, MSG.newPassword.minLength)
      .regex(
        /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/,
        MSG.newPassword.strength
      ),
    confirmNewPassword: z.string().min(1, MSG.confirmPassword.required),
  })
  .refine((data) => data.newPassword === data.confirmNewPassword, {
    message: MSG.confirmPassword.mismatch,
    path: ["confirmNewPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: MSG.newPassword.sameAsCurrent,
    path: ["newPassword"],
  });

export type ChangePasswordFormValues = z.infer<typeof changePasswordSchema>;
