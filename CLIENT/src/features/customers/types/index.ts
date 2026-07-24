/**
 * Customer feature types.
 *
 * These mirror the backend `customerService` payloads. Monetary fields that
 * Prisma stores as Decimal (storeCredit, statistics.*) arrive as numbers over
 * JSON, so they are typed as `number` here.
 */

export interface CustomerStatistics {
  lifetimeSpend: number;
  totalOrders: number;
  averageOrderValue: number;
  firstVisit: string | null;
  lastVisit: string | null;
  totalItemsPurchased: number;
}

export interface CustomerAddress {
  id: string;
  type: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  isDefault: boolean;
}

export interface CustomerModel {
  id: string;
  customerCode: string;
  isWalkIn: boolean;
  name: string;
  phone: string;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  anniversary: string | null;
  rewardPoints: number;
  storeCredit: number;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  addresses?: CustomerAddress[];
  /** Present on single-customer lookups (by id / by phone), absent on list rows. */
  statistics?: CustomerStatistics;
}

export interface CustomerCreateDTO {
  name: string;
  phone: string;
  email?: string | null;
  gender?: string | null;
  dateOfBirth?: string | null;
  notes?: string | null;
}

export interface CustomerQueryFilters {
  page?: number;
  limit?: number;
  search?: string;
}

export interface CustomersPaginatedResponse {
  total: number;
  data: CustomerModel[];
}

// ─── Owner dashboard (MANAGER+) ─────────────────────────────────────────────

/** Aggregate metrics for the owner analytics cards. */
export interface CustomerAnalytics {
  totalCustomers: number;
  newToday: number;
  newThisMonth: number;
  activeCustomers: number;
  repeatCustomers: number;
  averageCustomerSpend: number;
  totalRevenue: number;
  topCustomer: { id: string; name: string; totalSpend: number } | null;
  activeWindowDays: number;
}

/** One row of the owner customer table (customer columns + sale aggregates). */
export interface CustomerTableRow {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  email: string | null;
  rewardPoints: number;
  storeCredit: number;
  isActive: boolean;
  createdAt: string;
  totalPurchases: number;
  totalSpend: number;
  lastVisit: string | null;
  /** Purchasing-recency status: last visit within the active window. */
  active: boolean;
}

export type CustomerTableSortField =
  | "name"
  | "lastVisit"
  | "totalSpend"
  | "totalPurchases"
  | "createdAt";

/** Query params for the owner customer table — all applied server-side. */
export interface CustomerTableFilters {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: CustomerTableSortField;
  sortOrder?: "asc" | "desc";
  /** undefined = both; "true"/"false" narrows purchasing-active status. */
  active?: "true" | "false";
  hasStoreCredit?: boolean;
  hasRewardPoints?: boolean;
  newWithinDays?: number;
}

export interface CustomerTableResponse {
  total: number;
  data: CustomerTableRow[];
}

/** A single recent sale with its exchange-window status. */
export interface ExchangeEligibilityItem {
  saleId: string;
  saleNumber: string;
  saleDate: string;
  grandTotal: number;
  eligible: boolean;
  /** Whole days left in the window; 0 once expired. */
  daysRemaining: number;
  /** Whole days elapsed since the purchase. */
  elapsedDays: number;
  expiresOn: string;
}

export interface ExchangeEligibilityResponse {
  windowDays: number;
  items: ExchangeEligibilityItem[];
}
