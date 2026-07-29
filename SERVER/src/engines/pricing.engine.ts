import { Prisma, EmployeeRole } from "../../generated/prisma";
import { AppError } from "../errors/AppError";
import { HTTP_STATUS } from "../constants/httpStatus";
import type { AppliedPromotionAction } from "./promotion.engine";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PricingVariantItem {
  variantId: string;
  quantity: number;
  /**
   * The CATALOG shelf price for this item — already resolved by
   * catalogPricing.engine (product/category discount rules applied). This
   * pipeline layers CART-level promotions and tax on top of it; it never
   * re-derives the shelf price itself.
   */
  dbSellingPrice: Prisma.Decimal;
  dbCostPrice: Prisma.Decimal;
  /** MRP, carried through so the sale line can snapshot it. */
  dbMrp?: Prisma.Decimal;
  productId: string;
  categoryId: string;
  brandId: string | null;
}

export interface CalculatedItem {
  variantId: string;
  quantity: number;
  sellingPrice: Prisma.Decimal;
  costAtSale: Prisma.Decimal;
  itemDiscount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalPrice: Prisma.Decimal;
}

export interface PricingContext {
  items: PricingVariantItem[];
  manualDiscountAmountInput: Prisma.Decimal;
  employeeRole: EmployeeRole;
  appliedPromotions: AppliedPromotionAction[];
  taxRateInput: Prisma.Decimal;

  // Mutable State for the Pipeline
  calculatedItems: CalculatedItem[];
  subtotal: Prisma.Decimal;
  totalDiscountAmount: Prisma.Decimal;
  totalTaxAmount: Prisma.Decimal;
  /** Signed adjustment applied to reach a whole-rupee total. See RoundingRule. */
  roundOffAmount: Prisma.Decimal;
  grandTotal: Prisma.Decimal;
}

export interface PricingResult {
  subtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  manualDiscountAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  /**
   * Signed round-off applied to the invoice, in the range (−0.50, +0.50].
   * Negative = rounded down (customer pays less). Present so the invoice can
   * show a "Round Off" line and still reconcile exactly.
   */
  roundOffAmount: Prisma.Decimal;
  /** The final PAYABLE total — already rounded to a whole rupee. */
  grandTotal: Prisma.Decimal;
  /** The pre-rounding total, kept for reporting and reconciliation. */
  grossTotal: Prisma.Decimal;
  calculatedItems: CalculatedItem[];
}

export interface PricingRule {
  execute(ctx: PricingContext): void;
}

import { ConfigurationEngine } from "./configuration.engine";

// ============================================================================
// RULES ENGINE
// ============================================================================

class BasePriceRule implements PricingRule {
  execute(ctx: PricingContext): void {
    ctx.calculatedItems = ctx.items.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      sellingPrice: item.dbSellingPrice,
      costAtSale: item.dbCostPrice,
      itemDiscount: new Prisma.Decimal(0),
      taxRate: new Prisma.Decimal(0),
      taxAmount: new Prisma.Decimal(0),
      totalPrice: item.dbSellingPrice.mul(item.quantity),
    }));

    ctx.subtotal = ctx.calculatedItems.reduce(
      (sum, item) => sum.plus(item.totalPrice),
      new Prisma.Decimal(0)
    );
  }
}

