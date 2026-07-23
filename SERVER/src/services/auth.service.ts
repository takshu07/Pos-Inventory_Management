// =============================================================================
// AUTH SERVICE
// Owns all authentication business logic.
//
// Responsibilities:
// - Employee code generation
// - Password hashing and comparison
// - Token generation with correct payload
// - Business rule enforcement (setup only once, inactive check, etc.)
// - Coordinating repository calls within a single business operation
//
// What does NOT belong here:
// - HTTP request/response handling (controller responsibility)
// - Prisma queries (repository responsibility)
// - Zod parsing (controller responsibility)
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { authRepository } from "../repositories/auth.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type {
  ChangePasswordInput,
  LoginInput,
  SetupInput,
} from "../validation/auth.validation";
import { comparePassword, hashPassword } from "../utils/hash";
import { generateToken } from "../utils/jwt";
import { invalidateAuthContext } from "../utils/authContextCache";

// =============================================================================
// HELPER: EMPLOYEE CODE GENERATION
// Format: EMP-000001 for the owner.
// Subsequent employees follow a different pattern handled by employee service.
// =============================================================================

function generateOwnerCode(): string {
  return "EMP-000001";
}

// =============================================================================
// SETUP — ONE-TIME OWNER INITIALIZATION
// =============================================================================

/**
 * Creates the first owner employee and initializes store settings.
 * This endpoint is disabled after the first call.
 *
 * Transaction safety: the repository method runs both inserts in a single
 * Prisma transaction. If settings creation fails, the employee is not saved.
 */
export async function setup(data: SetupInput) {
  const alreadySetup = await authRepository.hasAnyEmployee();

  if (alreadySetup) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      "Initial setup has already been completed. This endpoint is disabled."
    );
  }

  const hashedPassword = await hashPassword(data.password);

  const employee = await authRepository.createOwnerWithSettings({
    employeeCode: generateOwnerCode(),
    firstName: data.firstName,
    lastName: data.lastName,
    phone: data.phone,
    email: data.email,
    hashedPassword,
    shopName: data.shopName,
  });

  const token = generateToken({
    id: employee.id,
    role: employee.role,
    tokenVersion: 0,
  });

  return {
    token,
    employee,
  };
}

// =============================================================================
// LOGIN
// =============================================================================

/**
 * Authenticates an employee using either email or phone + password.
 * Issues a new JWT with the employee's current tokenVersion embedded.
 *
 * Security: The same error message is returned for "not found" and
 * "wrong password" to prevent user enumeration attacks.
 */
export async function login(data: LoginInput) {
  // Find the employee by whichever credential was provided.
  // The Zod schema guarantees at least one of email/phone is present.
  const employee = data.email
    ? await authRepository.findByEmailForAuth(data.email)
    : await authRepository.findByPhoneForAuth(data.phone!);

  // Generic message — do not reveal whether the account exists.
  const invalidCredentialsError = new AppError(
    HTTP_STATUS.UNAUTHORIZED,
    "Invalid credentials. Please check your email/phone and password."
  );

  if (!employee) {
    throw invalidCredentialsError;
  }

  if (!employee.isActive) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Your account has been deactivated. Please contact your store manager."
    );
  }

  const isPasswordValid = await comparePassword(
    data.password,
    employee.password
  );

  if (!isPasswordValid) {
    throw invalidCredentialsError;
  }

  const token = generateToken({
    id: employee.id,
    role: employee.role,
    tokenVersion: employee.refreshTokenVersion,
  });

  // Fire-and-forget: update lastLogin without blocking the login response.
  authRepository.updateLastLogin(employee.id).catch((err: unknown) => {
    logger.error({ err }, "[AuthService] Failed to update lastLogin");
  });

  // Fire-and-forget: write audit log for successful login
  auditRepository.create({
    performedBy: employee.id,
    action: "LOGIN",
    module: "AUTH",
    tableName: "employees",
    recordId: employee.id,
  });

  // Strip sensitive fields before returning the employee profile.
  const { password: _password, refreshTokenVersion: _version, ...profile } =
    employee;

  return {
    token,
    employee: profile,
  };
}

// =============================================================================
// ME — CURRENT USER PROFILE
// =============================================================================

/**
 * Retrieves the authenticated employee's public profile.
 * The employee ID comes from the verified JWT payload (req.user.id).
 */
export async function me(employeeId: string) {
  const employee = await authRepository.findByIdForProfile(employeeId);

  if (!employee) {
    // This should not happen in normal operation since the JWT was valid.
    // Could occur if the employee was hard-deleted after token issuance.
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee profile not found.");
  }

  return employee;
}

// =============================================================================
// CHANGE PASSWORD
// =============================================================================

/**
 * Allows an authenticated employee to change their own password.
 *
 * Security properties:
 * 1. Requires current password verification before accepting the new one.
 * 2. Rejects if newPassword === currentPassword (no-op protection).
 * 3. Increments refreshTokenVersion — all previously issued tokens become
 *    invalid. The employee must log in again on all devices.
 */
export async function changePassword(
  employeeId: string,
  data: ChangePasswordInput
) {
  const employeeRecord = await authRepository.findByIdForAuth(employeeId);

  if (!employeeRecord) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  if (!employeeRecord.isActive) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "Account is deactivated. Please contact your manager."
    );
  }

  const isCurrentPasswordValid = await comparePassword(
    data.currentPassword,
    employeeRecord.password
  );

  if (!isCurrentPasswordValid) {
    throw new AppError(
      HTTP_STATUS.UNAUTHORIZED,
      "Current password is incorrect."
    );
  }

  // Reject no-op: new password must differ from the current password.
  const isSamePassword = await comparePassword(
    data.newPassword,
    employeeRecord.password
  );

  if (isSamePassword) {
    throw new AppError(
      HTTP_STATUS.BAD_REQUEST,
      "New password must be different from your current password."
    );
  }

  const hashedNewPassword = await hashPassword(data.newPassword);

  await authRepository.updatePasswordAndIncrementVersion(
    employeeId,
    hashedNewPassword
  );

  // Incrementing refreshTokenVersion invalidates all previously issued tokens.
  // Drop the cached auth context so the middleware immediately sees the new
  // version and rejects stale tokens on the very next request.
  invalidateAuthContext(employeeId);
}