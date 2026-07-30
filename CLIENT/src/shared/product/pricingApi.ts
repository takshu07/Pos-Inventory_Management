/**
 * Effective pricing — the shared READ surface for /api/v1/pricing.
 *
 * Lives in shared/product, not under features/owner, because BOTH portals read
 * it: managers may view effective prices (financial fields stripped server-side,
 * `readOnly: true`) while every write lives under /owner/discounts behind
 * requireRole("OWNER"). Putting it here keeps the manager module from importing
 * across into an owner feature.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/axios";

export type DiscountType = "PERCENTAGE" | "FLAT";

/** The engine's full explanation of one variant's price. */
export interface EffectivePrice {
  mrp: number;
  costPrice?: number; // owner-only — stripped for managers
  defaultDiscount: number;
  effectiveDiscount: number;
  effectiveDiscountPct: number;
  sellingPrice: number;
  margin?: number; // owner-only
  profit?: number; // owner-only
  profitPct?: number; // owner-only
  wasClamped: boolean;
  wasCapped: boolean;
  source: {
    tier: "PRODUCT" | "CATEGORY" | "BRAND" | "DEFAULT" | "NONE";
    ruleId: string | null;
    ruleName: string | null;
    type: DiscountType | null;
    value: number | null;
    label: string;
  };
}

export interface ProductPricing {
  productId: string;
  productName: string;
  category: { id: string; name: string } | null;
  brand: { id: string; name: string } | null;
  /** True when the viewer is a manager (financials stripped, no editing). */
  readOnly: boolean;
  variants: Array<{
    variantId: string;
    sku: string;
    isActive: boolean;
    size: string;
    color: string;
    pricing: EffectivePrice | null;
  }>;
}

export const pricingKeys = {
  all: ["pricing"] as const,
  product: (productId: string) => [...pricingKeys.all, "product", productId] as const,
};

export async function fetchProductPricing(productId: string): Promise<ProductPricing> {
  const res = await apiClient.get<any>(`/pricing/product/${productId}`);
  return res.data;
}

/**
 * Effective pricing for one product. Works for managers too — the server
 * decides which financial fields come back, so callers never gate on role.
 */
export function useProductPricing(productId: string | undefined) {
  return useQuery({
    queryKey: pricingKeys.product(productId ?? ""),
    queryFn: () => fetchProductPricing(productId as string),
    enabled: !!productId,
    placeholderData: keepPreviousData,
  });
}
