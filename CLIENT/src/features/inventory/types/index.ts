/**
 * Inventory Management — domain types.
 *
 * These mirror the server's response shapes exactly. Hand-written rather than
 * generated because the client is a separate package; keeping them in one file
 * means a server contract change surfaces as a compile error in one place
 * instead of silently as `any` scattered through components.
 *
 * THE PATTERN TO NOTICE: cost-bearing fields (`costPrice`, `stockValue`,
 * `potentialProfit`, `marginPercentage`, `estimatedCost`) are OPTIONAL on every
 * type. The server omits them entirely for non-owners rather than nulling them,
 * so `costPrice?: number` is the honest shape — a manager's payload does not
 * carry the key at all.
 */

// =============================================================================
// ENUMS (mirror the Prisma enums and the inventory engine)
// =============================================================================

export type MovementType =
  | "PURCHASE"
  | "SALE"
  | "EXCHANGE_IN"
  | "EXCHANGE_OUT"
  | "SUPPLIER_RETURN"
  | "MANUAL_ADJUSTMENT"
  | "DAMAGED"
  | "LOST"
  | "OPENING_STOCK";

export type StockStatus =
  | "IN_STOCK"
  | "LOW_STOCK"
  | "OUT_OF_STOCK"
  | "NEGATIVE"
  | "OVERSTOCKED";

export type StockVelocity = "FAST_MOVING" | "NORMAL" | "SLOW_MOVING" | "DEAD_STOCK";

export type ReservationType = "EXCHANGE" | "CUSTOMER_HOLD" | "ORDER" | "OTHER";
export type ReservationStatus = "ACTIVE" | "FULFILLED" | "RELEASED" | "EXPIRED";

export type AdjustmentReason =
  | "DAMAGE"
  | "LOST"
  | "THEFT"
  | "MISCOUNT"
  | "SUPPLIER_ERROR"
  | "SYSTEM_CORRECTION"
  | "EXPIRED"
  | "OTHER";

export type AdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED";

export type CycleCountStatus = "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export type InventoryPeriod = "today" | "week" | "month" | "quarter" | "year" | "custom";

/** The filter set the Stock Overview offers. */
export type StockStatusFilter =
  | "ALL"
  | StockStatus
  | "FAST_MOVING"
  | "SLOW_MOVING"
  | "DEAD_STOCK"
  | "RESERVED"
  | "DAMAGED";

// =============================================================================
// STOCK OVERVIEW
// =============================================================================

export interface StockRow {
  id: string;
  sku: string;
  barcode: string | null;

  productId: string;
  productName: string;
  imageUrl: string | null;
  variantName: string;
  sizeName: string | null;
  colorName: string | null;

  categoryId: string | null;
  categoryName: string | null;
  brandId: string | null;
  brandName: string | null;
  supplierId: string | null;
  supplierName: string | null;

  /** Physical stock — what a person counting the shelf would find. */
  currentStock: number;
  /** Sum of active holds. */
  reserved: number;
  /** currentStock − reserved. What the POS may actually sell. */
  available: number;
  reorderLevel: number | null;
  status: StockStatus;
  velocity: StockVelocity;

  /** OWNER-only. Absent from a manager's or cashier's payload. */
  costPrice?: number;
  stockValue?: number;
  potentialProfit?: number;
  marginPercentage?: number;

  sellingPrice: number;
  mrp: number;
  retailValue: number;

  unitsSold: number;
  revenue: number;
  lastSaleAt: string | null;
  lastMovementAt: string | null;
  lastMovementType: MovementType | null;

  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The details drawer's payload — a stock row plus its related records. */
export interface InventoryDetail extends StockRow {
  reservations: Reservation[];
  damaged: DamagedRow[];
  damagedQuantity: number;
  pendingAdjustments: Adjustment[];
}

// =============================================================================
// MOVEMENTS — the ledger
// =============================================================================

export interface MovementRow {
  id: string;
  variantId: string;
  sku: string | null;
  productName: string | null;
  imageUrl: string | null;
  variantName: string;

  type: MovementType;
  /** Signed. Negative removed stock. */
  quantityChanged: number;
  stockBefore: number;
  stockAfter: number;

  reason: string | null;
  referenceNumber: string | null;

  /** Whichever record caused this, so a row can link to its source. */
  relatedPurchaseId: string | null;
  relatedSaleId: string | null;
  relatedExchangeId: string | null;

