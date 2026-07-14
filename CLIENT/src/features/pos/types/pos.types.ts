export interface PosVariant {
  id: string;
  sku: string;
  barcode: string | null;
  sellingPrice: string | number;
  mrp: string | number;
  currentStock: number;
  isActive: boolean;
  product: {
    id: string;
    name: string;
    isActive: boolean;
  };
  size?: { id: string; name: string };
  color?: { id: string; name: string };
}

export interface CartItem {
  cartItemId: string; // Unique ID for cart row (allows same variant with diff discounts in future, though merged by default)
  variant: PosVariant;
  quantity: number;
  unitPrice: number; // The sellingPrice
  lineTotal: number;
}

export type PaymentMethod = "CASH" | "CARD" | "UPI";

export interface PosDiscount {
  type: "PERCENTAGE" | "FIXED";
  value: number;
}

export interface CheckoutPayload {
  customerId?: string;
  manualDiscountAmount?: number;
  manualDiscountReason?: string;
  items: {
    variantId: string;
    quantity: number;
    unitPrice: number;
  }[];
  payments: {
    method: PaymentMethod;
    amount: number;
    transactionRef?: string;
  }[];
}
