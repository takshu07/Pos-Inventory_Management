import { financeRepository } from "../repositories/finance.repository";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { auditRepository } from "../repositories/audit.repository";
import { ActionModule, ActionType, CashTransactionType, PaymentMethod, ReferenceType } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import type { z } from "zod";
import type { createExpenseSchema, queryExpensesSchema, openCashRegisterSchema, closeCashRegisterSchema, createCashTransactionSchema } from "../validation/finance.validation";
import { EventBus } from "../events/eventBus";
import { EventTopic } from "../events/domainEvents";
import type { ExpenseCreatedPayload, CashRegisterOpenedPayload, CashRegisterClosedPayload } from "../events/domainEvents";
import { logger } from "../config/logger";

export const financeService = {
  // ============================================================================
  // EXPENSES
  // ============================================================================

  async createExpense(payload: z.infer<typeof createExpenseSchema>["body"], employeeId: string) {
    const expenseCode = await financeRepository.generateExpenseCode();
    
    const expense = await prisma.$transaction(async (tx) => {
      // 1. Create the expense
      const created = await financeRepository.createExpense({
        ...payload,
        vendorName: payload.vendorName ?? null,
        referenceNumber: payload.referenceNumber ?? null,
        description: payload.description ?? null,
        notes: payload.notes ?? null,
        expenseDate: payload.expenseDate ? new Date(payload.expenseDate) : new Date(),
        expenseCode,
        employeeId,
      }, tx);

      // 2. If it's paid in CASH, and a register is open, deduct it from the till.
      if (payload.paymentMethod === PaymentMethod.CASH) {
        const activeRegister = await financeRepository.getActiveRegister();
        if (activeRegister) {
          await financeRepository.createCashTransaction({
            registerId: activeRegister.id,
            type: CashTransactionType.CASH_OUT,
            amount: payload.amount,
            reason: `Business Expense: ${payload.title} (${expenseCode})`,
            referenceId: created.id,
            referenceType: ReferenceType.EXPENSE,
            employeeId,
          }, tx);
        }
      }

      return created;
    });

    // 3. Fire-and-forget audit
    auditRepository.create({
      action: ActionType.CREATE,
      module: ActionModule.EXPENSE,
      performedBy: employeeId,
      tableName: "expenses",
      recordId: expense.id,
      newData: expense as any
    });

    // 4. Publish Domain Event
    EventBus.publish(
      EventBus.createEvent<ExpenseCreatedPayload>(
        EventTopic.EXPENSE_CREATED,
        expense.id,
        "expenses",
        {
          expenseId: expense.id,
          amount: Number(expense.amount),
          categoryId: expense.categoryId,
        },
        employeeId,
        "FinanceService"
      )
    ).catch(err => logger.error({ err }, "Failed to publish EXPENSE_CREATED"));

    return expense;
  },

  async getExpenses(query: z.infer<typeof queryExpensesSchema>["query"]) {
    const skip = (query.page - 1) * query.limit;
    
    const where: any = {};
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.startDate || query.endDate) {
      where.expenseDate = {};
      if (query.startDate) where.expenseDate.gte = new Date(query.startDate);
      if (query.endDate) where.expenseDate.lte = new Date(query.endDate);
    }
    
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: "insensitive" } },
        { expenseCode: { contains: query.search, mode: "insensitive" } },
        { vendorName: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const { items, total } = await financeRepository.getExpenses({
      skip,
      take: query.limit,
      where,
      orderBy: query.sortBy ? { [query.sortBy as string]: query.sortOrder || "desc" } : { createdAt: "desc" }
    });

    return {
      data: items,
      meta: { total, page: query.page, limit: query.limit, totalPages: Math.ceil(total / query.limit) }
    };
  },

  // ============================================================================
  // CASH REGISTER
  // ============================================================================

  async getActiveRegister() {
    return financeRepository.getActiveRegister();
  },

  async openRegister(payload: z.infer<typeof openCashRegisterSchema>["body"], employeeId: string) {
    const active = await financeRepository.getActiveRegister();
    if (active) throw new AppError(HTTP_STATUS.BAD_REQUEST, "A cash register is already open.");

    const register = await financeRepository.openRegister({
      openingBalance: payload.openingBalance,
      openedById: employeeId,
      notes: payload.notes ?? null
    });

    auditRepository.create({
      action: ActionType.CREATE,
      module: ActionModule.SETTINGS, // Using SETTINGS or a new module
      performedBy: employeeId,
      tableName: "cash_registers",
      recordId: register.id,
      newData: register as any
    });

    EventBus.publish(
      EventBus.createEvent<CashRegisterOpenedPayload>(
        EventTopic.CASH_REGISTER_OPENED,
        register.id,
        "cash_registers",
        {
          registerId: register.id,
          openingBalance: Number(register.openingBalance),
        },
        employeeId,
        "FinanceService"
      )
    ).catch(err => logger.error({ err }, "Failed to publish CASH_REGISTER_OPENED"));

    return register;
  },

  async closeRegister(payload: z.infer<typeof closeCashRegisterSchema>["body"], employeeId: string) {
    const active = await financeRepository.getActiveRegister();
    if (!active) throw new AppError(HTTP_STATUS.BAD_REQUEST, "No cash register is currently open.");

    // Calculate expected balance
    const summary = await financeRepository.getRegisterSummary(active.id);
    let totalIn = 0;
    let totalOut = 0;
    for (const row of summary) {
      if (row.type === CashTransactionType.CASH_IN) totalIn += Number(row._sum.amount);
      if (row.type === CashTransactionType.CASH_OUT) totalOut += Number(row._sum.amount);
    }

    const expectedBalance = Number(active.openingBalance) + totalIn - totalOut;
    const difference = payload.actualBalance - expectedBalance;

    const register = await financeRepository.closeRegister(active.id, {
      expectedBalance,
      closingBalance: payload.actualBalance,
      difference,
      closedById: employeeId,
      notes: payload.notes ?? null
    });

    auditRepository.create({
      action: ActionType.UPDATE,
      module: ActionModule.SETTINGS,
      performedBy: employeeId,
      tableName: "cash_registers",
      recordId: register.id,
      newData: register as any
    });

    EventBus.publish(
      EventBus.createEvent<CashRegisterClosedPayload>(
        EventTopic.CASH_REGISTER_CLOSED,
        register.id,
        "cash_registers",
        {
          registerId: register.id,
          expectedBalance: Number(expectedBalance),
          actualBalance: Number(register.closingBalance),
          difference: Number(register.difference),
        },
        employeeId,
        "FinanceService"
      )
    ).catch(err => logger.error({ err }, "Failed to publish CASH_REGISTER_CLOSED"));

    return register;
  },

  async addCashTransaction(payload: z.infer<typeof createCashTransactionSchema>["body"], employeeId: string) {
    const active = await financeRepository.getActiveRegister();
    if (!active) throw new AppError(HTTP_STATUS.BAD_REQUEST, "No cash register is open. Cannot perform cash transaction.");

    const txn = await financeRepository.createCashTransaction({
      registerId: active.id,
      type: payload.type,
      amount: payload.amount,
      reason: payload.reason,
      employeeId
    });

    return txn;
  }
};
