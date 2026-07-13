// =============================================================================
// COMMON TYPES
// Reusable types used across multiple domains, like pagination and sorting.
// =============================================================================

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    nextCursor?: string; // Support for cursor-based pagination
  };
}

/**
 * Common query parameters for list endpoints.
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  search?: string | undefined;
  sortBy?: string | undefined;
  sortOrder?: "asc" | "desc" | undefined;
  cursor?: string | undefined;
  [key: string]: any; // Allow specific filters (e.g., isActive, categoryId)
}
