// =============================================================================
// REPORTS REPOSITORY  —  the Business Intelligence query layer
//
// Almost everything here is raw SQL, and that is deliberate. A report is a
// grouped aggregate over a join — "revenue by category", "margin by product",
// "returns by reason" — and Prisma's fluent API cannot express a SUM over a
// product of two columns, a FILTER clause, or a window function. The
// alternative is fetching rows into Node to reduce them there, which for a
// year of sales means moving the entire sale_items table over the wire to
// compute twelve numbers.
//
// THREE RULES EVERY QUERY IN THIS FILE FOLLOWS
// --------------------------------------------
//  1. TABLE NAMES ARE THE @@map'd LOWERCASE ONES. Prisma's @@map means the
//     model name does not exist in Postgres; "SaleItem" fails at runtime and
//     never at compile time, so the physical names are used throughout.
//  2. VALUES ARE ALWAYS `${}` TAGGED-TEMPLATE PARAMETERS. The only things ever
//     spliced as text are ORDER BY directions and date_trunc units, both drawn
//     from closed whitelists in this file — nothing user-supplied reaches SQL.
//  3. EVERY FILTER IS OPTIONAL AND COMPOSED. `buildSaleFilters()` returns a
//     Prisma.Sql fragment so ten report queries share one definition of what
//     "filtered by employee, category, brand and date" means. Ten hand-written
//     WHERE clauses would eventually disagree, and the report that disagreed
//     would be the one nobody checked.
// =============================================================================

import { Prisma } from "../../generated/prisma";
import { prisma } from "../config/prisma";
import { truncUnit, type Granularity } from "../engines/finance.engine";

// =============================================================================
// FILTER COMPOSITION
// =============================================================================

/** The universal report filter set. Every field is optional. */
export interface ReportFilters {
  startDate: Date;
  endDate: Date;
  employeeId?: string | undefined;
  customerId?: string | undefined;
  supplierId?: string | undefined;
  brandId?: string | undefined;
  categoryId?: string | undefined;
  productId?: string | undefined;
  variantId?: string | undefined;
  sku?: string | undefined;
  invoiceNumber?: string | undefined;
  paymentMethod?: string | undefined;
}

/** Sort direction, whitelisted so it can be safely interpolated. */
function direction(order: "asc" | "desc"): Prisma.Sql {
  return Prisma.raw(order === "asc" ? "ASC" : "DESC");
}

/**
 * Sale-level filter fragment. Assumes the query aliases `sales` as `s`.
 *
 * Product-dimension filters (category/brand/product/sku) are expressed as an
 * EXISTS over sale_items rather than a join, because a join would multiply the
 * sale row by its line count and double-count grandTotal — the classic
 * fan-out bug in retail reporting.
 */
export function buildSaleFilters(f: ReportFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`s.status = 'COMPLETED'`,
    Prisma.sql`s."saleDate" >= ${f.startDate}`,
    Prisma.sql`s."saleDate" <= ${f.endDate}`,
  ];

  if (f.employeeId) parts.push(Prisma.sql`s."employeeId" = ${f.employeeId}`);
  if (f.customerId) parts.push(Prisma.sql`s."customerId" = ${f.customerId}`);
  if (f.invoiceNumber) parts.push(Prisma.sql`s."saleNumber" ILIKE ${`%${f.invoiceNumber}%`}`);

  if (f.paymentMethod) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "payments" pm
       WHERE pm."saleId" = s.id AND pm.method = ${f.paymentMethod}::"PaymentMethod" AND pm.status = 'PAID'
    )`);
  }

  const productPredicates: Prisma.Sql[] = [];
  if (f.categoryId) productPredicates.push(Prisma.sql`p."categoryId" = ${f.categoryId}`);
  if (f.brandId) productPredicates.push(Prisma.sql`p."brandId" = ${f.brandId}`);
  if (f.productId) productPredicates.push(Prisma.sql`p.id = ${f.productId}`);
  if (f.variantId) productPredicates.push(Prisma.sql`v.id = ${f.variantId}`);
  if (f.sku) productPredicates.push(Prisma.sql`si.sku ILIKE ${`%${f.sku}%`}`);
  if (f.supplierId) productPredicates.push(Prisma.sql`v."supplierId" = ${f.supplierId}`);

  if (productPredicates.length > 0) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1
        FROM "sale_items" si
        JOIN "product_variants" v ON v.id = si."variantId"
        JOIN "products" p ON p.id = v."productId"
       WHERE si."saleId" = s.id
         AND ${Prisma.join(productPredicates, " AND ")}
    )`);
  }

  return Prisma.join(parts, " AND ");
}

/**
 * ITEM-level filter fragment, for queries that group by product dimensions.
 * Assumes aliases s (sales), si (sale_items), v (product_variants), p (products).
 */
export function buildItemFilters(f: ReportFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`s.status = 'COMPLETED'`,
    Prisma.sql`s."saleDate" >= ${f.startDate}`,
    Prisma.sql`s."saleDate" <= ${f.endDate}`,
  ];

  if (f.employeeId) parts.push(Prisma.sql`s."employeeId" = ${f.employeeId}`);
  if (f.customerId) parts.push(Prisma.sql`s."customerId" = ${f.customerId}`);
  if (f.invoiceNumber) parts.push(Prisma.sql`s."saleNumber" ILIKE ${`%${f.invoiceNumber}%`}`);
  if (f.categoryId) parts.push(Prisma.sql`p."categoryId" = ${f.categoryId}`);
  if (f.brandId) parts.push(Prisma.sql`p."brandId" = ${f.brandId}`);
  if (f.productId) parts.push(Prisma.sql`p.id = ${f.productId}`);
  if (f.variantId) parts.push(Prisma.sql`v.id = ${f.variantId}`);
  if (f.sku) parts.push(Prisma.sql`si.sku ILIKE ${`%${f.sku}%`}`);
  if (f.supplierId) parts.push(Prisma.sql`v."supplierId" = ${f.supplierId}`);

  if (f.paymentMethod) {
    parts.push(Prisma.sql`EXISTS (
      SELECT 1 FROM "payments" pm
       WHERE pm."saleId" = s.id AND pm.method = ${f.paymentMethod}::"PaymentMethod" AND pm.status = 'PAID'
    )`);
  }

  return Prisma.join(parts, " AND ");
}

// =============================================================================
// SHARED ROW SHAPES
// =============================================================================

export interface SalesKpiRow {
  grossSales: Prisma.Decimal;
  discounts: Prisma.Decimal;
  tax: Prisma.Decimal;
  orders: bigint;
  unitsSold: bigint;
  cogs: Prisma.Decimal;
}

