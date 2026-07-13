import type { Promotion } from "../../generated/prisma";
import type { PricingVariantItem } from "./pricing.engine";
import { Prisma } from "../../generated/prisma";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface PromotionContext {
  items: PricingVariantItem[];
  customerId?: string;
  cartSubtotal: number;
  currentDate: Date;
}

export interface RuleCondition {
  type: "MIN_SPEND" | "MIN_QUANTITY" | "SPECIFIC_PRODUCT" | "SPECIFIC_CATEGORY" | "SPECIFIC_BRAND";
  value: any;
}

export interface RuleAction {
  type: "FLAT_DISCOUNT" | "PERCENT_DISCOUNT" | "FIXED_PRICE" | "FREE_ITEM";
  targetScope: "CART" | "PRODUCT" | "CATEGORY" | "BRAND";
  targetId?: string; 
  value: any;
}

export interface AppliedPromotionAction {
  promotionId: string;
  promotionName: string;
  action: RuleAction;
}

// ============================================================================
// PROMOTION ENGINE
// Single source of truth for "WHAT" promotions apply.
// ============================================================================

export class PromotionEngine {
  /**
   * Evaluates a cart context against a list of active promotions.
   * Resolves conflicts, enforces exclusivity, and generates actionable outputs.
   */
  static evaluate(context: PromotionContext, activePromotions: Promotion[]): AppliedPromotionAction[] {
    const appliedActions: AppliedPromotionAction[] = [];
    
    // Sort promotions by priority descending (highest first)
    const sortedPromotions = [...activePromotions].sort((a, b) => b.priority - a.priority);
    
    let exclusiveTriggered = false;

    for (const promo of sortedPromotions) {
      if (exclusiveTriggered) break; // If an exclusive promotion was applied, stop processing

      // 1. Evaluate Eligibility
      const conditions = (promo.conditions as unknown as RuleCondition[]) || [];
      const isEligible = this.checkConditions(context, conditions);

      if (isEligible) {
        // 2. Extract Actions
        const actions = (promo.actions as unknown as RuleAction[]) || [];
        for (const action of actions) {
          appliedActions.push({
            promotionId: promo.id,
            promotionName: promo.name,
            action
          });
        }

        // 3. Stacking Rules
        if (promo.isExclusive) {
          exclusiveTriggered = true;
        }
      }
    }

    return appliedActions;
  }

  /**
   * Extensible condition evaluator.
   */
  private static checkConditions(context: PromotionContext, conditions: RuleCondition[]): boolean {
    if (!conditions || conditions.length === 0) return true; // No conditions = universally applicable

    return conditions.every(cond => {
      switch (cond.type) {
        case "MIN_SPEND":
          return context.cartSubtotal >= Number(cond.value);
        
        case "MIN_QUANTITY":
          const totalQty = context.items.reduce((sum, item) => sum + item.quantity, 0);
          return totalQty >= Number(cond.value);
          
        case "SPECIFIC_PRODUCT":
          return context.items.some(i => i.productId === cond.value);
          
        case "SPECIFIC_CATEGORY":
          return context.items.some(i => i.categoryId === cond.value);
          
        case "SPECIFIC_BRAND":
          return context.items.some(i => i.brandId === cond.value);
          
        default:
          return false; // Unknown condition, fail safe to prevent accidental discounts
      }
    });
  }
}
