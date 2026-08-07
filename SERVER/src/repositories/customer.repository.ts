import { prisma } from "../config/prisma";
import { Prisma } from "../../generated/prisma";
import { buildPrismaQuery } from "../utils/queryEngine";
import type { PaginationParams } from "../types/common.types";

/**
 * A customer is "active" if their most recent COMPLETED sale falls within this
 * many days. Used by both the analytics cards and the table's Active/Inactive
 * status + filter so the two never diverge.
 */
export const ACTIVE_WINDOW_DAYS = 90;

/**
 * Rows returned per history list on the customer profile. The profile shows a
 * recent slice, not an unbounded history — the UI states the cap so a user
 * reconciling against a report knows they are not seeing everything.
 */
export const PROFILE_HISTORY_LIMIT = 50;

/** One row of the "most purchased" rollup, grouped on SaleItem's snapshots. */
export interface TopProductRow {
  variantId: string;
  sku: string;
  productName: string;
  sizeName: string;
  colorName: string;
  totalQuantity: number;
  totalSpend: number;
  lastPurchased: Date;
}

/** One row of the owner customer table — customer columns + sale aggregates. */
export interface CustomerTableRow {
  id: string;
  customerCode: string;
  name: string;
  phone: string;
  email: string | null;
  rewardPoints: number;
  storeCredit: number;
  isActive: boolean;
  createdAt: Date;
  totalPurchases: number;
  totalSpend: number;
  lastVisit: Date | null;
  /** Derived from lastVisit vs ACTIVE_WINDOW_DAYS — a purchasing-recency status. */
  active: boolean;
}

/** One lightweight row returned by the typeahead `search` (dropdown fields only). */
export interface CustomerSearchRow {
  id: string;
  name: string;
  phone: string;
  customerCode: string;
  createdAt: Date;
}

/** Whitelisted sort columns for the owner table (guards against SQL injection). */
const TABLE_SORT_COLUMNS = {
  name: Prisma.sql`c."name"`,
  lastVisit: Prisma.sql`agg."lastVisit"`,
  totalSpend: Prisma.sql`agg."totalSpend"`,
  totalPurchases: Prisma.sql`agg."totalPurchases"`,
  createdAt: Prisma.sql`c."createdAt"`,
} as const;

export type CustomerTableSortField = keyof typeof TABLE_SORT_COLUMNS;

export interface CustomerTableParams {
  page: number;
  limit: number;
  search?: string | undefined;
  sortBy?: CustomerTableSortField | undefined;
  sortOrder?: "asc" | "desc" | undefined;
  /** Undefined = both; true/false narrows to purchasing-active/inactive. */
  active?: boolean | undefined;
  hasStoreCredit?: boolean | undefined;
  hasRewardPoints?: boolean | undefined;
  /** "new" restricts to customers created within ACTIVE_WINDOW... no — 30 days. */
  newWithinDays?: number | undefined;
}

