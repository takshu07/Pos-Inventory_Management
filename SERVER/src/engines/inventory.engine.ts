// =============================================================================
// INVENTORY ENGINE
//
// The pure-computation core of the Inventory module. Everything here is a
// deterministic function of its arguments: no Prisma, no HTTP, no clock reads
// except ones passed in. That is what makes stock arithmetic unit-testable and
// stops the same formula being re-implemented in a service, a report and again
// on the client.
//
// Responsibilities:
//   1. Availability   — what may actually be sold, given holds.
//   2. Valuation      — what the stock is worth, at cost and at retail.
//   3. Reorder        — how much to buy, and when.
//   4. Velocity       — fast / slow / dead classification and ABC ranking.
//   5. Status         — the single definition of "low stock", "out of stock".
//
// What does NOT belong here: database access (repository), request handling
// (controller), or orchestration across repositories (service).
//
// THE INVARIANT THIS MODULE PROTECTS: `ProductVariant.currentStock` is PHYSICAL
// stock — what a person walking the floor would count. Reservations sit beside
// it, never inside it. Every "available" figure is derived, never stored,
// because a stored copy silently drifts the moment a hold expires.
// =============================================================================

// =============================================================================
// AVAILABILITY
// =============================================================================

export interface AvailabilityInput {
  /** Physical stock on the shelf. */
  currentStock: number;
  /** Sum of ACTIVE, unexpired reservations. */
  reservedQuantity?: number;
}

export interface Availability {
  currentStock: number;
  reserved: number;
  /** What the POS may sell right now. Never negative. */
  available: number;
}

/**
 * Sellable quantity.
 *
 * Clamped at zero: reservations exceeding stock is a real (if broken) state —
 * two holds placed against the last unit, say — and reporting −1 available
 * would propagate a negative into every downstream total. Zero is the honest
 * answer to "how many can I sell", and the negative stock alert is what
 * surfaces the underlying problem.
 */
export function computeAvailability(input: AvailabilityInput): Availability {
  const currentStock = input.currentStock;
  const reserved = Math.max(0, input.reservedQuantity ?? 0);

  return {
    currentStock,
    reserved,
    available: Math.max(0, currentStock - reserved),
  };
}

// =============================================================================
// STOCK STATUS
//
// ONE definition, used by the table badge, the dashboard counters, the low
// stock page and the notification trigger. Three screens disagreeing about
// what "low" means is the classic way this feature loses trust.
// =============================================================================

export type StockStatus =
  | "OUT_OF_STOCK"
  | "NEGATIVE"
  | "LOW_STOCK"
  | "OVERSTOCKED"
  | "IN_STOCK";

/** Reorder level to assume when a variant has none configured. */
export const DEFAULT_REORDER_LEVEL = 5;

/**
 * Multiple of the reorder level above which stock is flagged as overstocked.
 * Deliberately generous — capital tied up in stock is a real cost, but calling
 * healthy depth "overstocked" would make the flag noise.
 */
export const OVERSTOCK_MULTIPLE = 10;

export function deriveStockStatus(params: {
  currentStock: number;
  /** Availability, not physical stock, decides whether we can sell. */
  available?: number;
  reorderLevel?: number | null;
}): StockStatus {
  const { currentStock } = params;

  // Negative stock is a DATA problem, not a stock level — it means something
  // wrote past zero. It outranks every other status so it cannot hide inside
  // "out of stock", which looks routine.
  if (currentStock < 0) return "NEGATIVE";

  const available = params.available ?? currentStock;
  if (available <= 0) return "OUT_OF_STOCK";

  const reorderLevel = params.reorderLevel ?? DEFAULT_REORDER_LEVEL;

  if (available <= reorderLevel) return "LOW_STOCK";
  if (reorderLevel > 0 && available >= reorderLevel * OVERSTOCK_MULTIPLE) {
    return "OVERSTOCKED";
  }

  return "IN_STOCK";
}

