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
import * as workforceService from "./workforce.service";

/**
 * Request context captured at the HTTP boundary and threaded through so the
 * Workforce module can record a real session row (device, browser, IP).
 *
 * Optional on purpose: auth must keep working — and keep being testable —
 * whether or not a caller supplies it. Session tracking is observability, and
 * observability must never be able to fail a login.
 */
export interface RequestContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

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
export async function login(data: LoginInput, context: RequestContext = {}) {
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
    // No employeeId to attribute the attempt to, so nothing is recorded here.
    // A failed attempt against a non-existent account is a rate-limiter
    // concern (authLimiter already covers it), not a workforce one.
    throw invalidCredentialsError;
  }

  if (!employee.isActive) {
    recordLoginAttempt(employee.id, context, false, "INACTIVE_ACCOUNT");
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
    // A wrong password against a REAL account is exactly what the security
    // view needs to surface, so this attempt is recorded.
    recordLoginAttempt(employee.id, context, false, "INVALID_CREDENTIALS");
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

  // Open a session row. Any previously-open session is closed first: a stale
  // open row would keep the employee reading as "online" forever, since
  // presence is derived from open sessions.
  workforceService
    .recordLogout(employee.id, "EXPIRED")
    .then(() =>
      workforceService.recordLogin({
        employeeId: employee.id,
        ipAddress: context.ipAddress ?? null,
        userAgent: context.userAgent ?? null,
        isSuccessful: true,
      })
    )
    .catch((err: unknown) => {
      logger.error({ err }, "[AuthService] Failed to record login session");
    });

  // Strip sensitive fields before returning the employee profile.
  const { password: _password, refreshTokenVersion: _version, ...profile } =
    employee;

  return {
    token,
    employee: profile,
  };
}

/** Fire-and-forget failed-attempt recorder. Never blocks or fails the response. */
function recordLoginAttempt(
  employeeId: string,
  context: RequestContext,
  isSuccessful: boolean,
  failureReason?: string
) {
  workforceService
    .recordLogin({
      employeeId,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      isSuccessful,
      failureReason: failureReason ?? null,
    })
    .catch((err: unknown) => {
      logger.error({ err }, "[AuthService] Failed to record login attempt");
    });
}

// =============================================================================
// LOGOUT
// =============================================================================

/**
 * Ends the employee's session.
 *
 * The JWT itself is stateless and cannot be revoked without bumping
 * refreshTokenVersion — which we deliberately do NOT do here, because a normal
 * logout should not sign the user out of their other devices. What this does is
 * close the session row, which is what presence and the Login History tab read.
 * Forced sign-out of every device is a separate operation (password reset /
 * deactivation), and that one does bump the version.
 */
export async function logout(employeeId: string) {
  await workforceService.recordLogout(employeeId, "MANUAL");

  auditRepository.create({
    performedBy: employeeId,
    action: "LOGOUT",
    module: "AUTH",
    tableName: "employees",
    recordId: employeeId,
  });
}

// =============================================================================
// ME — CURRENT USER PROFILE
// =============================================================================

/**
 * Retrieves the authenticated employee's public profile.
 * The employee ID comes from the verified JWT payload (req.user.id).
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TODO(self-service): ADDITIVE `PATCH /auth/me` FOR SELF-SERVICE PROFILE EDITS
 * ───────────────────────────────────────────────────────────────────────────
 * Reading your own profile is self-service; UPDATING it is not. The only way
 * to change a name, email or address today is `PATCH /employees/:id`, which is
 * `requireRole("OWNER")` — so a manager or cashier who moves house has to ask
 * the owner to edit the record for them.
 *
 * This is why CLIENT/src/features/profile renders the details as read-only
 * facts rather than as a form. Rendering inputs that 403 for two of the three
 * roles would be worse than not offering them.
 *
 * THE CONSTRAINT THAT DEFINES THIS ENDPOINT: it must never become a way to
 * escalate privilege. `PATCH /employees/:id` is OWNER-only precisely because
 * it can write `role`, `isActive` and `salary`. A self-service endpoint that
 * reused that input schema would hand every cashier the ability to promote
 * themselves. So this is a NEW, DELIBERATELY NARROW endpoint — not a relaxation
 * of the guard on the existing one, and not a shared schema with an `omit()`
 * applied at the edge (an omit is one careless edit away from being reverted).
 *
 * The intended implementation:
 *
 *   1. A SEPARATE zod schema in auth.validation — `updateMeSchema` — listing
 *      the permitted fields POSITIVELY, never by subtracting from the employee
 *      schema:
 *          firstName, lastName, email, gender, address, dateOfBirth
 *      NOT role. NOT isActive. NOT salary. NOT phone. NOT employeeCode.
 *      • phone is excluded because it is a SIGN-IN IDENTIFIER: letting someone
 *        move their own login to a new number is an account-takeover primitive
 *        and needs the owner in the loop. Same reasoning applies to email the
 *        moment email login is used as a recovery channel — revisit then.
 *      • employeeCode is immutable everywhere; it is referenced by history.
 *   2. `export async function updateMe(employeeId, input)` here, writing ONLY
 *      via that schema's output and reusing the existing email/phone
 *      uniqueness check so a self-edit cannot collide with another account.
 *   3. `PATCH /auth/me` in auth.routes.ts behind `authenticate` — no
 *      `requireRole`, since every authenticated role may edit their own record
 *      and the employeeId comes from the verified JWT, never from the body or
 *      the URL. There is no id to tamper with, which is what makes this safe
 *      without a hierarchy check.
 *   4. Write an `auditRepository.create` row with action "UPDATE", module
 *      "EMPLOYEE", performedBy = the employee themselves — a self-edit must be
 *      as traceable as an owner's edit.
 *   5. No `invalidateAuthContext` and no session revocation: none of the
 *      permitted fields appear in the JWT or affect authorisation. If that ever
 *      stops being true, the field does not belong in this schema.
 *   6. Client: turn the read-only cards in features/profile into a form, keep
 *      the role/status rows read-only, and drop the "ask the owner" line.
 *
 * Not urgent — staff details change rarely and the owner can already do it.
 * The value is removing a needless owner interruption, not unblocking anyone.
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

  // Every device was just signed out, so the open session rows are no longer
  // real. Closing them keeps presence honest — otherwise the employee would
  // still read as "online" on a session that can no longer make a request.
  workforceService.recordLogout(employeeId, "FORCED").catch((err: unknown) => {
    logger.error({ err }, "[AuthService] Failed to close sessions after password change");
  });

  auditRepository.create({
    performedBy: employeeId,
    action: "PASSWORD_RESET",
    module: "AUTH",
    tableName: "employees",
    recordId: employeeId,
  });
}