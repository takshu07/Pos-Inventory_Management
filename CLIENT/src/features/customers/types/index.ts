export interface CustomerStatistics {
  lifetimeSpend: number;
  totalOrders: number;
  averageOrderValue: number;
  firstVisit: string | null;
  lastVisit: string | null;
  totalItemsPurchased: number;
}

export interface CustomerModel {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  anniversary: string | null;
  notes: string | null;
  loyaltyPoints: number;
  totalPurchases: number;
  totalSpent: number;
  lastPurchaseDate: string | null;
  isActive: boolean;
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
