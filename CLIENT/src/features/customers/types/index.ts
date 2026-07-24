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
