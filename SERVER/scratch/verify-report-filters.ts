// =============================================================================
// FILTER-PATH SWEEP — every reports query, with every optional filter applied
//
// An optional predicate is only emitted when its filter is supplied, so an
// alias typo inside one hides until a user touches that filter. That is exactly
// how `p."categoryId"` survived in inventoryPosition (products was aliased
// `pr`), 500ing the Inventory report on every filtered request while the
// unfiltered page looked fine.
//
// This calls each reports function with the filters POPULATED, so those
// conditional branches actually reach Postgres. Non-existent ids are fine —
// the point is that the SQL parses and binds, not that it matches rows.
//
//     npx tsx scratch/verify-report-filters.ts
//
// Read-only.
// =============================================================================

import "dotenv/config";
import { reportsRepository } from "../src/repositories/reports.repository";

const startDate = new Date();
startDate.setFullYear(startDate.getFullYear() - 5);
const endDate = new Date();

/** Every optional filter populated at once, so no branch is skipped. */
const FULL = {
  startDate,
  endDate,
  categoryId: "probe-cat",
  brandId: "probe-brand",
  supplierId: "probe-supplier",
  employeeId: "probe-emp",
  customerId: "probe-cust",
  sku: "PROBE-SKU",
  invoiceNumber: "PROBE-INV",
  paymentMethod: "CASH",
} as never;

const results: Array<[string, boolean, string]> = [];

async function probe(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
    results.push([name, true, ""]);
  } catch (e) {
    const msg = (e as Error).message;
    const short = /Message: `([^`]+)`/.exec(msg)?.[1] ?? msg.split("\n")[0] ?? msg;
    results.push([name, false, short]);
  }
}

async function main() {
  const page = { limit: 10, offset: 0 };

  await probe("salesKpis", () => reportsRepository.salesKpis(FULL));
  await probe("salesSeries", () => reportsRepository.salesSeries(FULL, "day"));
  await probe("returnExchangeTotals", () => reportsRepository.returnExchangeTotals(FULL));
  await probe("productPerformance", () =>
    reportsRepository.productPerformance(FULL, { sortBy: "revenue", sortOrder: "desc", ...page })
  );
  await probe("categoryPerformance", () => reportsRepository.categoryPerformance(FULL));
  await probe("brandPerformance", () => reportsRepository.brandPerformance(FULL));
  await probe("customerPerformance", () =>
    reportsRepository.customerPerformance(FULL, { sortBy: "spend", sortOrder: "desc", ...page })
  );
  await probe("customerSegments", () => reportsRepository.customerSegments(FULL, 90));
  await probe("employeePerformance", () => reportsRepository.employeePerformance(FULL));
  await probe("inventoryValuation", () => reportsRepository.inventoryValuation("category"));
  await probe("inventoryMovementSummary", () => reportsRepository.inventoryMovementSummary(FULL));
  await probe("purchaseSummary", () => reportsRepository.purchaseSummary(FULL));
  await probe("purchasesBySupplier", () => reportsRepository.purchasesBySupplier(FULL));
  await probe("purchasesByBrand", () => reportsRepository.purchasesByBrand(FULL));
  await probe("pendingDeliveries", () => reportsRepository.pendingDeliveries(FULL));
  await probe("paymentBreakdown", () => reportsRepository.paymentBreakdown(FULL));
  await probe("paymentSeries", () => reportsRepository.paymentSeries(FULL, "day"));
  await probe("splitPaymentStats", () => reportsRepository.splitPaymentStats(FULL));
  await probe("exchangeList", () => reportsRepository.exchangeList(FULL, page));
  await probe("exchangeReasons", () => reportsRepository.exchangeReasons(FULL));
  await probe("mostReturnedProducts", () => reportsRepository.mostReturnedProducts(FULL, 10));
  await probe("globalSearch", () => reportsRepository.globalSearch("probe", 10));

  // inventoryPosition: each filter separately, so a typo in one is not masked
  // by another failing first.
  for (const [label, extra] of [
    ["categoryId", { categoryId: "probe-cat" }],
    ["brandId", { brandId: "probe-brand" }],
    ["supplierId", { supplierId: "probe-supplier" }],
    ["all three", { categoryId: "c", brandId: "b", supplierId: "s" }],
  ] as Array<[string, Record<string, string>]>) {
    await probe(`inventoryPosition + ${label}`, () =>
      reportsRepository.inventoryPosition({
        velocityDays: 30, bucket: "ALL", limit: 10, offset: 0, ...extra,
      })
    );
  }

  for (const [name, ok, err] of results) {
    console.log(ok ? `OK   ${name}` : `FAIL ${name} — ${err}`);
  }

  const failed = results.filter(([, ok]) => !ok);
  console.log(
    failed.length === 0
      ? `\n✓ all ${results.length} reports queries execute with every filter applied`
      : `\n✗ ${failed.length}/${results.length} FAILED`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
