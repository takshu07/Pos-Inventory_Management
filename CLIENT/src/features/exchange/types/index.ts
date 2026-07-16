export interface ExchangeReturnItemDTO {
  variantId: string;
  quantity: number;
}

export interface ExchangeIssuedItemDTO {
  variantId: string;
  quantity: number;
}

export interface ExchangePaymentDTO {
  method: string;
  amount: number;
  transactionRef?: string;
}

export interface CreateExchangePayload {
  originalSaleId: string;
  customerId: string;
  returnedItems: ExchangeReturnItemDTO[];
  issuedItems: ExchangeIssuedItemDTO[];
  payments?: ExchangePaymentDTO[];
  exchangeReason?: string;
  notes?: string;
}

export interface ExchangeModel {
  id: string;
  exchangeNumber: string;
  originalSaleId: string;
  customerId: string;
  employeeId: string;
  exchangeDate: string;
  returnedValue: number;
  issuedValue: number;
  priceDifference: number;
  exchangeReason: string | null;
  notes: string | null;
  status: "PENDING" | "COMPLETED" | "CANCELLED" | "REJECTED";
  customer?: { id: string; name: string; phone: string; };
  createdAt: string;
  updatedAt: string;
}
