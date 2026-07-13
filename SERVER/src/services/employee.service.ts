// =============================================================================
// EMPLOYEE SERVICE
// Business logic for employee management.
// =============================================================================

import { HTTP_STATUS } from "../constants/httpStatus";
import { ROLE_HIERARCHY, type Role } from "../constants/roles";
import { AppError } from "../errors/AppError";
import { employeeRepository } from "../repositories/employee.repository";
import { auditRepository } from "../repositories/audit.repository";
import { logger } from "../config/logger";
import type { AuthenticatedUser } from "../types/employee.types";
import type { PaginatedResponse } from "../types/common.types";
import { hashPassword } from "../utils/hash";
import { stripUndefined } from "../utils/object";
import type {
  CreateEmployeeInput,
  ListEmployeesQuery,
  UpdateEmployeeInput,
} from "../validation/employee.validation";

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Generates the next employee code (e.g., EMP-000002).
 * Grabs the last used code and increments the numeric part.
 */
async function generateNextEmployeeCode(): Promise<string> {
  const lastCode = await employeeRepository.findLatestEmployeeCode();

  if (!lastCode) {
    return "EMP-000001";
  }

  // Expecting format "EMP-XXXXXX"
  const parts = lastCode.split("-");
  if (parts.length !== 2) {
    // Fallback if somehow a malformed code was entered manually
    return `EMP-${Date.now().toString().slice(-6)}`;
  }

  const numericPart = parseInt(parts[1]!, 10);
  const nextNumeric = numericPart + 1;

  return `EMP-${nextNumeric.toString().padStart(6, "0")}`;
}

/**
 * Checks if the executor has sufficient privileges to modify the target employee.
 * A user can modify themselves, or anyone lower in the hierarchy.
 */
function enforceHierarchy(executor: AuthenticatedUser, targetRole: Role, targetId: string) {
  if (executor.id === targetId) return; // Can modify self

  const executorLevel = ROLE_HIERARCHY[executor.role];
  const targetLevel = ROLE_HIERARCHY[targetRole];

  if (executorLevel <= targetLevel) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      `You do not have permission to modify a ${targetRole}.`
    );
  }
}


// =============================================================================
// SERVICE METHODS
// =============================================================================

export async function listEmployees(query: ListEmployeesQuery) {
  const { data, total } = await employeeRepository.findMany(query);

  const totalPages = Math.ceil(total / query.limit);

  const response: PaginatedResponse<(typeof data)[0]> = {
    data,
    meta: {
      total,
      page: query.page,
      limit: query.limit,
      totalPages,
      hasNextPage: query.page < totalPages,
      hasPreviousPage: query.page > 1,
    },
  };

  return response;
}

export async function getEmployeeById(id: string) {
  const employee = await employeeRepository.findById(id);

  if (!employee) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  return employee;
}

export async function createEmployee(
  data: CreateEmployeeInput,
  executor: AuthenticatedUser
) {
  // Only OWNER can create managers. MANAGER can only create cashiers.
  enforceHierarchy(executor, data.role, "");

  // Check unique constraints (email and phone)
  const existing = await employeeRepository.findByEmailOrPhone(
    data.email,
    data.phone
  );

  if (existing) {
    const conflictField = existing.email === data.email ? "email address" : "phone number";
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `An employee with this ${conflictField} already exists.`
    );
  }

  const employeeCode = await generateNextEmployeeCode();
  const hashedPassword = await hashPassword(data.password);

  const newEmployee = await employeeRepository.create({
    employeeCode,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email || null,
    phone: data.phone,
    password: hashedPassword,
    role: data.role,
    gender: data.gender ?? null,
    address: data.address ?? null,
    salary: data.salary ?? null,
    joiningDate: data.joiningDate || new Date(),
    dateOfBirth: data.dateOfBirth ?? null,
  });

  // Fire-and-forget: record creation in audit log
  auditRepository.create({
    performedBy: executor.id,
    action: "CREATE",
    module: "EMPLOYEE",
    tableName: "employees",
    recordId: newEmployee.id,
    newData: newEmployee as unknown as Record<string, unknown>,
  });

  logger.info(
    { createdBy: executor.id, newEmployeeId: newEmployee.id, role: newEmployee.role },
    "Employee created"
  );

  return newEmployee;
}

export async function updateEmployee(
  id: string,
  data: UpdateEmployeeInput,
  executor: AuthenticatedUser
) {
  const targetEmployee = await employeeRepository.findById(id);

  if (!targetEmployee) {
    throw new AppError(HTTP_STATUS.NOT_FOUND, "Employee not found.");
  }

  // Ensure executor isn't trying to update an OWNER unless they are that OWNER
  enforceHierarchy(executor, targetEmployee.role, targetEmployee.id);

  // -------------------------------------------------------------------------
  // OWNER DEACTIVATION GUARD
  // An OWNER cannot be deactivated via this endpoint — this would lock the
  // entire system. The only way to transfer ownership is a dedicated process.
  // -------------------------------------------------------------------------
  if (targetEmployee.role === "OWNER" && data.isActive === false) {
    throw new AppError(
      HTTP_STATUS.FORBIDDEN,
      "The owner account cannot be deactivated. Transfer ownership before deactivating."
    );
  }

  // If role is being changed, ensure executor has permission to assign the new role
  if (data.role && data.role !== targetEmployee.role) {
    enforceHierarchy(executor, data.role, targetEmployee.id);
  }

  // Check unique constraints if email or phone is being updated
  if (data.email || data.phone) {
    const emailToCheck = data.email !== undefined ? data.email : targetEmployee.email;
    const phoneToCheck = data.phone !== undefined ? data.phone : targetEmployee.phone;

    const existing = await employeeRepository.findByEmailOrPhone(
      emailToCheck,
      phoneToCheck,
      id
    );

    if (existing) {
      const conflictField = existing.email === emailToCheck ? "email address" : "phone number";
      throw new AppError(
        HTTP_STATUS.CONFLICT,
        `Another employee with this ${conflictField} already exists.`
      );
    }
  }

  const updateData: any = stripUndefined(data);
  if (data.email === "") {
    updateData.email = null;
  }

  const updatedEmployee = await employeeRepository.update(id, updateData);

  // Fire-and-forget: record the change in the audit log
  auditRepository.create({
    performedBy: executor.id,
    action: "UPDATE",
    module: "EMPLOYEE",
    tableName: "employees",
    recordId: id,
    oldData: targetEmployee as unknown as Record<string, unknown>,
    newData: updatedEmployee as unknown as Record<string, unknown>,
  });

  logger.info(
    { updatedBy: executor.id, targetId: id },
    "Employee updated"
  );

  return updatedEmployee;
}