  employeeId: string | null;
  employeeName: string | null;
  createdAt: string;
}

// =============================================================================
// RESERVATIONS
// =============================================================================

export interface Reservation {
  id: string;
  variantId: string;
  quantity: number;
  type: ReservationType;
  status: ReservationStatus;
  heldFor: string | null;
  customerId: string | null;
  exchangeId: string | null;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  releasedAt: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  customer: { id: string; name: string; phone: string } | null;
  variant?: {
    id: string;
    sku: string;
    product: { id: string; name: string };
    size: { name: string } | null;
    color: { name: string } | null;
  };
}

export interface CreateReservationPayload {
  variantId: string;
  quantity: number;
  type: ReservationType;
  heldFor?: string;
  customerId?: string;
  reason?: string;
  expiresInMinutes?: number;
}

// =============================================================================
// ADJUSTMENTS
// =============================================================================

export interface Adjustment {
  id: string;
  variantId: string;
  quantityChange: number;
  stockAtRequest: number;
  reason: AdjustmentReason;
  notes: string | null;
  status: AdjustmentStatus;
  reviewNotes: string | null;
  reviewedAt: string | null;
  /** NULL until approved — a pending adjustment moved nothing. */
  movementId: string | null;
  createdAt: string;
  requestedBy: { id: string; firstName: string; lastName: string; employeeCode: string } | null;
  reviewedBy: { id: string; firstName: string; lastName: string } | null;
  variant: {
    id: string;
    sku: string;
    currentStock: number;
    product: { id: string; name: string; imageUrls: string[] };
    size: { name: string } | null;
    color: { name: string } | null;
  };
}

export interface CreateAdjustmentPayload {
  variantId: string;
  quantityChange: number;
  reason: AdjustmentReason;
  notes?: string;
}

export interface ReviewAdjustmentPayload {
  approve: boolean;
  reviewNotes?: string;
}

// =============================================================================
// DAMAGED STOCK
// =============================================================================

export interface DamagedRow {
  id: string;
  variantId: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  variantName: string;
  quantity: number;
  reason: string;
  isWrittenOff: boolean;
  writtenOffAt: string | null;
  reportedAt: string;
  reportedByName: string | null;
  /** OWNER-only. */
  lossValue?: number;
}

export interface ReportDamagePayload {
  variantId: string;
  quantity: number;
  reason: string;
}

// =============================================================================
// CYCLE COUNTS
// =============================================================================

export interface CycleCount {
  id: string;
  reference: string;
  name: string | null;
  status: CycleCountStatus;
  categoryId: string | null;
  brandId: string | null;
  supplierId: string | null;
  startedAt: string;
  completedAt: string | null;
  totalItems: number;
  countedItems: number;
  varianceItems: number;
  /** Signed net units. +5 and −5 cancelling to 0 still means two real errors. */
  netVariance: number;
  notes: string | null;
  startedBy: { id: string; firstName: string; lastName: string } | null;
  completedBy: { id: string; firstName: string; lastName: string } | null;
}

export interface CycleCountItem {
  id: string;
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  imageUrl: string | null;
  variantName: string;
  /** Frozen when the line was created, so variance is attributable. */
  expectedQuantity: number;
  /** NULL = not yet counted, which differs from counted-as-zero. */
  countedQuantity: number | null;
  variance: number | null;
  notes: string | null;
  countedAt: string | null;
  countedByName: string | null;
}

export interface CycleCountDetail extends CycleCount {
  /** Percentage of counted LINES that matched. */
  accuracy: number;
  items: CycleCountItem[];
}

export interface StartCycleCountPayload {
  name?: string;
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  notes?: string;
}

// =============================================================================
// DASHBOARD
// =============================================================================

export interface InventoryDashboard {
  period: { from: string; to: string };

  totalSkus: number;
  totalUnits: number;
  lowStock: number;
  outOfStock: number;
  negativeStock: number;
  reservedUnits: number;
  damagedUnits: number;
  pendingPurchaseReceipts: number;
  pendingAdjustments: number;

  stockInToday: number;
  stockOutToday: number;

  /** NULL when nothing has ever been counted — not 100%. */
  inventoryAccuracy: number | null;
  lastCountedAt: string | null;

  /** OWNER-only. */
  inventoryValue?: number;
  retailValue?: number;
  potentialProfit?: number;

