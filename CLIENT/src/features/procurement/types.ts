/**
 * Procurement — shared domain types.
 *
 * One module covers Purchases, Suppliers and Brands because they are one
 * workflow: you buy FROM a supplier, the goods carry a brand, and the bill
 * settles against that supplier's balance. Splitting them into three features
 * would mean three copies of the money/status vocabulary they all share.
 *
 * Every monetary field arrives from the API as a NUMBER — the server converts
 * Prisma Decimal and Postgres BIGINT before serialising, because neither
 * survives JSON intact. Do not add `| string` here to paper over a server bug.
 */

// =============================================================================
// SHARED
// =============================================================================

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface PageParams {
  page?: number;
  limit?: number;
  search?: string;
}

/** Lifecycle of the goods themselves. */
export type PurchaseStatus = "DRAFT" | "ORDERED" | "PARTIAL" | "RECEIVED" | "CANCELLED";

/** Lifecycle of the money. Tracked independently of the goods. */
export type SettlementStatus =
  | "UNPAID"
  | "PARTIALLY_PAID"
  | "PAID"
  | "OVERDUE"
  | "CANCELLED";

/**
 * Mirrors the server's `PaymentMethod` enum exactly. There is no BANK_TRANSFER
 * or CHEQUE — offering either would be rejected with a 400 at submit time.
 */
export type PaymentMethod = "CASH" | "UPI" | "CARD" | "CREDIT" | "GIFT_CARD" | "OTHER";

// =============================================================================
// BRANDS
// =============================================================================

export interface BrandStats {
  productCount: number;
  variantCount: number;
  unitsSold: number;
  revenue: number;
  stockUnits: number;
  stockValue: number;
  averageSellingPrice: number;
}

export interface Brand {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats: BrandStats;
}

export interface BrandWriteInput {
  name: string;
  description?: string | undefined;
  logoUrl?: string | undefined;
  isActive?: boolean | undefined;
}

export type BrandSortOption = "name" | "createdAt" | "updatedAt";

