export enum EventTopic {
  SALE_COMPLETED = "SALE_COMPLETED",
  SALE_CANCELLED = "SALE_CANCELLED",
  INVENTORY_LOW = "INVENTORY_LOW",
  INVENTORY_OUT_OF_STOCK = "INVENTORY_OUT_OF_STOCK",
  EXCHANGE_COMPLETED = "EXCHANGE_COMPLETED",
  CONFIGURATION_UPDATED = "CONFIGURATION_UPDATED",
  EMPLOYEE_CREATED = "EMPLOYEE_CREATED",
  EXPENSE_CREATED = "EXPENSE_CREATED",
  CASH_REGISTER_OPENED = "CASH_REGISTER_OPENED",
  CASH_REGISTER_CLOSED = "CASH_REGISTER_CLOSED",
}

export interface BaseDomainEvent<T = any> {
  eventId: string;
  topic: EventTopic;
  timestamp: Date;
  aggregateId: string;
  aggregateType: string;
  actorId?: string | undefined;
  correlationId?: string | undefined;
  payload: T;
  sourceModule: string;
}

// Payload Definitions
export interface SaleCompletedPayload {
  saleId: string;
  grandTotal: number;
  customerId?: string;
}

export interface InventoryLowPayload {
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  currentStock: number;
  threshold: number;
}

export interface ConfigurationUpdatedPayload {
  keysUpdated: string[];
}

export interface ExpenseCreatedPayload {
  expenseId: string;
  amount: number;
  categoryId: string;
}

export interface CashRegisterOpenedPayload {
  registerId: string;
  openingBalance: number;
}

export interface CashRegisterClosedPayload {
  registerId: string;
  expectedBalance: number;
  actualBalance: number;
  difference: number;
}
