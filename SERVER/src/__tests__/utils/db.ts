import { prisma } from "../../config/prisma";

/**
 * Erases all data from transactional tables.
 * The order is critical to respect foreign key constraints.
 * We delete leaf tables first, then branches, then roots.
 */
export async function cleanDatabase() {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(),
    prisma.employeeAction.deleteMany(),
    prisma.loginHistory.deleteMany(),
    prisma.saleItem.deleteMany(),
    prisma.payment.deleteMany(),
    prisma.invoice.deleteMany(),
    prisma.exchangeReturnItem.deleteMany(),
    prisma.exchangeIssuedItem.deleteMany(),
    prisma.exchange.deleteMany(),
    prisma.inventoryMovement.deleteMany(),
    prisma.purchaseItem.deleteMany(),
    prisma.purchase.deleteMany(),
    prisma.sale.deleteMany(),
    prisma.coupon.deleteMany(),
    prisma.discount.deleteMany(),
    prisma.cashTransaction.deleteMany(),
    prisma.cashRegister.deleteMany(),
    prisma.expense.deleteMany(),
    prisma.expenseCategory.deleteMany(),
    prisma.productVariant.deleteMany(),
    prisma.product.deleteMany(),
    prisma.category.deleteMany(),
    prisma.brand.deleteMany(),
    prisma.supplier.deleteMany(),
    prisma.customerAddress.deleteMany(),
    prisma.customer.deleteMany(),
    prisma.asset.deleteMany(),
    prisma.notification.deleteMany(),
    // We intentionally leave Configuration settings untouched.
    // If you need employees completely wiped:
    prisma.employee.deleteMany(),
    prisma.color.deleteMany(),
    prisma.size.deleteMany(),
  ]);
}
