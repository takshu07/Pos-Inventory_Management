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
   */
  async getNextSequenceNumber(): Promise<number> {
    const lastCustomer = await prisma.customer.findFirst({
      where: { isWalkIn: false, customerCode: { startsWith: 'CUS-' } },
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

    // Correlated aggregate over COMPLETED sales, as a LEFT JOIN LATERAL so
    // customers with zero sales still appear (spend/purchases 0, lastVisit NULL).
    const aggJoin = Prisma.sql`
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(s."grandTotal"), 0) AS "totalSpend",
          COUNT(s.id)                      AS "totalPurchases",
          MAX(s."saleDate")                AS "lastVisit"
        FROM "sales" s
        WHERE s."customerId" = c.id AND s."status" = 'COMPLETED'
      ) agg ON true
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
          agg."totalPurchases"::int          AS "totalPurchases",
          agg."totalSpend"::float8           AS "totalSpend",
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
    const normalized = rows.map((r) => ({ ...r, active: r.active === true }));
    return { rows: normalized, total: Number(countResult[0]?.count ?? 0) };
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