// =============================================================================
// VALUATION
//
// Average-cost method. `ProductVariant.costPrice` is already maintained as a
// moving average by the purchase module, so this engine consumes it rather
// than recomputing — the purchase module owns cost, inventory owns quantity.
//
// FIFO readiness: every function takes cost as an INPUT rather than reading it,
// so a future FIFO layer table can supply a different cost per lot without any
// signature here changing.
// =============================================================================

export interface ValuationInput {
  quantity: number;
  /** Moving-average unit cost. */
  costPrice: number;
  /** Current selling price, for potential-revenue figures. */
  sellingPrice: number;
}

export interface Valuation {
  quantity: number;
  /** quantity × cost — what the stock cost us. */
  stockValue: number;
  /** quantity × selling price — what it would fetch if it all sold. */
  retailValue: number;
  /** retailValue − stockValue. */
  potentialProfit: number;
  /** Margin as a percentage of retail. 0 when there is no retail value. */
  marginPercentage: number;
}

export function computeValuation(input: ValuationInput): Valuation {
  // Negative stock must not produce a negative asset value — it is a data
  // error, and valuing it would put a phantom credit on the balance sheet.
  const quantity = Math.max(0, input.quantity);

  const stockValue = round2(quantity * input.costPrice);
  const retailValue = round2(quantity * input.sellingPrice);
  const potentialProfit = round2(retailValue - stockValue);

  return {
    quantity,
    stockValue,
    retailValue,
    potentialProfit,
    marginPercentage: retailValue > 0 ? round2((potentialProfit / retailValue) * 100) : 0,
  };
}

/** Sums many line valuations into one total. */
export function sumValuations(items: Valuation[]): Valuation {
  const totals = items.reduce(
    (acc, v) => ({
      quantity: acc.quantity + v.quantity,
      stockValue: acc.stockValue + v.stockValue,
      retailValue: acc.retailValue + v.retailValue,
      potentialProfit: acc.potentialProfit + v.potentialProfit,
    }),
    { quantity: 0, stockValue: 0, retailValue: 0, potentialProfit: 0 }
  );

  return {
    quantity: totals.quantity,
    stockValue: round2(totals.stockValue),
    retailValue: round2(totals.retailValue),
    potentialProfit: round2(totals.potentialProfit),
    marginPercentage:
      totals.retailValue > 0
        ? round2((totals.potentialProfit / totals.retailValue) * 100)
        : 0,
  };
}

/**
 * Moving-average cost after receiving new stock.
 *
 * Exposed here so the formula is testable and stated once, even though the
 * purchase module is what applies it. Receiving 10 @ ₹100 onto 5 @ ₹80 gives
 * (5×80 + 10×100) / 15 = ₹93.33.
 */
export function movingAverageCost(params: {
  existingQuantity: number;
  existingCost: number;
  incomingQuantity: number;
  incomingCost: number;
}): number {
  const existingQty = Math.max(0, params.existingQuantity);
  const totalQuantity = existingQty + params.incomingQuantity;

  // Receiving nothing onto nothing leaves cost undefined; keeping the incoming
  // cost is the only non-arbitrary answer.
  if (totalQuantity <= 0) return round2(params.incomingCost);

  const totalValue =
    existingQty * params.existingCost + params.incomingQuantity * params.incomingCost;

  return round2(totalValue / totalQuantity);
}

// =============================================================================
// REORDER
// =============================================================================

/** Days of cover to hold as a buffer against demand spikes and late deliveries. */
export const DEFAULT_SAFETY_DAYS = 7;

/** Assumed supplier lead time when none is recorded. */
export const DEFAULT_LEAD_TIME_DAYS = 7;

export interface ReorderInput {
  currentStock: number;
  reserved?: number | undefined;
  /** Units sold per day over the analysis window. */
  averageDailySales: number;
  /** Supplier lead time in days. */
  leadTimeDays?: number | undefined;
  /** Days of safety stock to carry. */
  safetyDays?: number | undefined;
  reorderLevel?: number | null | undefined;
}

