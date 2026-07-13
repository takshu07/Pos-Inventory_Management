import { prisma } from "../config/prisma";
import { Prisma, RegisterStatus } from "../../generated/prisma";

export const financeRepository = {
  // --- EXPENSES ---
  
  async createExpense(data: Prisma.ExpenseUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    const db = tx || prisma;
    return db.expense.create({ data });
  },

  async getExpenses(params: {
    skip?: number;
    take?: number;
    where?: Prisma.ExpenseWhereInput;
    orderBy?: Prisma.ExpenseOrderByWithRelationInput;
  }) {
    const [items, total] = await Promise.all([
      prisma.expense.findMany({
        ...params,
        include: { category: true, employee: { select: { firstName: true, lastName: true } } }
      }),
      prisma.expense.count({ where: params.where ?? {} })
    ]);
    return { items, total };
  },

  // --- CASH REGISTERS ---

  async getActiveRegister() {
    return prisma.cashRegister.findFirst({
      where: { status: RegisterStatus.OPEN },
      orderBy: { openedAt: "desc" }
    });
  },

  async openRegister(data: Prisma.CashRegisterUncheckedCreateInput) {
    return prisma.cashRegister.create({ data });
  },

  async closeRegister(id: string, data: Prisma.CashRegisterUncheckedUpdateInput) {
    return prisma.cashRegister.update({
      where: { id },
      data: { ...data, status: RegisterStatus.CLOSED, closedAt: new Date() }
    });
  },

  async createCashTransaction(data: Prisma.CashTransactionUncheckedCreateInput, tx?: Prisma.TransactionClient) {
    const db = tx || prisma;
    return db.cashTransaction.create({ data });
  },
  
  async getRegisterSummary(registerId: string) {
    const txns = await prisma.cashTransaction.groupBy({
      by: ["type"],
      where: { registerId },
      _sum: { amount: true }
    });
    return txns;
  },

  // Auto-increment sequence for expense code
  async generateExpenseCode(): Promise<string> {
    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const prefix = `EXP-${dateStr}`;
    const lastExpense = await prisma.expense.findFirst({
      where: { expenseCode: { startsWith: prefix } },
      orderBy: { expenseCode: "desc" }
    });
    
    let nextNum = 1;
    if (lastExpense) {
      const parts = lastExpense.expenseCode.split("-");
      nextNum = parseInt(parts[parts.length - 1] || "0", 10) + 1;
    }
    return `${prefix}-${nextNum.toString().padStart(4, "0")}`;
  }
};
