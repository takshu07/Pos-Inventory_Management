/**
 * Global Types
 * Responsibility: Provide shared typescript definitions used across multiple domains.
 * What not to do: Do not put domain-specific API response types here (e.g., SaleReceipt).
 * Those belong in `src/features/[feature]/types.ts`.
 */

export type Role = "OWNER" | "MANAGER" | "CASHIER";

export interface UserInfo {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  meta: PaginationMeta;
}
