import type { Request, Response } from "express";
import { HTTP_STATUS } from "../constants/httpStatus";
import { financeService } from "../services/finance.service";
import { createExpenseSchema, queryExpensesSchema, openCashRegisterSchema, closeCashRegisterSchema, createCashTransactionSchema } from "../validation/finance.validation";
import { asyncHandler } from "../utils/asyncHandler";

export const createExpense = asyncHandler(async (req: Request, res: Response) => {
  const payload = createExpenseSchema.parse({ body: req.body }).body;
  const expense = await financeService.createExpense(payload, req.user.id);
  
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Expense recorded successfully",
    data: expense,
  });
});

export const getExpenses = asyncHandler(async (req: Request, res: Response) => {
  const query = queryExpensesSchema.parse({ query: req.query }).query;
  const result = await financeService.getExpenses(query);
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Expenses retrieved successfully",
    ...result,
  });
});

export const getActiveRegister = asyncHandler(async (req: Request, res: Response) => {
  const register = await financeService.getActiveRegister();
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: register ? "Active register found" : "No active register",
    data: register,
  });
});

export const openRegister = asyncHandler(async (req: Request, res: Response) => {
  const payload = openCashRegisterSchema.parse({ body: req.body }).body;
  const register = await financeService.openRegister(payload, req.user.id);
  
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Cash register opened successfully",
    data: register,
  });
});

export const closeRegister = asyncHandler(async (req: Request, res: Response) => {
  const payload = closeCashRegisterSchema.parse({ body: req.body }).body;
  const register = await financeService.closeRegister(payload, req.user.id);
  
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Cash register closed successfully",
    data: register,
  });
});

export const addCashTransaction = asyncHandler(async (req: Request, res: Response) => {
  const payload = createCashTransactionSchema.parse({ body: req.body }).body;
  const txn = await financeService.addCashTransaction(payload, req.user.id);
  
  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: "Cash transaction recorded successfully",
    data: txn,
  });
});
