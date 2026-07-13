// =============================================================================
// EMPLOYEE REPOSITORY
// Handles all database access for the Employee module.
// Isolates Prisma calls from the service layer.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { ListEmployeesQuery } from "../validation/employee.validation";

// =============================================================================
// SELECTED FIELDS
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
  salary: true,
  joiningDate: true,
  dateOfBirth: true,
  isActive: true,
  lastLogin: true,
  createdAt: true,
  updatedAt: true,
} as const;

// =============================================================================
// READ METHODS
// =============================================================================

/**
 * Retrieves a paginated list of employees based on filters.
 * Returns both the list of employees and the total count for pagination metadata.
 */
async function findMany(params: ListEmployeesQuery) {
  const { page, limit, search, role, isActive, sortBy, sortOrder } = params;

  // Build the dynamic WHERE clause
  const where: Prisma.EmployeeWhereInput = {};

  if (role) {
    where.role = role;
  }

  if (isActive !== undefined) {
    where.isActive = isActive;
  }

  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      { email: { contains: search, mode: "insensitive" } },
      { phone: { contains: search } },
      { employeeCode: { contains: search, mode: "insensitive" } },
    ];
  }

  // Calculate skip/take for pagination
  const skip = (page - 1) * limit;

  // Run count and data fetch in parallel
  const [total, data] = await prisma.$transaction([
    prisma.employee.count({ where }),
    prisma.employee.findMany({
      where,
      select: EMPLOYEE_PUBLIC_SELECT,
      skip,
      take: limit,
      orderBy: {
        [sortBy]: sortOrder,
      },
    }),
  ]);

  return { total, data };
}

/**
 * Retrieves a single employee by their ID.
 */
async function findById(id: string) {
  return prisma.employee.findUnique({
    where: { id },
    select: EMPLOYEE_PUBLIC_SELECT,
  });
}

/**
 * Checks if an email or phone number is already registered to ANY employee.
 * Used during creation and updates to prevent unique constraint violations.
 */
async function findByEmailOrPhone(
  email: string | null | undefined,
  phone: string,
  excludeEmployeeId?: string
) {
  const whereConditions: Prisma.EmployeeWhereInput[] = [{ phone }];

  if (email) {
    whereConditions.push({ email });
  }

  const where: Prisma.EmployeeWhereInput = {
    OR: whereConditions,
  };

  // If updating, we don't want to conflict with the user's own current email/phone
  if (excludeEmployeeId) {
    where.NOT = { id: excludeEmployeeId };
  }

  return prisma.employee.findFirst({
    where,
    select: { id: true, email: true, phone: true },
  });
}

/**
 * Retrieves the employee with the highest employeeCode.
 * Used by the service layer to auto-increment the next code.
 */
async function findLatestEmployeeCode() {
  const lastEmployee = await prisma.employee.findFirst({
    orderBy: {
      employeeCode: "desc",
    },
    select: { employeeCode: true },
  });

  return lastEmployee?.employeeCode || null;
}

// =============================================================================
// MUTATION METHODS
// =============================================================================

async function create(
  data: Omit<Prisma.EmployeeCreateInput, "refreshTokenVersion">
) {
  return prisma.employee.create({
    data: {
      ...data,
      refreshTokenVersion: 0,
    },
    select: EMPLOYEE_PUBLIC_SELECT,
  });
}

async function update(id: string, data: Prisma.EmployeeUpdateInput) {
  return prisma.employee.update({
    where: { id },
    data,
    select: EMPLOYEE_PUBLIC_SELECT,
  });
}

// =============================================================================
// EXPORTS
// =============================================================================

export const employeeRepository = {
  findMany,
  findById,
  findByEmailOrPhone,
  findLatestEmployeeCode,
  create,
  update,
} as const;