export interface ReorderSuggestion {
  available: number;
  averageDailySales: number;
  leadTimeDays: number;
  /** Units expected to sell before a replenishment could arrive. */
  leadTimeDemand: number;
  safetyStock: number;
  /** Stock level at which an order should be placed. */
  reorderPoint: number;
  /** How many units to order. 0 when no order is needed. */
  recommendedQuantity: number;
  /**
   * Days until stock runs out at the current rate. NULL when nothing is
   * selling — "infinite days of cover" is meaningless and must not render as a
   * large number that looks like healthy supply.
   */
  daysRemaining: number | null;
  shouldReorder: boolean;
}

/**
 * How much to buy, and whether to buy now.
 *
 * Standard reorder-point model: cover demand over the lead time, plus a safety
 * buffer. Deliberately NOT a forecast — it extrapolates observed sales, which
 * is honest about being a heuristic and leaves room for a forecasting engine
 * later without changing this contract.
 */
export function computeReorder(input: ReorderInput): ReorderSuggestion {
  const available = Math.max(0, input.currentStock - (input.reserved ?? 0));
  const dailySales = Math.max(0, input.averageDailySales);
  const leadTimeDays = input.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS;
  const safetyDays = input.safetyDays ?? DEFAULT_SAFETY_DAYS;

  const leadTimeDemand = Math.ceil(dailySales * leadTimeDays);
  const safetyStock = Math.ceil(dailySales * safetyDays);

  // The configured reorder level acts as a FLOOR: an owner who set it to 20
  // means "never let this drop below 20", even if sales maths suggests less.
  const computedPoint = leadTimeDemand + safetyStock;
  const reorderPoint = Math.max(computedPoint, input.reorderLevel ?? 0);

  const shouldReorder = available <= reorderPoint;

  // Order back up to the reorder point, never a negative quantity.
  const recommendedQuantity = shouldReorder ? Math.max(0, reorderPoint - available) : 0;

  return {
    available,
    averageDailySales: round2(dailySales),
    leadTimeDays,
    leadTimeDemand,
    safetyStock,
    reorderPoint,
    recommendedQuantity,
    daysRemaining: dailySales > 0 ? round1(available / dailySales) : null,
    shouldReorder,
  };
}

// =============================================================================
// VELOCITY — fast / slow / dead
// =============================================================================

export type StockVelocity = "FAST_MOVING" | "NORMAL" | "SLOW_MOVING" | "DEAD_STOCK";

/** Days without a sale beyond which stock is considered dead. */
export const DEAD_STOCK_DAYS = 90;

/** Units per day at or above which an item is fast moving. */
export const FAST_MOVING_DAILY_SALES = 1;

/** Units per day at or below which an item is slow moving (but not dead). */
export const SLOW_MOVING_DAILY_SALES = 0.1;

export interface VelocityInput {
  /** Units sold in the analysis window. */
  unitsSold: number;
  /** Length of that window, in days. */
  windowDays: number;
  /** Days since the last sale. NULL when the item has never sold. */
  daysSinceLastSale: number | null;
  /** Items with no stock are excluded from dead-stock classification. */
  currentStock: number;
}

/**
 * Classifies how fast stock is moving.
 *
 * Dead stock is judged on TIME SINCE THE LAST SALE rather than on units sold,
 * because those answer different questions: an item that sold 50 units and then
 * nothing for four months is dead despite a healthy total, and that is exactly
 * the case a units-based rule would miss.
 *
 * Items with zero stock are never "dead" — you cannot fail to sell what you do
 * not have, and flagging them would fill the report with things to reorder
 * rather than things to discount.
 */