export const customerRepository = {
  /**
   * Retrieves a paginated list of customers using the Enterprise Query Engine.
   */
  async findAll(params: PaginationParams) {
    const queryArgs = buildPrismaQuery<Prisma.CustomerWhereInput>(
      {
        searchableFields: ["name", "phone", "email", "customerCode"],
        allowedSortFields: ["createdAt", "name", "rewardPoints", "customerCode"],
        allowedFilters: ["isActive", "isWalkIn", "gender"],
        defaultSort: { field: "createdAt", order: "desc" },
      },
      params
    );

    return prisma.$transaction([
      prisma.customer.count({ where: queryArgs.where }),
      prisma.customer.findMany({
        ...queryArgs,
        include: { addresses: true },
      }),
    ]);
  },

  /**
   * Ranked typeahead search — powers the live customer search combobox.
   *
   * Substring (ILIKE '%term%') match across name, phone, and customerCode, but
   * ordered so the most relevant rows come first regardless of pagination:
   *   0. name starts with the term
   *   1. customerCode starts with the term
   *   2. phone contains the term (digits — no meaningful prefix)
   *   3. any other substring hit (name/code contains mid-word)
   * Ties break by name A→Z. All ranking, filtering, and LIMIT happen in
   * PostgreSQL, so the browser never receives more than `limit` rows even with
   * 100k+ customers. When `term` is empty we return the most recent customers
   * ("Recent Customers" empty-state) instead of matching nothing.
   *
   * Only lightweight fields the dropdown needs are selected.
   */
  async search(term: string, limit: number): Promise<CustomerSearchRow[]> {
    const clean = term.trim();
    const take = Math.min(Math.max(limit, 1), 25);

    // Empty query → most recently created real customers (empty-state list).
    if (!clean) {
      return prisma.$queryRaw<CustomerSearchRow[]>`
        SELECT c."id", c."name", c."phone", c."customerCode", c."createdAt"
        FROM "customers" c
        WHERE c."isWalkIn" = false
        ORDER BY c."createdAt" DESC
        LIMIT ${take}
      `;
    }

    const contains = `%${clean}%`;
    const prefix = `${clean}%`;

    return prisma.$queryRaw<CustomerSearchRow[]>`
      SELECT c."id", c."name", c."phone", c."customerCode", c."createdAt"
      FROM "customers" c
      WHERE c."isWalkIn" = false
        AND (
          c."name" ILIKE ${contains}
          OR c."phone" ILIKE ${contains}
          OR c."customerCode" ILIKE ${contains}
        )
      ORDER BY
        CASE
          WHEN c."name" ILIKE ${prefix} THEN 0
          WHEN c."customerCode" ILIKE ${prefix} THEN 1
          WHEN c."phone" ILIKE ${prefix} THEN 2
          ELSE 3
        END,
        c."name" ASC
      LIMIT ${take}
    `;
  },

  /**
   * Finds a customer by ID.
   */
  async findById(id: string) {
    return prisma.customer.findUnique({
      where: { id },
      include: { addresses: true },
    });
  },

  /**
   * Finds a customer by Phone.
   */
  async findByPhone(phone: string) {
    return prisma.customer.findUnique({
      where: { phone },
      include: { addresses: true },
    });
  },

  /**
   * Finds a customer by Code.
   */
  async findByCode(customerCode: string) {
    return prisma.customer.findUnique({
      where: { customerCode },
    });
  },

  /**
   * Finds or Creates the Walk-In Customer.
   * Uses raw SQL-like strict fallback since it's a critical system record.
   */
  async getWalkInCustomer() {
    let walkIn = await prisma.customer.findFirst({
      where: { isWalkIn: true },
    });

    if (!walkIn) {
      walkIn = await prisma.customer.create({
        data: {
          customerCode: "WALK-IN",
          name: "Walk-in Customer",
          phone: "0000000000",
          isWalkIn: true,
          isActive: true,
        },
      });
    }

    return walkIn;
  },

  /**
   * Creates a new customer.
   */
  async create(data: Prisma.CustomerCreateInput) {
    return prisma.customer.create({
      data,
      include: { addresses: true },
    });
  },

  /**
   * Updates an existing customer and fully replaces their addresses if provided.
   */
  async update(id: string, data: Prisma.CustomerUpdateInput, newAddresses?: Prisma.CustomerAddressCreateManyCustomerInput[]) {
    if (newAddresses) {
      return prisma.$transaction(async (tx) => {
        // Full replacement strategy for addresses
        await tx.customerAddress.deleteMany({ where: { customerId: id } });
        return tx.customer.update({
          where: { id },
          data: {
            ...data,
            addresses: {
              createMany: { data: newAddresses },
            },
          },
          include: { addresses: true },
        });
      });
    }

    return prisma.customer.update({
      where: { id },
      data,
      include: { addresses: true },
    });
  },

  /**
   * Retrieves the count of customers to generate sequential codes.
   *
   * Every row holding a `CUS-` code is considered, INCLUDING the Walk-In record.
   * Walk-In is normally minted as "WALK-IN", but `scripts/ensure-walkin.ts`
   * provisions it out of this same `CUS-` sequence, so on those databases it
   * owns CUS-000001. Filtering `isWalkIn: false` here (as this did) skipped that
   * row, returned 1 for an otherwise-empty table, and regenerated a code the
   * Walk-In row already held — a unique violation on `customerCode` that
   * surfaced as a 409 "record with the same field already exists" and blocked
   * the FIRST real customer on every such database.
   *
   * The filter that matters is the code namespace, not the walk-in flag.
   */
  async getNextSequenceNumber(): Promise<number> {
    const lastCustomer = await prisma.customer.findFirst({
      where: { customerCode: { startsWith: 'CUS-' } },
      orderBy: { customerCode: 'desc' },
    });

    if (!lastCustomer) return 1;

    const lastSeqStr = lastCustomer.customerCode.replace('CUS-', '');
    const parsedSeq = parseInt(lastSeqStr, 10);
    
    if (isNaN(parsedSeq)) return 1;
    return parsedSeq + 1;
  },

  /**
   * Retrieves aggregate statistics for a customer (e.g. lifetime spend).
   * This handles the complex aggregations directly via Prisma.
   */
  async getStatistics(customerId: string) {
    const aggregations = await prisma.sale.aggregate({
      where: { customerId, status: "COMPLETED" },
      _sum: { grandTotal: true },
      _count: { id: true },
      _min: { saleDate: true },
      _max: { saleDate: true },
    });

    const itemsPurchased = await prisma.saleItem.aggregate({
      where: { sale: { customerId, status: "COMPLETED" } },
      _sum: { quantity: true },
    });

    return {
      lifetimeSpend: aggregations._sum.grandTotal || 0,
      totalOrders: aggregations._count.id || 0,
      averageOrderValue:
        aggregations._count.id > 0
          ? Number(aggregations._sum.grandTotal || 0) / aggregations._count.id
          : 0,
      firstVisit: aggregations._min.saleDate,
      lastVisit: aggregations._max.saleDate,
      totalItemsPurchased: itemsPurchased._sum.quantity || 0,
    };
  },

  // ===========================================================================
  // OWNER DASHBOARD — customer table + analytics
  //
  // These power the owner/manager-only section on /customers. Both push all
  // filtering, sorting, aggregation, and pagination into PostgreSQL so the
  // browser never receives the full customer list. Aggregates (total spend,
  // total purchases, last visit) are computed from COMPLETED sales only.
  // The permanent Walk-In record is excluded everywhere.
  // ===========================================================================

  /**
   * Server-side paginated customer table with per-customer sale aggregates.
   *
   * A single query joins each customer to a lateral aggregate over their
   * COMPLETED sales. Filtering, sorting (including by aggregate columns), and
   * LIMIT/OFFSET all run in the database; only the requested page is returned.
   * A parallel COUNT over the same predicate gives the total for pagination.
   */
  async findAllWithStats(
    params: CustomerTableParams
  ): Promise<{ rows: CustomerTableRow[]; total: number }> {
    const {
      page,
      limit,
      search,
      sortBy = "lastVisit",
      sortOrder = "desc",
      active,
      hasStoreCredit,
      hasRewardPoints,
      newWithinDays,
    } = params;

    const offset = (page - 1) * limit;
    const activeThreshold = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000);

    // Build the shared WHERE predicate. Every fragment is parameterized.
    const conditions: Prisma.Sql[] = [Prisma.sql`c."isWalkIn" = false`];

    if (search && search.trim()) {
      const term = `%${search.trim()}%`;
      conditions.push(
        Prisma.sql`(c."name" ILIKE ${term} OR c."phone" ILIKE ${term} OR c."email" ILIKE ${term} OR c."customerCode" ILIKE ${term})`
      );
    }
    if (hasStoreCredit) conditions.push(Prisma.sql`c."storeCredit" > 0`);
    if (hasRewardPoints) conditions.push(Prisma.sql`c."rewardPoints" > 0`);
    if (newWithinDays && newWithinDays > 0) {
      const since = new Date(Date.now() - newWithinDays * 86_400_000);
      conditions.push(Prisma.sql`c."createdAt" >= ${since}`);
    }
    // Purchasing-active filter operates on the aggregated last visit.
    if (active === true) {
      conditions.push(Prisma.sql`agg."lastVisit" >= ${activeThreshold}`);
    } else if (active === false) {
      conditions.push(
        Prisma.sql`(agg."lastVisit" IS NULL OR agg."lastVisit" < ${activeThreshold})`
      );
    }

    const whereSql = Prisma.join(conditions, " AND ");

    // Aggregate over COMPLETED sales, LEFT JOINed so customers with zero sales
    // still appear (spend/purchases 0, lastVisit NULL).
    //
    // Grouped subquery rather than LEFT JOIN LATERAL: SQLite has no LATERAL, and
    // an edge node running this against the local database fails with
    // `near "SELECT": syntax error`. Pre-aggregating by "customerId" and joining
    // on it is dialect-neutral — one query that runs on Postgres AND SQLite,
    // which is the same reason DISTINCT ON and = ANY are rewritten at the source
    // rather than text-translated by the raw-SQL bridge.
    //
    // The GROUP BY makes "customerId" unique in the subquery, so this stays a
    // one-row-per-customer join and cannot fan out the result set.
    const aggJoin = Prisma.sql`
      LEFT JOIN (
        SELECT
          s."customerId"      AS "customerId",
          SUM(s."grandTotal") AS "totalSpend",
          COUNT(s.id)         AS "totalPurchases",
          MAX(s."saleDate")   AS "lastVisit"
        FROM "sales" s
        WHERE s."status" = 'COMPLETED'
        GROUP BY s."customerId"
      ) agg ON agg."customerId" = c.id
    `;

    const orderColumn = TABLE_SORT_COLUMNS[sortBy] ?? TABLE_SORT_COLUMNS.lastVisit;
    const orderDir = sortOrder === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    const [rows, countResult] = await prisma.$transaction([
      prisma.$queryRaw<CustomerTableRow[]>`
        SELECT
          c.id,
          c."customerCode",
          c."name",
          c."phone",
          c."email",
          c."rewardPoints",
          c."storeCredit"::float8            AS "storeCredit",
          c."isActive",
          c."createdAt",
          -- COALESCE here, not in the subquery: a customer with no COMPLETED
          -- sales has no row to join to, so the LEFT JOIN yields NULL for these
          -- columns regardless of what the subquery would have returned. The
          -- API contract is 0 purchases / 0 spend. ("lastVisit" stays NULL —
          -- "never visited" is a real distinction, and NULLS LAST sorts on it.)
          COALESCE(agg."totalPurchases", 0)::int    AS "totalPurchases",
          COALESCE(agg."totalSpend", 0)::float8     AS "totalSpend",
          agg."lastVisit",
          (agg."lastVisit" >= ${activeThreshold}) AS "active"
        FROM "customers" c
        ${aggJoin}
        WHERE ${whereSql}
        ORDER BY ${orderColumn} ${orderDir} NULLS LAST, c.id ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*)::bigint AS count
        FROM "customers" c
        ${aggJoin}
        WHERE ${whereSql}
      `,
    ]);

    // COALESCE(active) — the raw boolean is NULL when lastVisit is NULL.
    //
    // The numerics are coerced because the two drivers disagree: Postgres
    // narrows COUNT/SUM via the ::int/::float8 casts, while SQLite returns them
    // as BigInt regardless — which JSON.stringify cannot serialize, so the
    // response 500s on an edge node. Number() gives both the contracted type.
    const normalized = rows.map((r) => ({
      ...r,
      totalPurchases: Number(r.totalPurchases ?? 0),
      totalSpend: Number(r.totalSpend ?? 0),
      rewardPoints: Number(r.rewardPoints ?? 0),
      storeCredit: Number(r.storeCredit ?? 0),
      active: r.active === true,
    }));
    return { rows: normalized, total: Number(countResult[0]?.count ?? 0) };
  },

  // ===========================================================================
  // CUSTOMER PROFILE — per-customer histories and rollups
  //
  // These back the OWNER-only profile screen at /customers/:customerId. Each
  // history is capped server-side (the profile shows a recent slice, not an
  // unbounded list) and the caller states the cap in the UI rather than
  // truncating silently. Mirrors the supplier profile's shape.
  // ===========================================================================

  /**
   * Purchase history for a customer, newest first.
   *
   * Every sale is returned regardless of status — a VOIDED or PARTIAL sale is
   * part of the relationship history and hiding it would make the tab disagree
   * with the customer's own receipts. The COMPLETED-only filtering that governs
   * spend rollups lives in `getStatistics`, not here.
   */
  async purchaseHistory(customerId: string, limit = PROFILE_HISTORY_LIMIT) {
    return prisma.sale.findMany({
      where: { customerId },
      orderBy: { saleDate: "desc" },
      take: limit,
      select: {
        id: true,
        saleNumber: true,
        saleDate: true,
        status: true,
        subtotal: true,
        discountAmount: true,
        manualDiscountAmount: true,
        taxAmount: true,
        grandTotal: true,
        paidAmount: true,
        dueAmount: true,
        employee: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { items: true } },
      },
    });
  },

  /**
   * Exchange history for a customer, newest first.
   *
   * `priceDifference` is signed at the source: positive means the customer paid
   * extra, negative means the shop refunded them. It is passed through unchanged
   * so the UI can render the direction rather than re-deriving it from
   * issued − returned, which drifts once an exchange is partially settled.
   */
  async exchangeHistory(customerId: string, limit = PROFILE_HISTORY_LIMIT) {
    return prisma.exchange.findMany({
      where: { customerId },
      orderBy: { exchangeDate: "desc" },
      take: limit,
      select: {
        id: true,
        exchangeNumber: true,
        exchangeDate: true,
        status: true,
        returnedValue: true,
        issuedValue: true,
        priceDifference: true,
        exchangeReason: true,
        originalSale: { select: { id: true, saleNumber: true } },
        employee: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { returnedItems: true, issuedItems: true } },
      },
    });
  },

  /**
   * Exchange-side rollups for the profile KPIs.
   *
   * Counted over all exchanges, with net price difference summed separately —
   * a customer with two offsetting exchanges has a net near zero but still has
   * two exchange events, and the profile needs to show both facts.
   */
  async getExchangeStatistics(customerId: string) {
    const [totals, last] = await Promise.all([
      prisma.exchange.aggregate({
        where: { customerId },
        _count: { id: true },
        _sum: { returnedValue: true, issuedValue: true, priceDifference: true },
      }),
      prisma.exchange.findFirst({
        where: { customerId },
        orderBy: { exchangeDate: "desc" },
        select: { exchangeDate: true },
      }),
    ]);

    return {
      totalExchanges: totals._count.id || 0,
      totalReturnedValue: Number(totals._sum.returnedValue || 0),
      totalIssuedValue: Number(totals._sum.issuedValue || 0),
      /** Signed: positive = customer paid extra overall, negative = refunded. */
      netPriceDifference: Number(totals._sum.priceDifference || 0),
      lastExchangeDate: last?.exchangeDate ?? null,
    };
  },

  /**
   * The customer's most-purchased variants, ranked by quantity over COMPLETED
   * sales only. Aggregated in PostgreSQL so a customer with thousands of line
   * items never ships them all to the browser to be counted client-side.
   *
   * Groups on SaleItem's archival snapshots (productName/sizeName/colorName/sku)
   * rather than joining the live product tables. That is deliberate: the
   * snapshots exist so historical lines render as they were sold, and joining
   * `products` would relabel past purchases whenever a product is renamed. The
   * variantId is still carried through for linking, taken as MAX() since it is
   * functionally dependent on the snapshot group.
   */
  async topPurchasedProducts(customerId: string, limit = 10) {
    return prisma.$queryRaw<TopProductRow[]>`
      SELECT
        MAX(si."variantId")           AS "variantId",
        si."sku",
        si."productName",
        si."sizeName",
        si."colorName",
        SUM(si."quantity")::int       AS "totalQuantity",
        SUM(si."totalPrice")::float8  AS "totalSpend",
        MAX(s."saleDate")             AS "lastPurchased"
      FROM "sale_items" si
      JOIN "sales" s ON s."id" = si."saleId"
      WHERE s."customerId" = ${customerId} AND s."status" = 'COMPLETED'
      GROUP BY si."sku", si."productName", si."sizeName", si."colorName"
      ORDER BY "totalQuantity" DESC, "totalSpend" DESC
      LIMIT ${limit}
    `;
  },

  /**
   * Aggregate metrics for the owner analytics cards. One raw query for the
   * customer-level counts + a customer sale-aggregate CTE for spend/repeat/top,
   * issued in parallel. Walk-in is excluded throughout.
   */
  async getOwnerAnalytics() {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const activeThreshold = new Date(now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000);

    const [headcount, spend] = await Promise.all([
      // Customer-level counts — no sale join needed.
      prisma.$queryRaw<
        [{ total: bigint; newtoday: bigint; newmonth: bigint }]
      >`
        SELECT
          COUNT(*)::bigint AS total,
          COUNT(*) FILTER (WHERE c."createdAt" >= ${startOfToday})::bigint AS newtoday,
          COUNT(*) FILTER (WHERE c."createdAt" >= ${startOfMonth})::bigint AS newmonth
        FROM "customers" c
        WHERE c."isWalkIn" = false
      `,
      // Per-customer COMPLETED-sale rollup, then aggregate across customers.
      prisma.$queryRaw<
        [
          {
            active: bigint;
            repeat: bigint;
            purchasers: bigint;
            totalspend: number | null;
            topspend: number | null;
            topid: string | null;
            topname: string | null;
          }
        ]
      >`
        WITH per_customer AS (
          SELECT
            c.id,
            c."name",
            COUNT(s.id) AS orders,
            COALESCE(SUM(s."grandTotal"), 0) AS spend,
            MAX(s."saleDate") AS "lastVisit"
          FROM "customers" c
          LEFT JOIN "sales" s
            ON s."customerId" = c.id AND s."status" = 'COMPLETED'
          WHERE c."isWalkIn" = false
          GROUP BY c.id, c."name"
        ),
        top AS (
          SELECT id, "name", spend
          FROM per_customer
          WHERE orders > 0
          ORDER BY spend DESC
          LIMIT 1
        )
        SELECT
          COUNT(*) FILTER (WHERE "lastVisit" >= ${activeThreshold})::bigint AS active,
          COUNT(*) FILTER (WHERE orders >= 2)::bigint AS repeat,
          COUNT(*) FILTER (WHERE orders > 0)::bigint AS purchasers,
          COALESCE(SUM(spend), 0)::float8 AS totalspend,
          (SELECT spend::float8 FROM top) AS topspend,
          (SELECT id FROM top) AS topid,
          (SELECT "name" FROM top) AS topname
        FROM per_customer
      `,
    ]);

    const h = headcount[0];
    const s = spend[0];
    const purchasers = Number(s?.purchasers ?? 0);
    const totalSpend = Number(s?.totalspend ?? 0);

    return {
      totalCustomers: Number(h?.total ?? 0),
      newToday: Number(h?.newtoday ?? 0),
      newThisMonth: Number(h?.newmonth ?? 0),
      activeCustomers: Number(s?.active ?? 0),
      repeatCustomers: Number(s?.repeat ?? 0),
      // Average spend across customers who have actually purchased.
      averageCustomerSpend: purchasers > 0 ? totalSpend / purchasers : 0,
      totalRevenue: totalSpend,
      topCustomer:
        s?.topid && Number(s?.topspend ?? 0) > 0
          ? { id: s.topid, name: s.topname ?? "", totalSpend: Number(s.topspend) }
          : null,
      activeWindowDays: ACTIVE_WINDOW_DAYS,
    };
  },
};
