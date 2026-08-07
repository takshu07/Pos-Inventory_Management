import { Prisma } from "../../generated/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import { logger } from "../config/logger";
import {
  customerRepository,
  ACTIVE_WINDOW_DAYS,
  PROFILE_HISTORY_LIMIT,
} from "../repositories/customer.repository";
import { auditRepository } from "../repositories/audit.repository";
import { stripUndefined } from "../utils/object";
import type { PaginationParams, PaginatedResponse } from "../types/common.types";
import { formatPaginatedResponse } from "../utils/queryEngine";
import { ConfigurationEngine } from "../engines/configuration.engine";
import { evaluateExchangeWindow } from "../utils/exchangeWindow";
import { prisma } from "../config/prisma";

/**
 * Normalizes a phone number by stripping country codes and non-digit characters.
 * Example: "+91 9876543210" -> "9876543210"
 */
function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, "");
  if (cleaned.length > 10 && cleaned.startsWith("91")) {
    cleaned = cleaned.substring(2);
  }
  return cleaned;
}

/**
 * Returns the field names named by a Prisma P2002 unique-constraint error, or
 * an empty array if `err` is not one.
 *
 * `meta.target` is a string[] on Postgres but a comma-joined string on SQLite
 * (the offline edge datasource), and can name the index rather than the column
 * — both shapes are flattened to a searchable list of names. Duck-typed on
 * `code` for the same reason error.middleware.ts is: the offline router may
 * hand back an error from a different Prisma client instance.
 */
function uniqueViolationTargets(err: unknown): string[] {
  if (typeof err !== "object" || err === null) return [];
  if ((err as { code?: string }).code !== "P2002") return [];

  const target = (err as { meta?: { target?: unknown } }).meta?.target;

  const names = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? target.split(",").map((t) => t.trim())
      : [];

  // Lowercased so callers can match case-insensitively: the entry may be the
  // column ("customerCode") or the index that enforces it
  // ("customers_customerCode_key"), so callers substring-match rather than
  // compare for equality.
  return names.map((n) => n.toLowerCase());
}

/** True when a P2002 names `field`, whether as a column or an index name. */
function violates(err: unknown, field: string): boolean {
  const needle = field.toLowerCase();
  return uniqueViolationTargets(err).some((t) => t.includes(needle));
}

