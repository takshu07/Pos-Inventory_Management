import type { PaginatedResponse, PaginationParams } from "../types/common.types";

export interface QueryConfig<T> {
  searchableFields: (keyof T)[];
  allowedSortFields: (keyof T)[];
  allowedFilters?: string[];
  defaultSort: { field: keyof T; order: "asc" | "desc" };
  maxLimit?: number;
  baseFilters?: any;
}

export interface PrismaQueryArgs {
  where: any;
  skip?: number;
  take: number;
  cursor?: any;
  orderBy: any;
}

/**
 * Shared Query Engine for Prisma
 * Handles offset/cursor pagination, dynamic searching, secure sorting, and filtering.
 */
export function buildPrismaQuery<T>(
  config: QueryConfig<T>,
  input: PaginationParams
): PrismaQueryArgs {
  const limit = Math.min(input.limit || 10, config.maxLimit || 100);

  // Extract allowed exact-match filters
  const exactFilters: Record<string, any> = {};
  if (config.allowedFilters) {
    for (const filter of config.allowedFilters) {
      if (input[filter] !== undefined) {
        exactFilters[filter] = input[filter];
      }
    }
  }

  const args: PrismaQueryArgs = {
    where: { ...config.baseFilters, ...exactFilters },
    take: limit,
    orderBy: {},
  };

  // Pagination Strategy
  if (input.cursor) {
    args.cursor = { id: input.cursor };
    args.skip = 1; // Skip the cursor record itself
  } else {
    const page = Math.max(input.page || 1, 1);
    args.skip = (page - 1) * limit;
  }

  // Secure Sorting
  const sortField =
    input.sortBy && config.allowedSortFields.includes(input.sortBy as keyof T)
      ? input.sortBy
      : config.defaultSort.field;
  const sortOrder = input.sortOrder || config.defaultSort.order;

  args.orderBy = { [sortField]: sortOrder };

  // Search Engine (ILIKE)
  if (input.search && config.searchableFields.length > 0) {
    const searchConditions = config.searchableFields.map((field) => ({
      [field]: { contains: input.search, mode: "insensitive" },
    }));

    if (Object.keys(args.where).length > 0) {
      args.where = {
        AND: [
          { ...args.where },
          { OR: searchConditions },
        ],
      };
    } else {
      args.where.OR = searchConditions;
    }
  }

  return args;
}

/**
 * Formats a standardized paginated response.
 * Safely handles both offset and cursor meta data.
 */
export function formatPaginatedResponse<T>(
  data: T[],
  total: number,
  input: PaginationParams
): PaginatedResponse<T> {
  const limit = input.limit || 10;
  const page = input.page || 1;
  const totalPages = Math.ceil(total / limit);

  // If using cursor pagination, the next cursor is the ID of the last item
  let nextCursor: string | undefined = undefined;
  if (input.cursor || (data.length > 0 && data.length === limit)) {
    const lastItem = data[data.length - 1] as any;
    if (lastItem && lastItem.id) {
      nextCursor = lastItem.id;
    }
  }

  // If this is the last page, no next cursor
  if (page >= totalPages) {
    nextCursor = undefined;
  }

  return {
    data,
    meta: {
      total,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
      ...(nextCursor && { nextCursor }),
    },
  };
}
