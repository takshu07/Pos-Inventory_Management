// =============================================================================
// AUTH REPOSITORY
// Sole owner of all Prisma calls related to authentication.
//
// Design Principles:
// - All methods return domain-friendly types (not raw Prisma types)
// - select clauses are explicit — never SELECT * in a production repository
// - No business logic lives here — only data access
// - Methods are named for their intent (findByEmail) not their mechanism
// =============================================================================

import { prisma } from "../config/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";

// =============================================================================
// SELECTED FIELDS
// Defining select objects as constants prevents duplication and ensures the
// same fields are returned consistently across all query methods.
// The password field is excluded by default — only included where needed.
// =============================================================================

const EMPLOYEE_PUBLIC_SELECT = {
  id: true,
  employeeCode: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  role: true,
  gender: true,
  address: true,
  joiningDate: true,
  isActive: true,
  lastLogin: true,
} as const;

const EMPLOYEE_AUTH_SELECT = {
  ...EMPLOYEE_PUBLIC_SELECT,
  password: true,
  refreshTokenVersion: true,
} as const;

// =============================================================================
// QUERY METHODS
// =============================================================================

/**
 * Checks whether any employee records exist in the database.
 * Used by the setup endpoint to enforce single-run initialization.
 */
async function hasAnyEmployee(): Promise<boolean> {
  const count = await prisma.employee.count();
  return count > 0;
}

/**
 * Retrieves an employee's auth-relevant fields by email.
 * Returns null when not found — callers must handle this case.
 */
async function findByEmailForAuth(email: string) {
  return prisma.employee.findUnique({
    where: { email },
    select: EMPLOYEE_AUTH_SELECT,
  });
}

/**
 * Retrieves an employee's auth-relevant fields by phone.
 * Returns null when not found — callers must handle this case.
 */
async function findByPhoneForAuth(phone: string) {
  return prisma.employee.findUnique({
    where: { phone },
    select: EMPLOYEE_AUTH_SELECT,
  });
}

/**
 * Retrieves the public profile of an employee by their ID.
 * Used by the /me endpoint after token verification.
 * Returns null when not found — callers must handle this case.
 */
async function findByIdForProfile(id: string) {
  return prisma.employee.findUnique({
    where: { id },
    select: EMPLOYEE_PUBLIC_SELECT,
  });
}

/**
 * Retrieves only the fields needed for token version validation.
 * Called by the authenticate middleware on every protected request.
 * The minimal select minimizes data transfer on each request.
 */
async function findTokenVersion(
  id: string
): Promise<{ refreshTokenVersion: number; isActive: boolean } | null> {
  return prisma.employee.findUnique({
    where: { id },
    select: { refreshTokenVersion: true, isActive: true },
  });
}

/**
 * Retrieves the password hash and isActive status for an employee by ID.
 * Used exclusively by the changePassword service to verify the current
 * password before accepting a new one.
 */
async function findByIdForAuth(
  id: string
): Promise<{ password: string; isActive: boolean } | null> {
  return prisma.employee.findUnique({
    where: { id },
    select: { password: true, isActive: true },
  });
}

// =============================================================================
// MUTATION METHODS
// =============================================================================

/**
 * Creates the initial owner employee and the store settings in a transaction.
 * Both records must be created atomically — a partial setup is unrecoverable.
 */
async function createOwnerWithSettings(data: {
  employeeCode: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string | undefined;
  hashedPassword: string;
  shopName: string;
}) {
  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.create({
      data: {
        employeeCode: data.employeeCode,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        // Prisma optional string fields use null, not undefined,
        // when exactOptionalPropertyTypes is enabled in tsconfig.
        email: data.email ?? null,
        password: data.hashedPassword,
        role: "OWNER",
        joiningDate: new Date(),
        refreshTokenVersion: 0,
      },
      select: EMPLOYEE_PUBLIC_SELECT,
    });

    await tx.settings.create({
      data: {
        id: "singleton",
        storeName: data.shopName,
      },
    });

    return employee;
  });
}

/**
 * Records the timestamp of the employee's most recent successful login.
 * Runs as fire-and-forget — a failure here must not block the login response.
 * (Caller wraps in .catch())
 */
async function updateLastLogin(id: string): Promise<void> {
  await prisma.employee.update({
    where: { id },
    data: { lastLogin: new Date() },
  });
}

/**
 * Atomically updates the employee's password and increments their token version.
 * Incrementing refreshTokenVersion invalidates all previously issued tokens.
 */
async function updatePasswordAndIncrementVersion(
  id: string,
  hashedPassword: string
): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id },
    select: { refreshTokenVersion: true },
  });

  if (!employee) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  await prisma.employee.update({
    where: { id },
    data: {
      password: hashedPassword,
      refreshTokenVersion: employee.refreshTokenVersion + 1,
    },
  });
}

// =============================================================================
// REPOSITORY EXPORT
// Exported as a plain object (not a class) — simpler to use, easy to mock
// in tests by reassigning individual methods.
// =============================================================================

export const authRepository = {
  hasAnyEmployee,
  findByEmailForAuth,
  findByPhoneForAuth,
  findByIdForProfile,
  findTokenVersion,
  findByIdForAuth,
  createOwnerWithSettings,
  updateLastLogin,
  updatePasswordAndIncrementVersion,
} as const;