  charts: {
    movementTrend: Array<{ date: string; stockIn: number; stockOut: number }>;
    /** Empty for non-owners; sourced from snapshots, not the ledger. */
    valueTrend: Array<{ date: string; stockValue: number; retailValue: number }>;
    topCategories: Array<{
      categoryId: string | null;
      categoryName: string;
      units: number;
      stockValue?: number;
    }>;
  };
}

// =============================================================================
// VALUATION
// =============================================================================

export interface ValuationGroup {
  id: string | null;
  name: string;
  skuCount: number;
  quantity: number;
  stockValue: number;
  retailValue: number;
  potentialProfit: number;
  marginPercentage: number;
  sharePercentage: number;
}

export interface InventoryValuation {
  method: "AVERAGE_COST";
  totals: {
    skuCount: number;
    quantity: number;
    stockValue: number;
    retailValue: number;
    potentialProfit: number;
    marginPercentage: number;
    averageCost: number;
  };
  breakdown: ValuationGroup[];
  abc: { A: number; B: number; C: number };
  topByValue: Array<{
    variantId: string;
    sku: string;
    productName: string;
    quantity: number;
    stockValue: number;
    retailValue: number;
    abcClass: "A" | "B" | "C";
  }>;
}

// =============================================================================
// REORDER
// =============================================================================

export interface ReorderRow {
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  imageUrl: string | null;
  variantName: string;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;

  currentStock: number;
  reserved: number;
  available: number;

  averageDailySales: number;
  leadTimeDays: number;
  leadTimeDemand: number;
  safetyStock: number;
  reorderPoint: number;
  recommendedQuantity: number;
  /** NULL when nothing is selling — never render this as a big number. */
  daysRemaining: number | null;
  shouldReorder: boolean;

  unitsSold: number;

  /** OWNER-only. */
  costPrice?: number;
  estimatedCost?: number;
}

// =============================================================================
// VELOCITY / LOW STOCK / AGING
// =============================================================================

export interface VelocityRow {
  variantId: string;
  sku: string;
  productName: string;
  imageUrl: string | null;
  variantName: string;
  categoryName: string | null;
  brandName: string | null;
  supplierName: string | null;

  currentStock: number;
  velocity: StockVelocity;
  unitsSold: number;
  revenue: number;
  lastSaleAt: string | null;
  daysSinceLastSale: number | null;
  daysOfInventory: number | null;
  daysToSell: number | null;

  retailValue: number;
  stockValue?: number;

  suggestedDiscount: number;
}

export interface LowStockRow {
  variantId: string;
  sku: string;
  barcode: string | null;
  productName: string;
  imageUrl: string | null;
  variantName: string;
  categoryName: string | null;
  supplierId: string | null;
  supplierName: string | null;

  currentStock: number;
  reserved: number;
  available: number;
  reorderLevel: number;
  status: StockStatus;

  averageDailySales: number;
  daysRemaining: number | null;
  recommendedQuantity: number;
  leadTimeDays: number;

  lastSaleAt: string | null;
  daysOutOfStock: number | null;

  estimatedCost?: number;
}

export interface AgingReport {
  buckets: Array<{
    label: string;
    skuCount: number;
    units: number;
    retailValue: number;
    stockValue?: number;
  }>;
}

// =============================================================================
// QUERY PARAMS
// =============================================================================

export interface StockParams {
  page?: number;
  limit?: number;
  search?: string;
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  status?: StockStatusFilter;
  isActive?: boolean | "";
  velocityDays?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface MovementParams {
  page?: number;
  limit?: number;
  variantId?: string;
  type?: MovementType | "";
  employeeId?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface ReservationParams {
  page?: number;
  limit?: number;
  variantId?: string;
  status?: ReservationStatus | "";
  type?: ReservationType | "";
  customerId?: string;
}

export interface AdjustmentParams {
  page?: number;
  limit?: number;
  status?: AdjustmentStatus | "";
  variantId?: string;
  requestedById?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface DamagedParams {
  page?: number;
  limit?: number;
  variantId?: string;
  isWrittenOff?: boolean | "";
}

export interface CycleCountParams {
  page?: number;
  limit?: number;
  status?: CycleCountStatus | "";
}

export interface DashboardParams {
  period?: InventoryPeriod;
  dateFrom?: string;
  dateTo?: string;
}

export interface VelocityParams {
  page?: number;
  limit?: number;
  bucket?: "FAST_MOVING" | "SLOW_MOVING" | "DEAD_STOCK";
  windowDays?: number;
  categoryId?: string;
  brandId?: string;
}

export interface ReorderParams {
  page?: number;
  limit?: number;
  supplierId?: string;
  categoryId?: string;
  windowDays?: number;
  leadTimeDays?: number;
  safetyDays?: number;
  dueOnly?: boolean;
}

export interface ValuationParams {
  categoryId?: string;
  brandId?: string;
  supplierId?: string;
  groupBy?: "category" | "brand" | "supplier" | "none";
}

// =============================================================================
// SHARED RESPONSE ENVELOPE
// =============================================================================

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}