export const customerService = {
  /**
   * Retrieves a paginated list of customers.
   */
  async getCustomers(params: PaginationParams) {
    const [total, data] = await customerRepository.findAll(params);
    return formatPaginatedResponse(data, total, params);
  },

  /**
   * Ranked typeahead search for the live customer combobox. Returns a flat,
   * relevance-ordered list of lightweight rows (no pagination envelope) — the
   * dropdown only ever shows the top `limit` matches. Empty query yields the
   * most recent customers for the "Recent Customers" empty state.
   */
  async searchCustomers(term: string, limit: number) {
    return customerRepository.search(term, limit);
  },

  /**
   * Owner/manager customer table — server-side paginated rows with per-customer
   * sale aggregates. Returns the standard paginated envelope so the client can
   * reuse the same DataTable/pagination plumbing as every other list.
   */
  async getCustomerTable(query: {
    page: number;
    limit: number;
    search?: string | undefined;
    sortBy: "name" | "lastVisit" | "totalSpend" | "totalPurchases" | "createdAt";
    sortOrder: "asc" | "desc";
    active?: "true" | "false" | undefined;
    hasStoreCredit?: boolean | undefined;
    hasRewardPoints?: boolean | undefined;
    newWithinDays?: number | undefined;
  }) {
    const { rows, total } = await customerRepository.findAllWithStats({
      page: query.page,
      limit: query.limit,
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      active:
        query.active === undefined ? undefined : query.active === "true",
      hasStoreCredit: query.hasStoreCredit,
      hasRewardPoints: query.hasRewardPoints,
      newWithinDays: query.newWithinDays,
    });

    // Reuse the shared envelope; it derives meta from total/page/limit.
    return formatPaginatedResponse(rows, total, {
      page: query.page,
      limit: query.limit,
    });
  },

  /**
   * Aggregate metrics for the owner analytics cards.
   */
  async getCustomerAnalytics() {
    return customerRepository.getOwnerAnalytics();
  },

  /**
   * Retrieves a single customer with their calculated statistics.
   */
  async getCustomerById(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    const stats = await customerRepository.getStatistics(id);

    return { ...customer, statistics: stats };
  },

  /**
   * Retrieves a single customer by phone exactly.
   */
  async getCustomerByPhone(phone: string) {
    const normalizedPhone = normalizePhone(phone);
    const customer = await customerRepository.findByPhone(normalizedPhone);
    
    if (!customer) {
      return null;
    }

    const stats = await customerRepository.getStatistics(customer.id);
    return { ...customer, statistics: stats };
  },

  /**
   * Retrieves the Walk-In Customer.
   */
  async getWalkInCustomer() {
    return customerRepository.getWalkInCustomer();
  },

  /**
   * Creates a new customer.
   */
  async createCustomer(data: any, executorId: string) {
    const normalizedPhone = normalizePhone(data.phone);

    // 1. Uniqueness check
    const existing = await customerRepository.findByPhone(normalizedPhone);
    if (existing) {
      throw new AppError(HTTP_STATUS.CONFLICT, "A customer with this phone number already exists.");
    }

    // 2. Prepare payload (customerCode is assigned per attempt below)
    const payload: Prisma.CustomerCreateInput = {
      customerCode: "",
      name: data.name,
      phone: normalizedPhone,
      email: data.email,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth,
      anniversary: data.anniversary,
      notes: data.notes,
      isActive: true,
      isWalkIn: false,
    };

    if (data.addresses && data.addresses.length > 0) {
      payload.addresses = {
        create: data.addresses,
      };
    }

    // 3. Create in DB, retrying on a customerCode collision.
    //
    // The code is derived from the current maximum, so it is inherently racy:
    // two cashiers creating a customer at the same moment compute the same next
    // code and one loses on the unique index. That collision is transient — the
    // next read sees the winner's row and yields the following code — so it is
    // retried rather than reported. Reporting it produced the misleading
    // "A record with the same field already exists", which reads as a duplicate
    // PHONE to the cashier even though the phone was verified free in step 1.
    //
    // Only a `customerCode` conflict is retried. A P2002 on `phone` means a
    // customer was genuinely created between the check above and this write, and
    // is surfaced as the real duplicate it is.
    const MAX_CODE_ATTEMPTS = 5;
    let newCustomer;

    for (let attempt = 1; ; attempt++) {
      const nextSeq = await customerRepository.getNextSequenceNumber();
      payload.customerCode = `CUS-${String(nextSeq).padStart(6, "0")}`;

      try {
        newCustomer = await customerRepository.create(payload);
        break;
      } catch (err) {
        if (violates(err, "phone")) {
          throw new AppError(
            HTTP_STATUS.CONFLICT,
            "A customer with this phone number already exists."
          );
        }

        if (!violates(err, "customerCode") || attempt >= MAX_CODE_ATTEMPTS) {
          throw err;
        }

        logger.warn(
          { attempt, customerCode: payload.customerCode },
          "Customer code collision — regenerating"
        );
      }
    }

    // 5. Audit Logging
    auditRepository.create({
      performedBy: executorId,
      action: "CREATE",
      module: "CUSTOMER",
      tableName: "customers",
      recordId: newCustomer.id,
      oldData: null,
      newData: newCustomer,
    }).catch((err) => logger.error({ err, id: newCustomer.id }, "Failed to write audit log for customer creation"));

    logger.info({ customerId: newCustomer.id, executorId }, "Customer created");

    return newCustomer;
  },

  /**
   * Updates an existing customer.
   */
  async updateCustomer(id: string, data: any, executorId: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    if (customer.isWalkIn) {
      throw new AppError(HTTP_STATUS.FORBIDDEN, "The permanent Walk-In customer cannot be modified.");
    }

    const updates: Prisma.CustomerUpdateInput = stripUndefined({
      name: data.name,
      email: data.email,
      gender: data.gender,
      dateOfBirth: data.dateOfBirth,
      anniversary: data.anniversary,
      notes: data.notes,
      isActive: data.isActive,
    });

    if (data.phone) {
      const normalizedPhone = normalizePhone(data.phone);
      if (normalizedPhone !== customer.phone) {
        const existing = await customerRepository.findByPhone(normalizedPhone);
        if (existing) {
          throw new AppError(HTTP_STATUS.CONFLICT, "This phone number is already registered to another customer.");
        }
        updates.phone = normalizedPhone;
      }
    }

    let newAddresses: Prisma.CustomerAddressCreateManyCustomerInput[] | undefined;
    if (data.addresses) {
      newAddresses = data.addresses;
    }

    const updatedCustomer = await customerRepository.update(id, updates, newAddresses);

    // Audit Logging
    auditRepository.create({
      performedBy: executorId,
      action: "UPDATE",
      module: "CUSTOMER",
      tableName: "customers",
      recordId: id,
      oldData: customer,
      newData: updatedCustomer,
    }).catch((err) => logger.error({ err, id }, "Failed to write audit log for customer update"));

    logger.info({ customerId: id, executorId }, "Customer updated");

    return updatedCustomer;
  },

  /**
   * Full customer profile for the OWNER-only profile screen: the record, its
   * sale and exchange rollups, and the histories rendered as tabs.
   *
   * Fetched in one round trip rather than four. The profile always renders every
   * tab, and against a network-latency (Neon) database four serial queries cost
   * four round trips for no benefit — the same reasoning as getSupplierById.
   *
   * The permanent Walk-In record is rejected: it is a system placeholder that
   * accumulates every anonymous sale in the shop, so a "profile" for it would
   * present unrelated transactions as one person's purchase history.
   */
  async getCustomerProfile(id: string) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    if (customer.isWalkIn) {
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        "The Walk-In record is a system placeholder, not a customer, and has no profile."
      );
    }

    const [saleStats, exchangeStats, purchases, exchanges, topProducts] =
      await Promise.all([
        customerRepository.getStatistics(id),
        customerRepository.getExchangeStatistics(id),
        customerRepository.purchaseHistory(id),
        customerRepository.exchangeHistory(id),
        customerRepository.topPurchasedProducts(id),
      ]);

    // Purchasing-recency status, derived from the same ACTIVE_WINDOW_DAYS the
    // customer table and analytics cards use, so the profile badge can never
    // disagree with the list the user clicked through from.
    const lastVisit = saleStats.lastVisit;
    const activeThreshold = new Date(
      Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000
    );
    const active = lastVisit !== null && lastVisit >= activeThreshold;

    return {
      ...customer,
      statistics: {
        ...saleStats,
        lifetimeSpend: Number(saleStats.lifetimeSpend),
        ...exchangeStats,
        active,
        activeWindowDays: ACTIVE_WINDOW_DAYS,
      },
      purchases,
      exchanges,
      topProducts,
      /** The server-side cap applied to each history list above. */
      historyLimit: PROFILE_HISTORY_LIMIT,
    };
  },

  /**
   * Retrieves the purchase history for a customer.
   */
  async getCustomerPurchaseHistory(id: string, params: PaginationParams) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    // We can rely on the Query Engine from Sale repository in a full integration,
    // but here we can write a dedicated repository function if needed.
    // Assuming saleRepository.findAll accepts baseFilters.
    // For this module, we will just delegate to Prisma directly to keep the service self-contained for the deliverable.
    
    // Instead of duplicating query engine, we will import buildPrismaQuery here
    const { buildPrismaQuery, formatPaginatedResponse } = await import("../utils/queryEngine");
    const { prisma } = await import("../config/prisma");

    const queryArgs = buildPrismaQuery(
      {
        searchableFields: ["saleNumber"],
        allowedSortFields: ["saleDate", "grandTotal"],
        allowedFilters: ["status"],
        defaultSort: { field: "saleDate", order: "desc" },
        baseFilters: { customerId: id },
      },
      params
    );

    const [total, data] = await prisma.$transaction([
      prisma.sale.count({ where: queryArgs.where }),
      prisma.sale.findMany({
        ...queryArgs,
        include: { items: true, payments: true },
      }),
    ]);

    return formatPaginatedResponse(data, total, params);
  },

  /**
   * Computes exchange eligibility for a customer's recent sales.
   *
   * A sale is eligible when it is still exchangeable (COMPLETED or PARTIAL) and
   * its age has not exceeded the configured exchange window. The window is read
   * from the ConfigurationEngine so the cashier UI reflects the same rule the
   * exchange flow enforces.
   */
  async getExchangeEligibility(id: string, limit = 10) {
    const customer = await customerRepository.findById(id);
    if (!customer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "Customer not found");
    }

    const sales = await prisma.sale.findMany({
      where: {
        customerId: id,
        status: { in: ["COMPLETED", "PARTIAL"] },
      },
      orderBy: { saleDate: "desc" },
      take: limit,
      select: {
        id: true,
        saleNumber: true,
        saleDate: true,
        grandTotal: true,
        status: true,
      },
    });

    // Same evaluateExchangeWindow helper the exchange enforcement uses, so the
    // eligibility shown here always matches what processExchange will accept.
    const now = new Date();
    const windowDays = ConfigurationEngine.getExchangeSettings().exchangeWindowDays;

    const items = sales.map((sale) => {
      const status = evaluateExchangeWindow(sale.saleDate, now);
      return {
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        saleDate: sale.saleDate,
        grandTotal: sale.grandTotal,
        eligible: status.eligible,
        daysRemaining: status.daysRemaining,
        elapsedDays: status.elapsedDays,
        expiresOn: status.expiresOn,
      };
    });

    return {
      windowDays,
      items,
    };
  },
};