class PromotionExecutionRule implements PricingRule {
  execute(ctx: PricingContext): void {
    if (!ctx.appliedPromotions || ctx.appliedPromotions.length === 0) return;

    ctx.calculatedItems.forEach((calcItem) => {
      const originalItem = ctx.items.find((i) => i.variantId === calcItem.variantId)!;
      let totalItemDiscount = new Prisma.Decimal(0);
      const baseLineTotal = calcItem.sellingPrice.mul(calcItem.quantity);

      for (const promo of ctx.appliedPromotions) {
        const action = promo.action;
        let appliesToThisItem = false;

        // Determine scope applicability
        if (action.targetScope === "CART") appliesToThisItem = true;
        if (action.targetScope === "PRODUCT" && action.targetId === originalItem.productId) appliesToThisItem = true;
        if (action.targetScope === "CATEGORY" && action.targetId === originalItem.categoryId) appliesToThisItem = true;
        if (action.targetScope === "BRAND" && action.targetId === originalItem.brandId) appliesToThisItem = true;

        if (appliesToThisItem) {
          let discountAmount = new Prisma.Decimal(0);
          
          if (action.type === "FLAT_DISCOUNT") {
            // Flat discount spreads over quantity
            discountAmount = new Prisma.Decimal(action.value).mul(calcItem.quantity);
          } else if (action.type === "PERCENT_DISCOUNT") {
            discountAmount = baseLineTotal.mul(action.value).div(100);
          } else if (action.type === "FIXED_PRICE") {
            const newTotal = new Prisma.Decimal(action.value).mul(calcItem.quantity);
            discountAmount = baseLineTotal.minus(newTotal);
          }
          
          totalItemDiscount = totalItemDiscount.plus(discountAmount);
        }
      }

      // Prevent discounting below 0
      if (totalItemDiscount.gt(baseLineTotal)) {
        totalItemDiscount = baseLineTotal;
      }

      calcItem.itemDiscount = calcItem.itemDiscount.plus(totalItemDiscount);
      calcItem.totalPrice = calcItem.totalPrice.minus(totalItemDiscount);
      ctx.totalDiscountAmount = ctx.totalDiscountAmount.plus(totalItemDiscount);
    });

    ctx.subtotal = ctx.calculatedItems.reduce(
      (sum, item) => sum.plus(item.totalPrice),
      new Prisma.Decimal(0)
    );
  }
}

class ManualDiscountRule implements PricingRule {
  execute(ctx: PricingContext): void {
    if (ctx.manualDiscountAmountInput.lte(0)) return;

    if (ctx.manualDiscountAmountInput.gt(ctx.subtotal)) {
      throw new AppError(HTTP_STATUS.BAD_REQUEST, "Manual discount cannot exceed the cart subtotal.");
    }

    const pricingConfig = ConfigurationEngine.getPricingSettings();
    let maxPercent = 0;
    if (ctx.employeeRole === "CASHIER") maxPercent = pricingConfig.cashierDiscountLimit;
    else if (ctx.employeeRole === "MANAGER") maxPercent = pricingConfig.managerDiscountLimit;
    else if (ctx.employeeRole === "OWNER") maxPercent = pricingConfig.ownerDiscountLimit;

    const requestedPercent = ctx.manualDiscountAmountInput.mul(100).div(ctx.subtotal);

    if (requestedPercent.gt(maxPercent)) {
      throw new AppError(
        HTTP_STATUS.FORBIDDEN,
        `Role ${ctx.employeeRole} is not permitted to give a discount of ${requestedPercent.toFixed(2)}%. Max limit is ${maxPercent}%.`
      );
    }

    let remainingManualDiscount = ctx.manualDiscountAmountInput;

    ctx.calculatedItems.forEach((calcItem, index) => {
      if (index === ctx.calculatedItems.length - 1) {
        calcItem.itemDiscount = calcItem.itemDiscount.plus(remainingManualDiscount);
        calcItem.totalPrice = calcItem.totalPrice.minus(remainingManualDiscount);
      } else {
        const proportion = calcItem.totalPrice.div(ctx.subtotal);
        const itemManualDiscount = ctx.manualDiscountAmountInput.mul(proportion).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        calcItem.itemDiscount = calcItem.itemDiscount.plus(itemManualDiscount);
        calcItem.totalPrice = calcItem.totalPrice.minus(itemManualDiscount);
        remainingManualDiscount = remainingManualDiscount.minus(itemManualDiscount);
      }
    });
  }
}

class TaxRule implements PricingRule {
  execute(ctx: PricingContext): void {
    if (ctx.taxRateInput.lte(0)) return;

    ctx.calculatedItems.forEach((calcItem) => {
      calcItem.taxRate = ctx.taxRateInput;
      calcItem.taxAmount = calcItem.totalPrice.mul(ctx.taxRateInput).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      calcItem.totalPrice = calcItem.totalPrice.plus(calcItem.taxAmount);
      
      ctx.totalTaxAmount = ctx.totalTaxAmount.plus(calcItem.taxAmount);
    });
  }
}

