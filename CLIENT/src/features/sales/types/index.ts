export interface SaleCustomer {
  id: string;
  name: string;
  phone: string | null;
}

export interface SaleEmployee {
  id: string;
  firstName: string;
  lastName: string;
}

export interface PaymentEntry {
  method: string;
  amount: number;
  status: string;
}

export interface SaleHistoryRowModel {
  id: string;
  invoiceNumber: string;
  date: string; // ISO String
  customerName: string;
  customerPhone: string;
  cashierName: string;
  totalAmount: number;
  status: string;
  paymentMethods: string[]; // e.g. ["CASH", "UPI"]
}

export interface SaleItemModel {
  id: string;
  productName: string;
  sku: string;
  barcode: string | null;
  sizeName: string;
  colorName: string;
  quantity: number;
  sellingPrice: number;
  taxRate: number;
  taxAmount: number;
  totalPrice: number;
}

export interface InvoiceDetailModel {
  id: string;
  invoiceNumber: string;
  date: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  manualDiscountAmount: number;
  taxAmount: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
  customer: SaleCustomer | null;
  employee: SaleEmployee | null;
  items: SaleItemModel[];
  payments: PaymentEntry[];
}

export interface SalesPaginatedResponse {
  total: number;
  data: SaleHistoryRowModel[];
}

export interface SalesQueryFilters {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  customerId?: string;
  employeeId?: string;
  startDate?: string;
  endDate?: string;
}