export const reportsRepository = {
  // ===========================================================================
  // SALES REPORT
  // ===========================================================================

  /**
   * Headline sales metrics.
   *
   * Units and COGS come from a SEPARATE subquery rather than a join onto sales,
   * for the fan-out reason documented on buildSaleFilters: joining line items
   * to bills multiplies grandTotal by the number of lines.
   */
  async salesKpis(f: ReportFilters): Promise<SalesKpiRow> {
    const saleWhere = buildSaleFilters(f);
    const itemWhere = buildItemFilters(f);

    const rows = await prisma.$queryRaw<SalesKpiRow[]>`
      WITH bills AS (
        SELECT COALESCE(SUM(s."grandTotal"), 0)::numeric AS gross,
               COALESCE(SUM(s."discountAmount" + s."manualDiscountAmount"), 0)::numeric AS discounts,
               COALESCE(SUM(s."taxAmount"), 0)::numeric  AS tax,
               COUNT(*)                                   AS orders
          FROM "sales" s
         WHERE ${saleWhere}
      ),
      lines AS (
        SELECT COALESCE(SUM(si.quantity), 0)                          AS units,
               COALESCE(SUM(si."costAtSale" * si.quantity), 0)::numeric AS cogs
          FROM "sale_items" si
          JOIN "sales" s ON s.id = si."saleId"
          JOIN "product_variants" v ON v.id = si."variantId"
          JOIN "products" p ON p.id = v."productId"
         WHERE ${itemWhere}
      )
      SELECT bills.gross     AS "grossSales",
             bills.discounts AS discounts,
             bills.tax       AS tax,
             bills.orders    AS orders,
             lines.units     AS "unitsSold",
             lines.cogs      AS cogs
        FROM bills, lines
    `;

    return (
      rows[0] ?? {
        grossSales: new Prisma.Decimal(0),
        discounts: new Prisma.Decimal(0),
        tax: new Prisma.Decimal(0),
        orders: 0n,
        unitsSold: 0n,
        cogs: new Prisma.Decimal(0),
      }
    );
  },

  /** Sales time series, bucketed. */
  async salesSeries(f: ReportFilters, granularity: Granularity) {
    const unit = Prisma.raw(`'${truncUnit(granularity)}'`);
    const where = buildSaleFilters(f);

    return prisma.$queryRaw<
      Array<{ bucket: Date; revenue: Prisma.Decimal; orders: bigint; discounts: Prisma.Decimal }>
    >`
      SELECT date_trunc(${unit}, s."saleDate")          AS bucket,
             COALESCE(SUM(s."grandTotal"), 0)::numeric   AS revenue,
             COUNT(*)                                    AS orders,
             COALESCE(SUM(s."discountAmount" + s."manualDiscountAmount"), 0)::numeric AS discounts
        FROM "sales" s
       WHERE ${where}
       GROUP BY 1
       ORDER BY 1 ASC
    `;
  },

  /**
   * Return and exchange counts/values in the window.
   *
   * Returned UNITS come from a correlated scalar subquery rather than a join to
   * exchange_return_items: joining would repeat each exchange row once per
   * returned line and inflate issuedValue and returnedValue by the line count.
   */
  async returnExchangeTotals(f: ReportFilters) {
    const rows = await prisma.$queryRaw<
      Array<{
        exchangeCount: bigint;
        issuedValue: Prisma.Decimal;
        returnedValue: Prisma.Decimal;
        refundValue: Prisma.Decimal;
        returnedUnits: bigint;
      }>
    >`
      SELECT COUNT(*)                                                  AS "exchangeCount",
             COALESCE(SUM(e."issuedValue"), 0)::numeric                 AS "issuedValue",
             COALESCE(SUM(e."returnedValue"), 0)::numeric               AS "returnedValue",
             COALESCE(SUM(GREATEST(-e."priceDifference", 0)), 0)::numeric AS "refundValue",
             COALESCE(SUM(
               (SELECT COALESCE(SUM(ri.quantity), 0)
                  FROM "exchange_return_items" ri
                 WHERE ri."exchangeId" = e.id)
             ), 0)                                                      AS "returnedUnits"
        FROM "exchanges" e
       WHERE e.status = 'COMPLETED'
         AND e."exchangeDate" >= ${f.startDate}
         AND e."exchangeDate" <= ${f.endDate}
         ${f.employeeId ? Prisma.sql`AND e."employeeId" = ${f.employeeId}` : Prisma.empty}
         ${f.customerId ? Prisma.sql`AND e."customerId" = ${f.customerId}` : Prisma.empty}
    `;

    return (
      rows[0] ?? {
        exchangeCount: 0n,
        issuedValue: new Prisma.Decimal(0),
        returnedValue: new Prisma.Decimal(0),
        refundValue: new Prisma.Decimal(0),
        returnedUnits: 0n,
      }
    );
  },

  // ===========================================================================
  // PRODUCT REPORT
  // ===========================================================================

  /**
   * Per-variant sales performance.
   *
   * `sortBy` maps to a whitelisted column expression; the raw value never
   * reaches the SQL text. Returns and exchanges are LATERAL subqueries so a
   * product with no returns still appears (a LEFT JOIN would work too, but
   * would fan out against multi-line exchanges).
   */
  async productPerformance(
    f: ReportFilters,
    options: {
      sortBy: "revenue" | "units" | "profit" | "margin" | "returns" | "exchanges";
      sortOrder: "asc" | "desc";
      limit: number;
      offset: number;
    }
  ) {
    const where = buildItemFilters(f);

    const sortColumn = Prisma.raw(
      {
        revenue: `"revenue"`,
        units: `"unitsSold"`,
        profit: `"grossProfit"`,
        margin: `"marginPercent"`,
        returns: `"returnedUnits"`,
        exchanges: `"exchangedUnits"`,
      }[options.sortBy]
    );

    return prisma.$queryRaw<
      Array<{
        variantId: string;
        productId: string;
        productName: string;
        sku: string;
        sizeName: string;
        colorName: string;
        categoryName: string | null;
        brandName: string | null;
        unitsSold: bigint;
        revenue: Prisma.Decimal;
        cost: Prisma.Decimal;
        grossProfit: Prisma.Decimal;
        marginPercent: Prisma.Decimal;
        currentStock: number;
        returnedUnits: bigint;
        exchangedUnits: bigint;
        orders: bigint;
        total: bigint;
      }>
    >`
      WITH sold AS (
        SELECT si."variantId"                                          AS "variantId",
               MAX(si."productName")                                   AS "productName",
               MAX(si.sku)                                             AS sku,
               MAX(si."sizeName")                                      AS "sizeName",
               MAX(si."colorName")                                     AS "colorName",
               SUM(si.quantity)                                        AS "unitsSold",
               SUM(si."totalPrice")::numeric                           AS revenue,
               SUM(si."costAtSale" * si.quantity)::numeric             AS cost,
               COUNT(DISTINCT si."saleId")                             AS orders
          FROM "sale_items" si
          JOIN "sales" s ON s.id = si."saleId"
          JOIN "product_variants" v ON v.id = si."variantId"
          JOIN "products" p ON p.id = v."productId"
         WHERE ${where}
         GROUP BY si."variantId"
      )
      SELECT sold."variantId",
             p.id                                                      AS "productId",
             sold."productName",
             sold.sku,
             sold."sizeName",
             sold."colorName",
             c.name                                                    AS "categoryName",
             b.name                                                    AS "brandName",
             sold."unitsSold",
             sold.revenue,
             sold.cost,
             (sold.revenue - sold.cost)                                AS "grossProfit",
             CASE WHEN sold.revenue = 0 THEN 0
                  ELSE ROUND(((sold.revenue - sold.cost) / sold.revenue) * 100, 2)
             END                                                       AS "marginPercent",
             v."currentStock",
             COALESCE(ret.units, 0)                                    AS "returnedUnits",
             COALESCE(exc.units, 0)                                    AS "exchangedUnits",
             sold.orders,
             COUNT(*) OVER ()                                          AS total
        FROM sold
        JOIN "product_variants" v ON v.id = sold."variantId"
        JOIN "products" p ON p.id = v."productId"
        LEFT JOIN "categories" c ON c.id = p."categoryId"
        LEFT JOIN "brands" b ON b.id = p."brandId"
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(ri.quantity), 0) AS units
            FROM "exchange_return_items" ri
            JOIN "exchanges" e ON e.id = ri."exchangeId"
           WHERE ri."variantId" = sold."variantId"
             AND e.status = 'COMPLETED'
             AND e."exchangeDate" >= ${f.startDate}
             AND e."exchangeDate" <= ${f.endDate}
        ) ret ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(ii.quantity), 0) AS units
            FROM "exchange_issued_items" ii
            JOIN "exchanges" e ON e.id = ii."exchangeId"
           WHERE ii."variantId" = sold."variantId"
             AND e.status = 'COMPLETED'
             AND e."exchangeDate" >= ${f.startDate}
             AND e."exchangeDate" <= ${f.endDate}
        ) exc ON TRUE
       ORDER BY ${sortColumn} ${direction(options.sortOrder)} NULLS LAST
       LIMIT ${options.limit} OFFSET ${options.offset}
    `;
  },

  // ===========================================================================
  // CATEGORY & BRAND REPORTS
  // ===========================================================================

  async categoryPerformance(f: ReportFilters) {
    const where = buildItemFilters(f);

    return prisma.$queryRaw<
      Array<{
        categoryId: string;
        categoryName: string;
        unitsSold: bigint;
        revenue: Prisma.Decimal;
        cost: Prisma.Decimal;
        grossProfit: Prisma.Decimal;
        marginPercent: Prisma.Decimal;
        productCount: bigint;
        orders: bigint;
      }>
    >`
      SELECT c.id                                          AS "categoryId",
             c.name                                        AS "categoryName",
             SUM(si.quantity)                              AS "unitsSold",
             SUM(si."totalPrice")::numeric                 AS revenue,
             SUM(si."costAtSale" * si.quantity)::numeric   AS cost,
             (SUM(si."totalPrice") - SUM(si."costAtSale" * si.quantity))::numeric AS "grossProfit",
             CASE WHEN SUM(si."totalPrice") = 0 THEN 0
                  ELSE ROUND(((SUM(si."totalPrice") - SUM(si."costAtSale" * si.quantity))
                              / SUM(si."totalPrice")) * 100, 2)
             END                                           AS "marginPercent",
             COUNT(DISTINCT p.id)                          AS "productCount",
             COUNT(DISTINCT si."saleId")                   AS orders
        FROM "sale_items" si
        JOIN "sales" s ON s.id = si."saleId"
        JOIN "product_variants" v ON v.id = si."variantId"
        JOIN "products" p ON p.id = v."productId"
        JOIN "categories" c ON c.id = p."categoryId"
       WHERE ${where}
       GROUP BY c.id, c.name
       ORDER BY revenue DESC
    `;
  },

  async brandPerformance(f: ReportFilters) {
    const where = buildItemFilters(f);

    return prisma.$queryRaw<
      Array<{
        brandId: string;
        brandName: string;
        unitsSold: bigint;
        revenue: Prisma.Decimal;
        cost: Prisma.Decimal;
        grossProfit: Prisma.Decimal;
        marginPercent: Prisma.Decimal;
        currentStock: bigint;
        stockValue: Prisma.Decimal;
        productCount: bigint;
      }>
    >`
      WITH sold AS (
        SELECT b.id                                        AS "brandId",
               b.name                                      AS "brandName",
               SUM(si.quantity)                            AS "unitsSold",
               SUM(si."totalPrice")::numeric               AS revenue,
               SUM(si."costAtSale" * si.quantity)::numeric AS cost,
               COUNT(DISTINCT p.id)                        AS "productCount"
          FROM "sale_items" si
          JOIN "sales" s ON s.id = si."saleId"
          JOIN "product_variants" v ON v.id = si."variantId"
          JOIN "products" p ON p.id = v."productId"
          JOIN "brands" b ON b.id = p."brandId"
         WHERE ${where}
         GROUP BY b.id, b.name
      ),
      stock AS (
        SELECT p."brandId"                                          AS "brandId",
               SUM(GREATEST(v."currentStock", 0))                   AS "currentStock",
               SUM(GREATEST(v."currentStock", 0) * v."costPrice")::numeric AS "stockValue"
          FROM "product_variants" v
          JOIN "products" p ON p.id = v."productId"
         WHERE v."isActive" = true AND p."brandId" IS NOT NULL
         GROUP BY p."brandId"
      )
      SELECT sold."brandId",
             sold."brandName",
             sold."unitsSold",
             sold.revenue,
             sold.cost,
             (sold.revenue - sold.cost) AS "grossProfit",
             CASE WHEN sold.revenue = 0 THEN 0
                  ELSE ROUND(((sold.revenue - sold.cost) / sold.revenue) * 100, 2)
             END                        AS "marginPercent",
             COALESCE(stock."currentStock", 0) AS "currentStock",
             COALESCE(stock."stockValue", 0)   AS "stockValue",
             sold."productCount"
        FROM sold
        LEFT JOIN stock ON stock."brandId" = sold."brandId"
       ORDER BY sold.revenue DESC
    `;
  },

  // ===========================================================================
  // CUSTOMER REPORT
  // ===========================================================================

  /**
   * Customer value and frequency.
   *
   * `firstPurchase` is computed over ALL TIME, not over the window, which is
   * what makes "new vs returning" meaningful: a customer whose first-ever
   * purchase falls inside the window is new; one who bought before it is
   * returning. Computing it within the window would label every customer new.
   */
  async customerPerformance(
    f: ReportFilters,
    options: { sortBy: "spend" | "orders" | "recent"; sortOrder: "asc" | "desc"; limit: number; offset: number }
  ) {
    const where = buildSaleFilters(f);

    const sortColumn = Prisma.raw(
      { spend: `"lifetimeSpend"`, orders: `"orderCount"`, recent: `"lastPurchase"` }[options.sortBy]
    );

    return prisma.$queryRaw<
      Array<{
        customerId: string;
        name: string;
        phone: string;
        customerCode: string;
        isWalkIn: boolean;
        orderCount: bigint;
        periodSpend: Prisma.Decimal;
        lifetimeSpend: Prisma.Decimal;
        averageOrderValue: Prisma.Decimal;
        firstPurchase: Date | null;
        lastPurchase: Date | null;
        rewardPoints: number;
        storeCredit: Prisma.Decimal;
        total: bigint;
      }>
    >`
      WITH period AS (
        SELECT s."customerId"                          AS "customerId",
               COUNT(*)                                 AS "orderCount",
               COALESCE(SUM(s."grandTotal"), 0)::numeric AS "periodSpend",
               MAX(s."saleDate")                        AS "lastPurchase"
          FROM "sales" s
         WHERE ${where}
         GROUP BY s."customerId"
      ),
      lifetime AS (
        SELECT s."customerId"                           AS "customerId",
               COALESCE(SUM(s."grandTotal"), 0)::numeric AS "lifetimeSpend",
               MIN(s."saleDate")                         AS "firstPurchase"
          FROM "sales" s
         WHERE s.status = 'COMPLETED'
         GROUP BY s."customerId"
      )
      SELECT c.id                                       AS "customerId",
             c.name                                     AS name,
             c.phone                                    AS phone,
             c."customerCode"                           AS "customerCode",
             c."isWalkIn"                               AS "isWalkIn",
             period."orderCount",
             period."periodSpend",
             COALESCE(lifetime."lifetimeSpend", 0)      AS "lifetimeSpend",
             CASE WHEN period."orderCount" = 0 THEN 0
                  ELSE ROUND(period."periodSpend" / period."orderCount", 2)
             END                                        AS "averageOrderValue",
             lifetime."firstPurchase",
             period."lastPurchase",
             c."rewardPoints",
             c."storeCredit",
             COUNT(*) OVER ()                           AS total
        FROM period
        JOIN "customers" c ON c.id = period."customerId"
        LEFT JOIN lifetime ON lifetime."customerId" = period."customerId"
       ORDER BY ${sortColumn} ${direction(options.sortOrder)} NULLS LAST
       LIMIT ${options.limit} OFFSET ${options.offset}
    `;
  },

  /** New / returning / inactive counts for the customer report header. */
  async customerSegments(f: ReportFilters, inactiveDays: number) {
    const rows = await prisma.$queryRaw<
      Array<{ newCustomers: bigint; returningCustomers: bigint; inactiveCustomers: bigint; totalCustomers: bigint }>
    >`
      WITH first_purchase AS (
        SELECT s."customerId" AS id, MIN(s."saleDate") AS first_at, MAX(s."saleDate") AS last_at
          FROM "sales" s
         WHERE s.status = 'COMPLETED'
         GROUP BY s."customerId"
      ),
      active_in_window AS (
        SELECT DISTINCT s."customerId" AS id
          FROM "sales" s
         WHERE s.status = 'COMPLETED'
           AND s."saleDate" >= ${f.startDate}
           AND s."saleDate" <= ${f.endDate}
      )
      SELECT COUNT(*) FILTER (
               WHERE fp.first_at >= ${f.startDate} AND fp.first_at <= ${f.endDate}
             ) AS "newCustomers",
             COUNT(*) FILTER (
               WHERE aw.id IS NOT NULL AND fp.first_at < ${f.startDate}
             ) AS "returningCustomers",
             COUNT(*) FILTER (
               WHERE fp.last_at < ${f.endDate}::timestamp - (${inactiveDays} || ' days')::interval
             ) AS "inactiveCustomers",
             COUNT(*) AS "totalCustomers"
        FROM first_purchase fp
        LEFT JOIN active_in_window aw ON aw.id = fp.id
    `;

    return (
      rows[0] ?? {
        newCustomers: 0n,
        returningCustomers: 0n,
        inactiveCustomers: 0n,
        totalCustomers: 0n,
      }
    );
  },

  // ===========================================================================
  // EMPLOYEE REPORT
  // ===========================================================================

  async employeePerformance(f: ReportFilters) {
    const where = buildSaleFilters(f);

    return prisma.$queryRaw<
      Array<{
        employeeId: string;
        name: string;
        employeeCode: string;
        role: string;
        orders: bigint;
        revenue: Prisma.Decimal;
        averageBill: Prisma.Decimal;
        discountsGiven: Prisma.Decimal;
        unitsSold: bigint;
        exchanges: bigint;
        exchangeValue: Prisma.Decimal;
        refundValue: Prisma.Decimal;
      }>
    >`
      WITH bills AS (
        SELECT s."employeeId"                            AS "employeeId",
               COUNT(*)                                   AS orders,
               COALESCE(SUM(s."grandTotal"), 0)::numeric  AS revenue,
               COALESCE(SUM(s."discountAmount" + s."manualDiscountAmount"), 0)::numeric AS "discountsGiven"
          FROM "sales" s
         WHERE ${where}
         GROUP BY s."employeeId"
      ),
      units AS (
        SELECT s."employeeId" AS "employeeId", COALESCE(SUM(si.quantity), 0) AS units
          FROM "sale_items" si
          JOIN "sales" s ON s.id = si."saleId"
         WHERE s.status = 'COMPLETED'
           AND s."saleDate" >= ${f.startDate}
           AND s."saleDate" <= ${f.endDate}
         GROUP BY s."employeeId"
      ),
      exch AS (
        SELECT e."employeeId"                                     AS "employeeId",
               COUNT(*)                                            AS exchanges,
               COALESCE(SUM(e."issuedValue"), 0)::numeric          AS "exchangeValue",
               COALESCE(SUM(GREATEST(-e."priceDifference", 0)), 0)::numeric AS "refundValue"
          FROM "exchanges" e
         WHERE e.status = 'COMPLETED'
           AND e."exchangeDate" >= ${f.startDate}
           AND e."exchangeDate" <= ${f.endDate}
         GROUP BY e."employeeId"
      )
      SELECT emp.id                                         AS "employeeId",
             (emp."firstName" || ' ' || emp."lastName")      AS name,
             emp."employeeCode"                              AS "employeeCode",
             emp.role::text                                  AS role,
             COALESCE(bills.orders, 0)                       AS orders,
             COALESCE(bills.revenue, 0)                      AS revenue,
             CASE WHEN COALESCE(bills.orders, 0) = 0 THEN 0
                  ELSE ROUND(bills.revenue / bills.orders, 2)
             END                                             AS "averageBill",
             COALESCE(bills."discountsGiven", 0)             AS "discountsGiven",
             COALESCE(units.units, 0)                        AS "unitsSold",
             COALESCE(exch.exchanges, 0)                     AS exchanges,
             COALESCE(exch."exchangeValue", 0)               AS "exchangeValue",
             COALESCE(exch."refundValue", 0)                 AS "refundValue"
        FROM "employees" emp
        LEFT JOIN bills ON bills."employeeId" = emp.id
        LEFT JOIN units ON units."employeeId" = emp.id
        LEFT JOIN exch  ON exch."employeeId"  = emp.id
       WHERE emp."isActive" = true
         ${f.employeeId ? Prisma.sql`AND emp.id = ${f.employeeId}` : Prisma.empty}
       ORDER BY revenue DESC
    `;
  },

  // ===========================================================================
  // INVENTORY REPORT
  // ===========================================================================

  /**
   * Stock position with velocity.
   *
   * `unitsSold` is measured over `velocityDays` rather than over the report
   * window, because "is this dead stock?" is a question about recent movement,
   * not about whatever date range the user happens to be looking at.
   */
  async inventoryPosition(options: {
    velocityDays: number;
    categoryId?: string | undefined;
    brandId?: string | undefined;
    supplierId?: string | undefined;
    bucket: "ALL" | "LOW" | "OUT" | "OVERSTOCK" | "DEAD" | "FAST" | "SLOW";
    limit: number;
    offset: number;
  }) {
    const since = new Date(Date.now() - options.velocityDays * 86_400_000);

    const filters: Prisma.Sql[] = [Prisma.sql`v."isActive" = true`];
    if (options.categoryId) filters.push(Prisma.sql`p."categoryId" = ${options.categoryId}`);
    if (options.brandId) filters.push(Prisma.sql`p."brandId" = ${options.brandId}`);
    if (options.supplierId) filters.push(Prisma.sql`v."supplierId" = ${options.supplierId}`);

    // Bucket predicates are applied AFTER the velocity aggregate, so they can
    // reference it. Expressed as a HAVING-style outer filter on the CTE.
    const bucketPredicate = {
      ALL: Prisma.sql`TRUE`,
      LOW: Prisma.sql`t."currentStock" > 0 AND t."reorderLevel" IS NOT NULL AND t."currentStock" <= t."reorderLevel"`,
      OUT: Prisma.sql`t."currentStock" <= 0`,
      OVERSTOCK: Prisma.sql`t."maximumStock" IS NOT NULL AND t."currentStock" > t."maximumStock"`,
      DEAD: Prisma.sql`t."unitsSold" = 0 AND t."currentStock" > 0`,
      FAST: Prisma.sql`t."unitsSold" >= 10`,
      SLOW: Prisma.sql`t."unitsSold" > 0 AND t."unitsSold" < 3`,
    }[options.bucket];

    return prisma.$queryRaw<
      Array<{
        variantId: string;
        productName: string;
        sku: string;
        sizeName: string;
        colorName: string;
        categoryName: string | null;
        brandName: string | null;
        supplierName: string | null;
        currentStock: number;
        reorderLevel: number | null;
        maximumStock: number | null;
        costPrice: Prisma.Decimal;
        sellingPrice: Prisma.Decimal;
        stockValue: Prisma.Decimal;
        retailValue: Prisma.Decimal;
        unitsSold: bigint;
        dailyVelocity: Prisma.Decimal;
        daysOfCover: Prisma.Decimal | null;
        lastMovementAt: Date | null;
        total: bigint;
      }>
    >`
      WITH t AS (
        SELECT v.id                                             AS "variantId",
               pr.name                                          AS "productName",
               v.sku                                            AS sku,
               sz.name                                          AS "sizeName",
               cl.name                                          AS "colorName",
               c.name                                           AS "categoryName",
               b.name                                           AS "brandName",
               sup."businessName"                               AS "supplierName",
               v."currentStock"                                 AS "currentStock",
               v."reorderLevel"                                 AS "reorderLevel",
               v."maximumStock"                                 AS "maximumStock",
               v."costPrice"                                    AS "costPrice",
               v."sellingPrice"                                 AS "sellingPrice",
               (GREATEST(v."currentStock", 0) * v."costPrice")::numeric    AS "stockValue",
               (GREATEST(v."currentStock", 0) * v."sellingPrice")::numeric AS "retailValue",
               COALESCE(sold.units, 0)                          AS "unitsSold",
               mv.last_at                                       AS "lastMovementAt"
          FROM "product_variants" v
          JOIN "products" pr ON pr.id = v."productId"
          JOIN "sizes" sz ON sz.id = v."sizeId"
          JOIN "colors" cl ON cl.id = v."colorId"
          JOIN "categories" c ON c.id = pr."categoryId"
          LEFT JOIN "brands" b ON b.id = pr."brandId"
          LEFT JOIN "suppliers" sup ON sup.id = v."supplierId"
          LEFT JOIN LATERAL (
            SELECT COALESCE(SUM(si.quantity), 0) AS units
              FROM "sale_items" si
              JOIN "sales" s ON s.id = si."saleId"
             WHERE si."variantId" = v.id
               AND s.status = 'COMPLETED'
               AND s."saleDate" >= ${since}
          ) sold ON TRUE
          LEFT JOIN LATERAL (
            SELECT MAX(im."createdAt") AS last_at
              FROM "inventory_movements" im
             WHERE im."variantId" = v.id
          ) mv ON TRUE
         WHERE ${Prisma.join(filters, " AND ")}
      )
      SELECT t.*,
             ROUND(t."unitsSold"::numeric / ${options.velocityDays}, 3) AS "dailyVelocity",
             CASE WHEN t."unitsSold" = 0 THEN NULL
                  ELSE ROUND(GREATEST(t."currentStock", 0)::numeric
                             / (t."unitsSold"::numeric / ${options.velocityDays}), 1)
             END                                                        AS "daysOfCover",
             COUNT(*) OVER ()                                           AS total
        FROM t
       WHERE ${bucketPredicate}
       ORDER BY t."stockValue" DESC
       LIMIT ${options.limit} OFFSET ${options.offset}
    `;
  },

  /** Inventory valuation grouped by a dimension. */
  async inventoryValuation(groupBy: "category" | "brand" | "supplier") {
    const dimension = {
      category: Prisma.sql`c.id, c.name`,
      brand: Prisma.sql`b.id, b.name`,
      supplier: Prisma.sql`sup.id, sup."businessName"`,
    }[groupBy];

    const label = {
      category: Prisma.sql`c.id AS "groupId", c.name AS "groupName"`,
      brand: Prisma.sql`b.id AS "groupId", b.name AS "groupName"`,
      supplier: Prisma.sql`sup.id AS "groupId", sup."businessName" AS "groupName"`,
    }[groupBy];

    return prisma.$queryRaw<
      Array<{
        groupId: string | null;
        groupName: string | null;
        variantCount: bigint;
        units: bigint;
        costValue: Prisma.Decimal;
        retailValue: Prisma.Decimal;
        potentialProfit: Prisma.Decimal;
      }>
    >`
      SELECT ${label},
             COUNT(v.id)                                              AS "variantCount",
             COALESCE(SUM(GREATEST(v."currentStock", 0)), 0)          AS units,
             COALESCE(SUM(GREATEST(v."currentStock", 0) * v."costPrice"), 0)::numeric    AS "costValue",
             COALESCE(SUM(GREATEST(v."currentStock", 0) * v."sellingPrice"), 0)::numeric AS "retailValue",
             COALESCE(SUM(GREATEST(v."currentStock", 0) * (v."sellingPrice" - v."costPrice")), 0)::numeric AS "potentialProfit"
        FROM "product_variants" v
        JOIN "products" p ON p.id = v."productId"
        JOIN "categories" c ON c.id = p."categoryId"
        LEFT JOIN "brands" b ON b.id = p."brandId"
        LEFT JOIN "suppliers" sup ON sup.id = v."supplierId"
       WHERE v."isActive" = true AND v."currentStock" > 0
       GROUP BY ${dimension}
       ORDER BY "costValue" DESC
    `;
  },

  /** Stock movement summary by movement type. */
  async inventoryMovementSummary(f: ReportFilters) {
    return prisma.$queryRaw<
      Array<{ type: string; movements: bigint; unitsIn: bigint; unitsOut: bigint }>
    >`
      SELECT im.type::text                                            AS type,
             COUNT(*)                                                  AS movements,
             COALESCE(SUM(GREATEST(im."quantityChanged", 0)), 0)       AS "unitsIn",
             COALESCE(SUM(GREATEST(-im."quantityChanged", 0)), 0)      AS "unitsOut"
        FROM "inventory_movements" im
       WHERE im."createdAt" >= ${f.startDate}
         AND im."createdAt" <= ${f.endDate}
       GROUP BY im.type
       ORDER BY movements DESC
    `;
  },

  // ===========================================================================
  // PURCHASE REPORT
  // ===========================================================================

  async purchaseSummary(f: ReportFilters) {
    const rows = await prisma.$queryRaw<
      Array<{
        purchaseCount: bigint;
        totalCost: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        dueAmount: Prisma.Decimal;
        unitsReceived: bigint;
        pendingDeliveries: bigint;
      }>
    >`
      WITH scoped AS (
        SELECT pu.*
          FROM "purchases" pu
         WHERE pu."purchaseDate" >= ${f.startDate}
           AND pu."purchaseDate" <= ${f.endDate}
           ${f.supplierId ? Prisma.sql`AND pu."supplierId" = ${f.supplierId}` : Prisma.empty}
      )
      SELECT COUNT(*)                                            AS "purchaseCount",
             COALESCE(SUM(scoped."totalAmount"), 0)::numeric      AS "totalCost",
             COALESCE(SUM(scoped."paidAmount"), 0)::numeric       AS "paidAmount",
             COALESCE(SUM(scoped."dueAmount"), 0)::numeric        AS "dueAmount",
             COALESCE((SELECT SUM(pi.quantity) FROM "purchase_items" pi
                        WHERE pi."purchaseId" IN (SELECT id FROM scoped)), 0) AS "unitsReceived",
             COUNT(*) FILTER (WHERE scoped.status IN ('ORDERED', 'PARTIAL', 'DRAFT')) AS "pendingDeliveries"
        FROM scoped
    `;

    return (
      rows[0] ?? {
        purchaseCount: 0n,
        totalCost: new Prisma.Decimal(0),
        paidAmount: new Prisma.Decimal(0),
        dueAmount: new Prisma.Decimal(0),
        unitsReceived: 0n,
        pendingDeliveries: 0n,
      }
    );
  },

  async purchasesBySupplier(f: ReportFilters) {
    return prisma.$queryRaw<
      Array<{
        supplierId: string;
        businessName: string;
        purchaseCount: bigint;
        totalCost: Prisma.Decimal;
        paidAmount: Prisma.Decimal;
        dueAmount: Prisma.Decimal;
        unitsReceived: bigint;
      }>
    >`
      SELECT sup.id                                          AS "supplierId",
             sup."businessName"                              AS "businessName",
             COUNT(*)                                         AS "purchaseCount",
             COALESCE(SUM(pu."totalAmount"), 0)::numeric      AS "totalCost",
             COALESCE(SUM(pu."paidAmount"), 0)::numeric       AS "paidAmount",
             COALESCE(SUM(pu."dueAmount"), 0)::numeric        AS "dueAmount",
             -- Correlated scalar rather than a join to purchase_items: joining
             -- would repeat each purchase once per line and multiply totalCost.
             COALESCE(SUM(
               (SELECT COALESCE(SUM(pi.quantity), 0)
                  FROM "purchase_items" pi WHERE pi."purchaseId" = pu.id)
             ), 0)                                            AS "unitsReceived"
        FROM "purchases" pu
        JOIN "suppliers" sup ON sup.id = pu."supplierId"
       WHERE pu."purchaseDate" >= ${f.startDate}
         AND pu."purchaseDate" <= ${f.endDate}
         ${f.supplierId ? Prisma.sql`AND pu."supplierId" = ${f.supplierId}` : Prisma.empty}
       GROUP BY sup.id, sup."businessName"
       ORDER BY "totalCost" DESC
    `;
  },

  async purchasesByBrand(f: ReportFilters) {
    return prisma.$queryRaw<
      Array<{ brandId: string | null; brandName: string | null; unitsReceived: bigint; totalCost: Prisma.Decimal }>
    >`
      SELECT b.id                                             AS "brandId",
             b.name                                           AS "brandName",
             COALESCE(SUM(pi.quantity), 0)                    AS "unitsReceived",
             COALESCE(SUM(pi."totalPrice"), 0)::numeric       AS "totalCost"
        FROM "purchase_items" pi
        JOIN "purchases" pu ON pu.id = pi."purchaseId"
        JOIN "product_variants" v ON v.id = pi."variantId"
        JOIN "products" p ON p.id = v."productId"
        LEFT JOIN "brands" b ON b.id = p."brandId"
       WHERE pu."purchaseDate" >= ${f.startDate}
         AND pu."purchaseDate" <= ${f.endDate}
         ${f.supplierId ? Prisma.sql`AND pu."supplierId" = ${f.supplierId}` : Prisma.empty}
       GROUP BY b.id, b.name
       ORDER BY "totalCost" DESC
    `;
  },

  async pendingDeliveries(f: ReportFilters) {
    return prisma.purchase.findMany({
      where: {
        status: { in: ["DRAFT", "ORDERED", "PARTIAL"] },
        purchaseDate: { gte: f.startDate, lte: f.endDate },
        ...(f.supplierId ? { supplierId: f.supplierId } : {}),
      },
      select: {
        id: true,
        purchaseNumber: true,
        supplierInvoiceNumber: true,
        purchaseDate: true,
        totalAmount: true,
        status: true,
        supplier: { select: { id: true, businessName: true } },
        _count: { select: { items: true } },
      },
      orderBy: { purchaseDate: "asc" },
      take: 200,
    });
  },

  // ===========================================================================
  // PAYMENT REPORT
  // ===========================================================================

  async paymentBreakdown(f: ReportFilters) {
    const where = buildSaleFilters(f);

    return prisma.$queryRaw<
      Array<{ method: string; amount: Prisma.Decimal; count: bigint; averageTicket: Prisma.Decimal }>
    >`
      SELECT pm.method::text                              AS method,
             COALESCE(SUM(pm.amount), 0)::numeric          AS amount,
             COUNT(*)                                      AS count,
             CASE WHEN COUNT(*) = 0 THEN 0
                  ELSE ROUND(SUM(pm.amount) / COUNT(*), 2)
             END                                           AS "averageTicket"
        FROM "payments" pm
        JOIN "sales" s ON s.id = pm."saleId"
       WHERE pm.status = 'PAID'
         AND ${where}
       GROUP BY pm.method
       ORDER BY amount DESC
    `;
  },

  async paymentSeries(f: ReportFilters, granularity: Granularity) {
    const unit = Prisma.raw(`'${truncUnit(granularity)}'`);
    const where = buildSaleFilters(f);

    return prisma.$queryRaw<
      Array<{ bucket: Date; method: string; amount: Prisma.Decimal }>
    >`
      SELECT date_trunc(${unit}, pm."paidAt")     AS bucket,
             pm.method::text                       AS method,
             COALESCE(SUM(pm.amount), 0)::numeric  AS amount
        FROM "payments" pm
        JOIN "sales" s ON s.id = pm."saleId"
       WHERE pm.status = 'PAID'
         AND ${where}
       GROUP BY 1, 2
       ORDER BY 1 ASC
    `;
  },

  /** Bills settled with more than one tender. */
  async splitPaymentStats(f: ReportFilters) {
    const where = buildSaleFilters(f);

    const rows = await prisma.$queryRaw<
      Array<{ splitCount: bigint; splitValue: Prisma.Decimal; totalBills: bigint }>
    >`
      WITH per_bill AS (
        SELECT s.id, s."grandTotal", COUNT(pm.id) AS legs
          FROM "sales" s
          LEFT JOIN "payments" pm ON pm."saleId" = s.id AND pm.status = 'PAID'
         WHERE ${where}
         GROUP BY s.id, s."grandTotal"
      )
      SELECT COUNT(*) FILTER (WHERE legs > 1)                                    AS "splitCount",
             COALESCE(SUM("grandTotal") FILTER (WHERE legs > 1), 0)::numeric     AS "splitValue",
             COUNT(*)                                                             AS "totalBills"
        FROM per_bill
    `;

    return rows[0] ?? { splitCount: 0n, splitValue: new Prisma.Decimal(0), totalBills: 0n };
  },

  // ===========================================================================
  // RETURN & EXCHANGE REPORT
  // ===========================================================================

  async exchangeList(
    f: ReportFilters,
    options: { limit: number; offset: number }
  ) {
    return prisma.$queryRaw<
      Array<{
        exchangeId: string;
        exchangeNumber: string;
        exchangeDate: Date;
        reason: string | null;
        notes: string | null;
        returnedValue: Prisma.Decimal;
        issuedValue: Prisma.Decimal;
        priceDifference: Prisma.Decimal;
        customerName: string;
        customerPhone: string;
        employeeName: string;
        originalSaleNumber: string;
        returnedUnits: bigint;
        issuedUnits: bigint;
        total: bigint;
      }>
    >`
      SELECT e.id                                            AS "exchangeId",
             e."exchangeNumber"                              AS "exchangeNumber",
             e."exchangeDate"                                AS "exchangeDate",
             e."exchangeReason"                              AS reason,
             e.notes                                         AS notes,
             e."returnedValue"                               AS "returnedValue",
             e."issuedValue"                                 AS "issuedValue",
             e."priceDifference"                             AS "priceDifference",
             cu.name                                         AS "customerName",
             cu.phone                                        AS "customerPhone",
             (emp."firstName" || ' ' || emp."lastName")      AS "employeeName",
             os."saleNumber"                                 AS "originalSaleNumber",
             COALESCE(ri.units, 0)                           AS "returnedUnits",
             COALESCE(ii.units, 0)                           AS "issuedUnits",
             COUNT(*) OVER ()                                AS total
        FROM "exchanges" e
        JOIN "customers" cu ON cu.id = e."customerId"
        JOIN "employees" emp ON emp.id = e."employeeId"
        JOIN "sales" os ON os.id = e."originalSaleId"
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(x.quantity), 0) AS units
            FROM "exchange_return_items" x WHERE x."exchangeId" = e.id
        ) ri ON TRUE
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(x.quantity), 0) AS units
            FROM "exchange_issued_items" x WHERE x."exchangeId" = e.id
        ) ii ON TRUE
       WHERE e.status = 'COMPLETED'
         AND e."exchangeDate" >= ${f.startDate}
         AND e."exchangeDate" <= ${f.endDate}
         ${f.employeeId ? Prisma.sql`AND e."employeeId" = ${f.employeeId}` : Prisma.empty}
         ${f.customerId ? Prisma.sql`AND e."customerId" = ${f.customerId}` : Prisma.empty}
       ORDER BY e."exchangeDate" DESC
       LIMIT ${options.limit} OFFSET ${options.offset}
    `;
  },

  /** Exchange reasons, grouped — the "why are things coming back" view. */
  async exchangeReasons(f: ReportFilters) {
    return prisma.$queryRaw<
      Array<{ reason: string; count: bigint; value: Prisma.Decimal }>
    >`
      SELECT COALESCE(NULLIF(TRIM(e."exchangeReason"), ''), 'Not specified') AS reason,
             COUNT(*)                                                        AS count,
             COALESCE(SUM(e."returnedValue"), 0)::numeric                    AS value
        FROM "exchanges" e
       WHERE e.status = 'COMPLETED'
         AND e."exchangeDate" >= ${f.startDate}
         AND e."exchangeDate" <= ${f.endDate}
         ${f.employeeId ? Prisma.sql`AND e."employeeId" = ${f.employeeId}` : Prisma.empty}
       GROUP BY 1
       ORDER BY count DESC
    `;
  },

  /** Most-returned products. */
  async mostReturnedProducts(f: ReportFilters, limit: number) {
    return prisma.$queryRaw<
      Array<{
        variantId: string;
        productName: string;
        sku: string;
        returnedUnits: bigint;
        returnedValue: Prisma.Decimal;
        exchangeCount: bigint;
      }>
    >`
      SELECT ri."variantId"                                  AS "variantId",
             MAX(pr.name)                                     AS "productName",
             MAX(v.sku)                                       AS sku,
             COALESCE(SUM(ri.quantity), 0)                    AS "returnedUnits",
             COALESCE(SUM(ri."totalValue"), 0)::numeric       AS "returnedValue",
             COUNT(DISTINCT ri."exchangeId")                  AS "exchangeCount"
        FROM "exchange_return_items" ri
        JOIN "exchanges" e ON e.id = ri."exchangeId"
        JOIN "product_variants" v ON v.id = ri."variantId"
        JOIN "products" pr ON pr.id = v."productId"
       WHERE e.status = 'COMPLETED'
         AND e."exchangeDate" >= ${f.startDate}
         AND e."exchangeDate" <= ${f.endDate}
       GROUP BY ri."variantId"
       ORDER BY "returnedUnits" DESC
       LIMIT ${limit}
    `;
  },

  // ===========================================================================
  // GLOBAL SEARCH
  //
  // One query per entity, run in parallel, each capped small. A UNION ALL over
  // five heterogeneous tables would need a lowest-common-denominator column set
  // that loses the fields each result type needs to be useful.
  // ===========================================================================

  async globalSearch(term: string, limit: number) {
    const [invoices, products, customers, suppliers, employees] = await Promise.all([
      prisma.sale.findMany({
        where: {
          OR: [
            { saleNumber: { contains: term, mode: "insensitive" } },
            { invoice: { invoiceNumber: { contains: term, mode: "insensitive" } } },
          ],
        },
        select: {
          id: true,
          saleNumber: true,
          saleDate: true,
          grandTotal: true,
          status: true,
          customer: { select: { name: true, phone: true } },
        },
        take: limit,
        orderBy: { saleDate: "desc" },
      }),

      prisma.productVariant.findMany({
        where: {
          OR: [
            { sku: { contains: term, mode: "insensitive" } },
            { barcode: { contains: term, mode: "insensitive" } },
            { product: { name: { contains: term, mode: "insensitive" } } },
          ],
        },
        select: {
          id: true,
          sku: true,
          barcode: true,
          currentStock: true,
          sellingPrice: true,
          product: { select: { id: true, name: true } },
          size: { select: { name: true } },
          color: { select: { name: true } },
        },
        take: limit,
      }),

      prisma.customer.findMany({
        where: {
          OR: [
            { name: { contains: term, mode: "insensitive" } },
            { phone: { contains: term, mode: "insensitive" } },
            { customerCode: { contains: term, mode: "insensitive" } },
            { email: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { id: true, name: true, phone: true, customerCode: true, rewardPoints: true },
        take: limit,
      }),

      prisma.supplier.findMany({
        where: {
          OR: [
            { businessName: { contains: term, mode: "insensitive" } },
            { phone: { contains: term, mode: "insensitive" } },
            { contactPerson: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { id: true, businessName: true, phone: true, contactPerson: true },
        take: limit,
      }),

      prisma.employee.findMany({
        where: {
          isActive: true,
          OR: [
            { firstName: { contains: term, mode: "insensitive" } },
            { lastName: { contains: term, mode: "insensitive" } },
            { employeeCode: { contains: term, mode: "insensitive" } },
            { phone: { contains: term, mode: "insensitive" } },
          ],
        },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true },
        take: limit,
      }),
    ]);

    return { invoices, products, customers, suppliers, employees };
  },

  // ===========================================================================
  // FILTER OPTION SOURCES
  // ===========================================================================

  async filterOptions() {
    const [categories, brands, suppliers, employees] = await Promise.all([
      prisma.category.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.brand.findMany({
        where: { isActive: true },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      prisma.supplier.findMany({
        where: { isActive: true },
        select: { id: true, businessName: true },
        orderBy: { businessName: "asc" },
      }),
      prisma.employee.findMany({
        where: { isActive: true },
        select: { id: true, firstName: true, lastName: true, employeeCode: true, role: true },
        orderBy: { employeeCode: "asc" },
      }),
    ]);

    return { categories, brands, suppliers, employees };
  },
};
