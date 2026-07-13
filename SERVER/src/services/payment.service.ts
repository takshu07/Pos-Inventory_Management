import { Prisma, PaymentMethod, PaymentStatus, SaleStatus } from "../../generated/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";

export interface PaymentInput {
  method: PaymentMethod;
  amount: number | Prisma.Decimal;
  transactionRef?: string | null;
}

export interface PaymentResult {
  totalPaid: Prisma.Decimal;
  dueAmount: Prisma.Decimal;
  saleStatus: SaleStatus;
  paymentStatus: PaymentStatus;
  processedPayments: Array<{
    method: PaymentMethod;
    amount: Prisma.Decimal;
    transactionRef: string | null;
    status: PaymentStatus;
  }>;
}

export class PaymentService {
  /**
   * Pure domain logic for validating payments against the calculated grand total.
   * Completely decoupled from the database layer.
   */
  static processPayments(
    payments: PaymentInput[],
    grandTotalInput: Prisma.Decimal | number
  ): PaymentResult {
    const grandTotal = new Prisma.Decimal(grandTotalInput);
    let totalPaid = new Prisma.Decimal(0);

    const processedPayments = payments.map((payment) => {
      const amount = new Prisma.Decimal(payment.amount);

      if (amount.lte(0)) {
        throw new AppError(
          HTTP_STATUS.BAD_REQUEST,
          "Payment amount must be greater than zero."
        );
      }

      totalPaid = totalPaid.plus(amount);

      return {
        method: payment.method,
        amount,
        transactionRef: payment.transactionRef || null,
        status: PaymentStatus.PAID, // By default, POS payments are considered paid upon entry
      };
    });

    const dueAmount = grandTotal.minus(totalPaid);

    // If cashier accepts more money than due, we assume they are returning change.
    // The sale is fully paid, but the due amount cannot be negative in our ledger.
    const normalizedDueAmount = dueAmount.lt(0) ? new Prisma.Decimal(0) : dueAmount;

    // Determine the overarching Sale Status
    let saleStatus: SaleStatus;
    let paymentStatus: PaymentStatus;

    if (totalPaid.gte(grandTotal)) {
      saleStatus = SaleStatus.COMPLETED;
      paymentStatus = PaymentStatus.PAID;
    } else if (totalPaid.gt(0)) {
      saleStatus = SaleStatus.PARTIAL;
      paymentStatus = PaymentStatus.PARTIALLY_PAID;
    } else {
      saleStatus = SaleStatus.DRAFT;
      paymentStatus = PaymentStatus.UNPAID;
    }

    return {
      totalPaid,
      dueAmount: normalizedDueAmount,
      saleStatus,
      paymentStatus,
      processedPayments,
    };
  }
}
