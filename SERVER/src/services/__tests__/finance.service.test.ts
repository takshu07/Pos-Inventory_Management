import { describe, it, expect, beforeEach } from "vitest";
import { financeService } from "../finance.service";
import { EmployeeFactory } from "../../__tests__/factories/employee.factory";
import { prisma } from "../../config/prisma";
import { CashTransactionType, PaymentMethod } from "../../../generated/prisma";
import { cleanDatabase } from "../../__tests__/utils/db";

describe("FinanceService Integration", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  it("should open a cash register and log it to audits", async () => {
    const manager = await EmployeeFactory.createManager();

    const register = await financeService.openRegister(
      { openingBalance: 5000, notes: "Morning Shift" },
      manager.id
    );

    expect(register.id).toBeDefined();
    expect(Number(register!.openingBalance)).toBe(5000);
    expect(register!.openedById).toBe(manager.id);

    // Verify Audit Log
    const logs = await prisma.auditLog.findMany({ where: { recordId: register!.id } });
    expect(logs.length).toBe(1);
    expect(logs[0]!.action).toBe("CREATE");
  });

  it("should automatically deduct cash from active register when a CASH expense is created", async () => {
    const manager = await EmployeeFactory.createManager();

    // Setup Category
    const category = await prisma.expenseCategory.create({ data: { name: "Snacks" } });

    // Open Register
    const register = await financeService.openRegister(
      { openingBalance: 5000 },
      manager.id
    );

    // Record Cash Expense
    const expense = await financeService.createExpense({
      categoryId: category.id,
      title: "Tea for staff",
      amount: 150,
      paymentMethod: PaymentMethod.CASH,
    }, manager.id);

    // Verify Expense created
    expect(expense.id).toBeDefined();

    // Verify Cash Transaction was automatically inserted
    const txns = await prisma.cashTransaction.findMany({ where: { registerId: register.id } });
    expect(txns.length).toBe(1);
    expect(txns[0]!.type).toBe(CashTransactionType.CASH_OUT);
    expect(Number(txns[0]!.amount)).toBe(150);
    expect(txns[0]!.referenceId).toBe(expense.id);
  });
});
