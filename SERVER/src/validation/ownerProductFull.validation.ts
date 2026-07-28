import { z } from "zod";

// =============================================================================
// FULL PRODUCT CREATE VALIDATION  (product creation wizard)
//
// The contract for POST /owner/products/full — a single transactional payload
// that creates a product, all its variants, opening-stock movements, and audit
// in one Prisma transaction. Size/Color are accepted by NAME (the wizard lets
// the owner type new sizes/colors); the service resolves or creates the lookup
// rows. Cross-field money rules (selling >= cost, mrp >= selling) are enforced
// per variant here so bad data never reaches the transaction.
// =============================================================================

const money = z.number().nonnegative("Cannot be negative");

const dimension = z.number().nonnegative().optional().nullable();

const variantSchema = z
  .object({
    // Variant identity (size/color by name; service resolves to lookup rows).
    sizeName: z.string().trim().min(1, "Size is required").max(30),
    colorName: z.string().trim().min(1, "Color is required").max(30),
    colorHex: z.string().trim().max(9).optional().nullable(),

    sku: z.string().trim().min(3, "SKU must be at least 3 chars").max(50),
    barcode: z.string().trim().max(100).optional().nullable(),

    // Per-variant sellability, independent of the parent product's status.
    isActive: z.boolean().default(true),

    // Effective prices. The wizard stores pricing once at product level plus
    // sparse per-variant overrides, and resolves them (override ?? default) on
    // the client before sending; the API receives absolute values per variant.
    //
    // sellingPrice is accepted but treated as an INPUT to derivation, not as a
    // stored value: the server records the discount that produces it and lets
    // the pricing engine write the actual sellingPrice column. When
    // discountType/discountValue are supplied, they win and sellingPrice is
    // recomputed from the MRP.
    costPrice: money,
    sellingPrice: money,
    mrp: money,

    // Base discount for this variant (the bottom rung of the pricing ladder).
    // Optional so existing wizard payloads keep working — when omitted the
    // server back-solves a FLAT discount from (mrp − sellingPrice).
    discountType: z.enum(["PERCENTAGE", "FLAT"]).optional(),
    discountValue: z.number().min(0).optional(),
    isManualPricing: z.boolean().optional(),

    openingStock: z.number().int().min(0).default(0),
    reorderLevel: z.number().int().min(0).default(0),
    maximumStock: z.number().int().min(0).optional().nullable(),

    weight: dimension,
    lengthCm: dimension,
    widthCm: dimension,
    heightCm: dimension,

    warehouse: z.string().trim().max(100).optional().nullable(),
    rack: z.string().trim().max(50).optional().nullable(),
    shelf: z.string().trim().max(50).optional().nullable(),
    bin: z.string().trim().max(50).optional().nullable(),
    shelfLocation: z.string().trim().max(100).optional().nullable(),

    discountAllowed: z.boolean().default(true),
    maxDiscountPct: z.number().min(0).max(100).optional().nullable(),

    supplierId: z.string().cuid().optional().nullable(),
    supplierSku: z.string().trim().max(100).optional().nullable(),
    leadTimeDays: z.number().int().min(0).optional().nullable(),

    imageUrl: z.string().url().optional().nullable(),
  })
  .refine((v) => v.sellingPrice >= v.costPrice, {
    message: "Selling price cannot be lower than cost price.",
    path: ["sellingPrice"],
  })
  .refine((v) => v.mrp >= v.sellingPrice, {
    message: "MRP cannot be lower than selling price.",
    path: ["mrp"],
  });

export const ownerProductFullValidation = {
  create: z
    .object({
      // ── Step 1: Basic info ────────────────────────────────────────────────
      name: z.string().trim().min(3, "Product name must be at least 3 characters").max(100),
      description: z.string().trim().max(2000).optional().nullable(),
      categoryId: z.string().cuid("A category is required"),
      brandId: z.string().cuid().optional().nullable(),
      status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).default("ACTIVE"),

      gender: z.string().trim().max(30).optional().nullable(),
      season: z.string().trim().max(30).optional().nullable(),
      collectionName: z.string().trim().max(50).optional().nullable(),
      fabricMaterial: z.string().trim().max(50).optional().nullable(),
      sleeveType: z.string().trim().max(30).optional().nullable(),
      neckType: z.string().trim().max(30).optional().nullable(),
      fit: z.string().trim().max(30).optional().nullable(),
      pattern: z.string().trim().max(30).optional().nullable(),
      occasion: z.string().trim().max(30).optional().nullable(),
      hsnCode: z.string().trim().max(20).optional().nullable(),
      gstRate: z.number().min(0).max(100).optional().nullable(),
      searchKeywords: z.string().trim().max(500).optional().nullable(),

      // ── Step 2: Images ────────────────────────────────────────────────────
      // Accepts an absolute URL or a same-origin relative path: images uploaded
      // through the wizard are stored by the asset module and referenced as
      // `/api/v1/assets/<id>/download`, which `z.string().url()` rejects. Same
      // rule as the category module's imageUrlSchema.
      imageUrls: z
        .array(
          z
            .string()
            .trim()
            .max(2048)
            .refine(
              (v) => v.startsWith("/") || /^https?:\/\//i.test(v),
              "Each image must be an absolute URL or a relative asset path"
            )
        )
        .max(10, "Maximum 10 images allowed")
        .default([]),

      // ── Steps 4-8: Variants ───────────────────────────────────────────────
      variants: z
        .array(variantSchema)
        .min(1, "At least one variant is required to create a sellable product."),
    })
    .superRefine((data, ctx) => {
      // Duplicate SKU within the payload
      const skus = data.variants.map((v) => v.sku.toLowerCase());
      skus.forEach((sku, i) => {
        if (skus.indexOf(sku) !== i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate SKU "${data.variants[i]!.sku}" in payload.`,
            path: ["variants", i, "sku"],
          });
        }
      });

      // Duplicate barcode within the payload
      const barcodes = data.variants
        .map((v, i) => ({ b: v.barcode?.toLowerCase(), i }))
        .filter((x) => x.b);
      const seen = new Map<string, number>();
      for (const { b, i } of barcodes) {
        if (seen.has(b!)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate barcode "${data.variants[i]!.barcode}" in payload.`,
            path: ["variants", i, "barcode"],
          });
        } else {
          seen.set(b!, i);
        }
      }

      // Duplicate size+color combination within the payload
      const combos = data.variants.map(
        (v) => `${v.sizeName.toLowerCase()}|${v.colorName.toLowerCase()}`
      );
      combos.forEach((combo, i) => {
        if (combos.indexOf(combo) !== i) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate variant combination (${data.variants[i]!.sizeName} / ${data.variants[i]!.colorName}).`,
            path: ["variants", i, "sizeName"],
          });
        }
      });
    }),
} as const;

export type CreateFullProductInput = z.infer<typeof ownerProductFullValidation.create>;
export type FullProductVariantInput = z.infer<typeof variantSchema>;