export interface BrandListParams extends PageParams {
  isActive?: "true" | "false" | "" | undefined;
  sortBy?: BrandSortOption | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

// =============================================================================
// SUPPLIERS
// =============================================================================

export interface SupplierStats {
  purchaseCount: number;
  totalSpend: number;
  /** Authoritative liability: summed from each bill's own dueAmount. */
  outstanding: number;
  totalPaid: number;
  /** Payments not tied to a specific bill. */
  onAccountCredit: number;
  paymentCount: number;
  lastPurchaseDate: string | null;
  lastPaymentDate: string | null;
  suppliedVariantCount: number;
}

export interface Supplier {
  id: string;
  businessName: string;
  contactPerson: string | null;
  phone: string;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats: SupplierStats;
}

/** A bill as it appears in a supplier's purchase-history tab. */
export interface SupplierPurchaseRow {
  id: string;
  purchaseNumber: string;
  supplierInvoiceNumber: string | null;
  purchaseDate: string;
  status: PurchaseStatus;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: SettlementStatus;
  dueDate: string | null;
  receivedAt: string | null;
  _count: { items: number };
}

export interface SupplierPaymentRow {
  id: string;
  paymentNumber: string;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  paidAt: string;
  purchase: { id: string; purchaseNumber: string } | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
}

export interface SuppliedProductRow {
  id: string;
  sku: string;
  currentStock: number;
  costPrice: number;
  supplierSku: string | null;
  leadTimeDays: number | null;
  product: { id: string; name: string };
  size: { name: string } | null;
  color: { name: string } | null;
}

/** Full profile returned by GET /suppliers/:id. */
export interface SupplierDetail extends Supplier {
  purchases: SupplierPurchaseRow[];
  payments: SupplierPaymentRow[];
  products: SuppliedProductRow[];
}

export interface SupplierWriteInput {
  businessName: string;
  contactPerson?: string | undefined;
  phone: string;
  email?: string | undefined;
  address?: string | undefined;
  notes?: string | undefined;
  isActive?: boolean | undefined;
}

export type SupplierSortOption = "businessName" | "createdAt" | "updatedAt";

export interface SupplierListParams extends PageParams {
  isActive?: "true" | "false" | "" | undefined;
  sortBy?: SupplierSortOption | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

// =============================================================================
// PURCHASES
// =============================================================================

export interface PurchaseItem {
  id: string;
  variantId: string;
  quantity: number;
  receivedQuantity: number;
  costPrice: number;
  sellingPriceAtPurchase: number;
  totalPrice: number;
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    currentStock: number;
    product: { name: string };
    size: { name: string } | null;
    color: { name: string } | null;
  };
}

/** Row shape in the purchase list. Carries just enough to render progress. */
export interface PurchaseRow {
  id: string;
  purchaseNumber: string;
  supplierInvoiceNumber: string | null;
  purchaseDate: string;
  status: PurchaseStatus;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  paidAmount: number;
  dueAmount: number;
  paymentStatus: SettlementStatus;
  dueDate: string | null;
  receivedAt: string | null;
  notes: string | null;
  createdAt: string;
  supplier: { id: string; businessName: string };
  employee: { id: string; firstName: string; lastName: string } | null;
  _count: { items: number };
  items: { quantity: number; receivedQuantity: number }[];
}

/** Server-derived receipt progress — never recomputed on the client. */
export interface ReceiptProgress {
  orderedUnits: number;
  receivedUnits: number;
  outstandingUnits: number;
  isFullyReceived: boolean;
  percentReceived: number;
}

export interface PurchaseDetail extends Omit<PurchaseRow, "items" | "_count"> {
  items: PurchaseItem[];
  payments: SupplierPaymentRow[];
  receipt: ReceiptProgress;
  supplier: { id: string; businessName: string; isActive: boolean };
}

export interface PurchaseLineInput {
  variantId: string;
  quantity: number;
  costPrice: number;
  sellingPriceAtPurchase: number;
}

export interface CreatePurchaseInput {
  supplierId: string;
  supplierInvoiceNumber?: string | undefined;
  notes?: string | undefined;
  discountAmount: number;
  taxAmount: number;
  items: PurchaseLineInput[];
  status: "DRAFT" | "ORDERED";
  dueDate?: string | undefined;
}

export interface UpdatePurchaseInput {
  supplierInvoiceNumber?: string | undefined;
  notes?: string | undefined;
  discountAmount?: number | undefined;
  taxAmount?: number | undefined;
  items?: PurchaseLineInput[] | undefined;
  dueDate?: string | null | undefined;
  status?: "DRAFT" | "ORDERED" | undefined;
}

/**
 * Goods receipt payload.
 *
 * Omit `items` entirely to receive everything still outstanding. Supply it to
 * book specific quantities against specific lines.
 */
export interface ReceivePurchaseInput {
  notes?: string | undefined;
  supplierInvoiceNumber?: string | undefined;
  items?: { itemId: string; quantity: number }[] | undefined;
}

export type PurchaseSortOption =
  | "purchaseDate"
  | "purchaseNumber"
  | "totalAmount"
  | "dueAmount"
  | "status"
  | "createdAt";

export interface PurchaseListParams extends PageParams {
  supplierId?: string | undefined;
  status?: PurchaseStatus | "" | undefined;
  paymentStatus?: SettlementStatus | "" | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
  sortBy?: PurchaseSortOption | undefined;
  sortOrder?: "asc" | "desc" | undefined;
}

/** Payload for POST /finance/supplier-payments. */
export interface RecordPaymentInput {
  supplierId: string;
  /** Omit for an on-account payment against the running balance. */
  purchaseId?: string | undefined;
  amount: number;
  paymentMethod: PaymentMethod;
  referenceNumber?: string | undefined;
  notes?: string | undefined;
  paidAt?: string | undefined;
}

// =============================================================================
// PICKER LOOKUPS
// =============================================================================

/** A product row as returned by the owner catalogue search. */
export interface ProductSearchRow {
  id: string;
  name: string;
  imageUrl: string | null;
  primarySku: string | null;
  variantCount: number;
  totalStock: number;
  brand: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
}

/** A concrete purchasable variant — what a purchase line actually references. */
export interface VariantOption {
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  sizeName: string | null;
  colorName: string | null;
  currentStock: number;
  costPrice: number;
  sellingPrice: number;
  isActive: boolean;
}

// =============================================================================
// FILTER STATE (URL-backed)
// =============================================================================

export interface PurchaseFilterState {
  search: string;
  supplierId: string;
  status: PurchaseStatus | "";
  paymentStatus: SettlementStatus | "";
  dateFrom: string;
  dateTo: string;
  sortBy: PurchaseSortOption;
  sortOrder: "asc" | "desc";
}

export const EMPTY_PURCHASE_FILTERS: PurchaseFilterState = {
  search: "",
  supplierId: "",
  status: "",
  paymentStatus: "",
  dateFrom: "",
  dateTo: "",
  sortBy: "createdAt",
  sortOrder: "desc",
};

export interface CatalogFilterState {
  search: string;
  isActive: "true" | "false" | "";
  sortBy: string;
  sortOrder: "asc" | "desc";
}
