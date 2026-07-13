// =============================================================================
// EMPLOYEE CONTROLLER
// Thin HTTP layer. Parses input, invokes service, formats response.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as employeeService from "../services/employee.service";
import { asyncHandler } from "../utils/asyncHandler";
import { employeeValidation } from "../validation/employee.validation";

// =============================================================================
// GET /employees
// =============================================================================
export const list = asyncHandler(async (req: Request, res: Response) => {
  const query = employeeValidation.listQuery.parse(req.query);
  const result = await employeeService.listEmployees(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result.data,
    meta: result.meta,
  });
});

// =============================================================================
// GET /employees/:id
// =============================================================================
export const getById = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const result = await employeeService.getEmployeeById(id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// POST /employees
// =============================================================================
export const create = asyncHandler(async (req: Request, res: Response) => {
  const data = employeeValidation.create.parse(req.body);
  const result = await employeeService.createEmployee(data, req.user);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Employee created successfully.",
    data: result,
  });
});

// =============================================================================
// PATCH /employees/:id
// Handles both partial profile updates and deactivation (isActive).
// =============================================================================
export const update = asyncHandler(async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  const data = employeeValidation.update.parse(req.body);
  const result = await employeeService.updateEmployee(id, data, req.user);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Employee updated successfully.",
    data: result,
  });
});
