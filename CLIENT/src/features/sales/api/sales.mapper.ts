import {
  ExchangeLineModel,
  ExchangeSummaryModel,
  InvoiceDetailModel,
  SaleHistoryRowModel,
} from "../types";

/** Flattens a raw exchange return/issued item into a display line. */
function mapExchangeLine(rawItem: any): ExchangeLineModel {
  const variant = rawItem.variant || {};
  return {
    id: rawItem.id,
    productName: variant.product?.name ?? "Unknown product",
    sku: variant.sku ?? "",
    sizeName: variant.size?.name ?? "",
    colorName: variant.color?.name ?? "",
    quantity: rawItem.quantity,
    totalValue: Number(rawItem.totalValue ?? 0),
  };
}

/** Maps a raw exchange (list or detail shape) into the UI summary model. */
export function mapExchangeSummary(rawExchange: any): ExchangeSummaryModel {
  return {
    id: rawExchange.id,
    exchangeNumber: rawExchange.exchangeNumber ?? "",
    date: rawExchange.exchangeDate ?? rawExchange.createdAt ?? "",
    status: rawExchange.status ?? "",
    returnedValue: Number(rawExchange.returnedValue ?? 0),
    issuedValue: Number(rawExchange.issuedValue ?? 0),
    priceDifference: Number(rawExchange.priceDifference ?? 0),
    returnedItems: (rawExchange.returnedItems || []).map(mapExchangeLine),
    issuedItems: (rawExchange.issuedItems || []).map(mapExchangeLine),
  };
}

/**
 * Maps the raw backend paginated list item into the UI model.
 * Extracts unique payment methods and flattens nested relations for the table.
 */
export function mapToSaleHistoryRow(rawSale: any): SaleHistoryRowModel {
  const paymentMethods = rawSale.payments 
    ? Array.from(new Set(rawSale.payments.map((p: any) => p.method)))
    : [];

  return {
    id: rawSale.id,
    invoiceNumber: rawSale.saleNumber,
    date: rawSale.saleDate,
    customerName: rawSale.customer?.isWalkIn ? "Walk-In Customer" : (rawSale.customer?.name || "Walk-In Customer"),
    customerPhone: rawSale.customer?.isWalkIn ? "" : (rawSale.customer?.phone || ""),
    cashierName: rawSale.employee ? `${rawSale.employee.firstName} ${rawSale.employee.lastName}` : "Unknown",
    totalAmount: Number(rawSale.grandTotal),
    status: rawSale.status,
    paymentMethods: paymentMethods as string[],
    createdAt: rawSale.createdAt,
    items: rawSale.items || [],
    exchanges: (rawSale.exchanges || []).map(mapExchangeSummary),
  };
}

/**
 * Maps the raw deep invoice response into the structured detail model.
 */
export function mapToInvoiceDetail(rawSale: any): InvoiceDetailModel {
  return {
    id: rawSale.id,
    invoiceNumber: rawSale.saleNumber,
    date: rawSale.saleDate,
    status: rawSale.status,
    subtotal: Number(rawSale.subtotal),
    discountAmount: Number(rawSale.discountAmount),
    manualDiscountAmount: Number(rawSale.manualDiscountAmount),
    taxAmount: Number(rawSale.taxAmount),
    grandTotal: Number(rawSale.grandTotal),
    paidAmount: Number(rawSale.paidAmount),
    dueAmount: Number(rawSale.dueAmount),
    customer: rawSale.customer || null,
    employee: rawSale.employee || null,
    items: (rawSale.items || []).map((item: any) => ({
      id: item.id,
      productName: item.productName,
      sku: item.sku,
      barcode: item.barcode,
      sizeName: item.sizeName,
      colorName: item.colorName,
      quantity: item.quantity,
      sellingPrice: Number(item.sellingPrice),
      taxRate: Number(item.taxRate),
      taxAmount: Number(item.taxAmount),
      totalPrice: Number(item.totalPrice),
    })),
    payments: (rawSale.payments || []).map((payment: any) => ({
      method: payment.method,
      amount: Number(payment.amount),
      status: payment.status,
    })),
    exchanges: (rawSale.exchanges || []).map(mapExchangeSummary),
  };
}
