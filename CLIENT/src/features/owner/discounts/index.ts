/**
 * Owner Discounts feature — public API.
 *
 * The router lazy-imports the page; other modules should not reach into the
 * internals. Effective-price READS are not exported from here — they live in
 * shared/product (both portals consume them). This feature owns the rule WRITES,
 * which are OWNER-only.
 */
export { default as DiscountsPage } from "./pages/DiscountsPage";
export type { DiscountRule, DiscountStatus, DiscountScope } from "./api/discountApi";