/**
 * Final rule in the pipeline. Two distinct jobs, in order:
 *
 *   1. Normalise every LINE to 2 decimal places (paise), so stored line totals
 *      are exact currency values rather than long binary fractions.
 *
 *   2. Round the INVOICE TOTAL to the nearest whole rupee, and record the
 *      signed difference as roundOffAmount.
 *
 * Why whole rupees: a percentage discount routinely produces a total like
 * ₹1000.02, which is not payable — India withdrew sub-rupee coins from
 * practical circulation, so a cashier cannot collect 2 paise and a customer
 * cannot pay it. Rounding here (rather than in the UI) is essential because the
 * server validates payments against grandTotal: if the client rounded on its
 * own, it would submit ₹1000 against a server total of ₹1000.02 and every sale
 * would be rejected as underpaid.
 *
 * Why the adjustment is STORED rather than absorbed: keeping roundOffAmount
 * means the invoice reconciles exactly —
 *   subtotal − discount + tax + roundOff == grandTotal
 * — so the printed document adds up and finance can audit the adjustment.
 * Silently absorbing it produces invoices whose lines do not sum to the total.
 *
 * HALF_UP at the .50 boundary follows the standard retail convention
 * (₹1000.50 → ₹1001), which favours neither party systematically.
 */
class RoundingRule implements PricingRule {
  execute(ctx: PricingContext): void {
    // ── 1. Line-level: normalise to paise ────────────────────────────────────
    ctx.calculatedItems.forEach((calcItem) => {
      calcItem.totalPrice = calcItem.totalPrice.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    });

    // The exact, unrounded invoice total.
    const grossTotal = ctx.calculatedItems
      .reduce((sum, item) => sum.plus(item.totalPrice), new Prisma.Decimal(0))
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // ── 2. Invoice-level: round to the nearest whole rupee ───────────────────
    const payableTotal = grossTotal.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

    // Signed: negative when rounded DOWN (customer pays less than gross).
    // Computed as payable − gross so that gross + roundOff == payable holds by
    // construction, which is what makes the invoice reconcile.
    ctx.roundOffAmount = payableTotal.minus(grossTotal).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    ctx.grandTotal = payableTotal;
  }
}

// ============================================================================
// PIPELINE EXECUTOR
// ============================================================================

export class PricingEngine {
  /**
   * Enterprise Pricing Pipeline.
   * HOW prices are calculated.
   */
  static calculateCheckout(
    items: PricingVariantItem[],
    manualDiscountAmountInput: number | Prisma.Decimal = 0,
    employeeRole: EmployeeRole,
    appliedPromotions: AppliedPromotionAction[] = [],
    taxRateInput: number | Prisma.Decimal = 0
  ): PricingResult {
    const ctx: PricingContext = {
      items,
      manualDiscountAmountInput: new Prisma.Decimal(manualDiscountAmountInput),
      employeeRole,
      appliedPromotions,
      taxRateInput: new Prisma.Decimal(taxRateInput),
      calculatedItems: [],
      subtotal: new Prisma.Decimal(0),
      totalDiscountAmount: new Prisma.Decimal(0),
      totalTaxAmount: new Prisma.Decimal(0),
      roundOffAmount: new Prisma.Decimal(0),
      grandTotal: new Prisma.Decimal(0),
    };

    const pipeline: PricingRule[] = [
      new BasePriceRule(),
      new PromotionExecutionRule(),
      new ManualDiscountRule(),
      new TaxRule(),
      new RoundingRule(),
    ];

    for (const rule of pipeline) {
      rule.execute(ctx);
    }

    return {
      subtotal: ctx.subtotal,
      discountAmount: ctx.totalDiscountAmount,
      manualDiscountAmount: ctx.manualDiscountAmountInput,
      taxAmount: ctx.totalTaxAmount,
      roundOffAmount: ctx.roundOffAmount,
      grandTotal: ctx.grandTotal,
      // grandTotal is the rounded PAYABLE figure; grossTotal is what it was
      // before rounding. Derived rather than stored separately so the two can
      // never drift apart.
      grossTotal: ctx.grandTotal.minus(ctx.roundOffAmount),
      calculatedItems: ctx.calculatedItems,
    };
  }
}