export function classifyVelocity(input: VelocityInput): StockVelocity {
  const windowDays = Math.max(1, input.windowDays);
  const dailySales = input.unitsSold / windowDays;

  if (input.currentStock > 0) {
    const neverSold = input.daysSinceLastSale === null;
    const staleForTooLong =
      input.daysSinceLastSale !== null && input.daysSinceLastSale >= DEAD_STOCK_DAYS;

    if (neverSold || staleForTooLong) return "DEAD_STOCK";
  }

  if (dailySales >= FAST_MOVING_DAILY_SALES) return "FAST_MOVING";
  if (dailySales <= SLOW_MOVING_DAILY_SALES) return "SLOW_MOVING";

  return "NORMAL";
}

/**
 * Suggested clearance discount for stagnant stock.
 *
 * Steps rather than a continuous curve: retail discounts are set at round
 * numbers, and a suggestion of "37%" would just be rounded by hand anyway.
 * Capped at 50% — beyond that the decision is whether to write the stock off,
 * which is a judgement call, not a formula.
 */
export function suggestedClearanceDiscount(daysSinceLastSale: number | null): number {
  if (daysSinceLastSale === null) return 50;
  if (daysSinceLastSale >= 180) return 50;
  if (daysSinceLastSale >= 120) return 40;
  if (daysSinceLastSale >= 90) return 30;
  if (daysSinceLastSale >= 60) return 20;
  if (daysSinceLastSale >= 30) return 10;
  return 0;
}

/**
 * Stock turnover ratio — how many times stock sold through in the window.
 *
 * NULL when there is nothing on hand: dividing by zero inventory yields
 * infinity, and an infinite turnover reads as spectacular performance when it
 * actually means the shelf is empty.
 */
export function stockTurnover(params: {
  unitsSold: number;
  averageStock: number;
}): number | null {
  if (params.averageStock <= 0) return null;
  return round2(params.unitsSold / params.averageStock);
}

/**
 * Days of inventory on hand at the observed sales rate.
 * NULL when nothing is selling — see daysRemaining above for the reasoning.
 */
export function daysOfInventory(params: {
  currentStock: number;
  averageDailySales: number;
}): number | null {
  if (params.averageDailySales <= 0) return null;
  return round1(params.currentStock / params.averageDailySales);
}

// =============================================================================
// ABC ANALYSIS
//
// Classic Pareto classification by contribution to revenue. Drives which items
// deserve tight control: A items get counted often, C items rarely.
// =============================================================================

export type AbcClass = "A" | "B" | "C";

/** Cumulative revenue share boundaries for each class. */
export const ABC_THRESHOLDS = { a: 0.8, b: 0.95 } as const;

/**
 * Assigns ABC classes over items already sorted by descending value.
 *
 * Returns a parallel array rather than mutating, so the caller's rows stay
 * immutable and the function is trivially testable.
 */
export function classifyAbc(values: number[]): AbcClass[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);

  // With no revenue at all there is no Pareto curve to cut; everything is C
  // rather than everything being A, which would imply all items are critical.
  if (total <= 0) return values.map(() => "C");

  let cumulative = 0;

  return values.map((value) => {
    cumulative += Math.max(0, value);
    const share = cumulative / total;

    if (share <= ABC_THRESHOLDS.a) return "A";
    if (share <= ABC_THRESHOLDS.b) return "B";
    return "C";
  });
}

// =============================================================================
// INVENTORY ACCURACY
// =============================================================================

/**
 * Count accuracy as a percentage — the headline number from a cycle count.
 *
 * Measured by LINES matching, not units. A count that is off by one unit on one
 * SKU out of a hundred is 99% accurate; measuring by units would let a single
 * large-quantity error swamp a hundred correct lines, or a big correct line
 * hide many small wrong ones.
 */
export function countAccuracy(params: {
  totalCounted: number;
  varianceLines: number;
}): number {
  if (params.totalCounted <= 0) return 100;

  const accurate = Math.max(0, params.totalCounted - params.varianceLines);
  return round1((accurate / params.totalCounted) * 100);
}

// =============================================================================
// HELPERS
// =============================================================================

/** Money and ratios round to 2dp; float drift must never reach a total. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Day counts round to 1dp — "3.5 days of cover" is precise enough. */
function round1(value: number): number {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
