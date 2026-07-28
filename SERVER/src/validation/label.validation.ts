// =============================================================================
// LABEL ENGINE VALIDATION SCHEMAS
//
// Zod schemas for every Label Engine endpoint. Validation happens at the
// controller boundary so services can trust their inputs.
//
// Bounds are chosen deliberately, not arbitrarily: copies and batch sizes cap
// what a single request can consume, because every label is physical media. A
// typo of "1000" instead of "10" should be rejected, not printed.
// =============================================================================

import { z } from "zod";

import {
  BarcodeSymbology,
  LabelTemplateKind,
  PrinterConnectionType,
  PrinterDriverType,
  PrintJobStatus,
  PrintOutputMode,
  PrintSourceModule,
} from "../../generated/prisma";

// ─── Shared primitives ────────────────────────────────────────────────────────

const cuid = z.string().min(1, "A valid id is required.");

/** Upper bound protects a media roll from a mistyped quantity. */
const copies = z.coerce.number().int().min(1).max(999);

const millimetres = z.coerce.number().min(0).max(500);

const marginsSchema = z.object({
  top: millimetres,
  right: millimetres,
  bottom: millimetres,
  left: millimetres,
});

// ─── Template elements ────────────────────────────────────────────────────────

const labelFieldKey = z.enum([
  "storeName",
  "brand",
  "category",
  "productName",
  "variantName",
  "size",
  "color",
  "sku",
  "barcode",
  "mrp",
  "sellingPrice",
  "discountAmount",
  "discountPercent",
  "batchNumber",
  "manufacturingDate",
  "expiryDate",
  "warehouse",
  "rack",
  "shelf",
  "bin",
  "shelfLocation",
  "currentStock",
  "hsnCode",
  "gstRate",
  "qrValue",
  "rfidTag",
]);

export const labelElementSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum(["text", "barcode", "price", "image", "line", "box", "qr"]),
  x: millimetres,
  y: millimetres,
  width: millimetres.optional(),
  height: millimetres.optional(),
  field: labelFieldKey.optional(),
  text: z.string().max(200).optional(),
  fontSize: z.coerce.number().min(2).max(72).optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  maxLines: z.coerce.number().int().min(1).max(10).optional(),
  letterSpacing: z.coerce.number().min(-2).max(10).optional(),
  symbology: z.enum(BarcodeSymbology).optional(),
  showBarcodeText: z.boolean().optional(),
  strikeThrough: z.boolean().optional(),
  showCurrency: z.boolean().optional(),
  thickness: z.coerce.number().min(0).max(10).optional(),
  filled: z.boolean().optional(),
  hideWhenEmpty: z.boolean().optional(),
});

// ─── Print options ────────────────────────────────────────────────────────────

export const printOptionsSchema = z.object({
  templateId: cuid.nullish(),
  printerId: cuid.nullish(),
  copies: copies.optional(),
  output: z.enum(PrintOutputMode).optional(),
  widthMm: millimetres.optional(),
  heightMm: millimetres.optional(),
  margins: marginsSchema.optional(),
  barcodeSymbology: z.enum(BarcodeSymbology).optional(),
  darkness: z.coerce.number().int().min(0).max(30).optional(),
  printSpeed: z.coerce.number().int().min(1).max(14).optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
});

// ─── Endpoint schemas ─────────────────────────────────────────────────────────

export const previewSchema = z.object({
  variantId: cuid.nullish(),
  templateId: cuid.nullish(),
  sample: z.coerce.boolean().optional(),
  scale: z.coerce.number().min(0.1).max(10).optional(),
  showBoundary: z.coerce.boolean().optional(),
});

export const pdfSchema = z.object({
  variantIds: z.array(cuid).min(1, "Select at least one product.").max(1000),
  templateId: cuid.nullish(),
  copies: copies.optional(),
});

export const printSchema = z.object({
  items: z
    .array(
      z.object({
        variantId: cuid,
        copies: copies.optional(),
      })
    )
    .min(1, "Select at least one product to print.")
    .max(1000, "A single job is limited to 1000 products."),
  source: z.enum(PrintSourceModule).default(PrintSourceModule.MANUAL),
  reason: z.string().max(500).nullish(),
  options: printOptionsSchema.optional(),
});

export const batchPrintSchema = z
  .object({
    variantIds: z.array(cuid).max(1000).optional(),
    filter: z
      .object({
        categoryId: cuid.optional(),
        brandId: cuid.optional(),
        supplierId: cuid.optional(),
        purchaseId: cuid.optional(),
        search: z.string().max(200).optional(),
      })
      .optional(),
    copiesPerLabel: copies.optional(),
    source: z.enum(PrintSourceModule).default(PrintSourceModule.BATCH),
    reason: z.string().max(500).nullish(),
    options: printOptionsSchema.optional(),
  })
  .refine(
    (value) =>
      (value.variantIds && value.variantIds.length > 0) ||
      (value.filter && Object.keys(value.filter).length > 0),
    { message: "Provide either a product selection or a filter." }
  );

export const reprintSchema = z.object({
  reason: z.string().max(500).nullish(),
  options: printOptionsSchema.optional(),
});

export const retrySchema = z.object({
  printerId: cuid.nullish(),
});

export const listJobsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(PrintJobStatus).optional(),
  source: z.enum(PrintSourceModule).optional(),
  printerId: cuid.optional(),
  templateId: cuid.optional(),
  requestedById: cuid.optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  search: z.string().max(200).optional(),
});

// ─── Templates ────────────────────────────────────────────────────────────────

export const templateWriteSchema = z.object({
  code: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9-]+$/, "Code may contain lowercase letters, numbers and hyphens only.")
    .optional(),
  name: z.string().min(2, "Name is required.").max(120),
  description: z.string().max(500).nullish(),
  kind: z.enum(LabelTemplateKind).default(LabelTemplateKind.PRODUCT),
  widthMm: z.coerce.number().min(5, "Label must be at least 5mm wide.").max(500),
  heightMm: z.coerce.number().min(5, "Label must be at least 5mm tall.").max(500),
  margins: marginsSchema.default({ top: 1, right: 1, bottom: 1, left: 1 }),
  elements: z.array(labelElementSchema).max(100),
  barcodeSymbology: z.enum(BarcodeSymbology).default(BarcodeSymbology.EAN13),
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).default(0),
  isActive: z.boolean().default(true),
});

export const templateValidateSchema = z.object({
  widthMm: z.coerce.number().min(1).max(500),
  heightMm: z.coerce.number().min(1).max(500),
  margins: marginsSchema,
  elements: z.array(labelElementSchema).max(100),
});

export const duplicateTemplateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
});

export const listTemplatesSchema = z.object({
  kind: z.enum(LabelTemplateKind).optional(),
  includeInactive: z.coerce.boolean().optional(),
  search: z.string().max(200).optional(),
});

// ─── Printers ─────────────────────────────────────────────────────────────────

export const printerWriteSchema = z
  .object({
    name: z.string().min(2, "Printer name is required.").max(120),
    code: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[a-z0-9-]+$/, "Code may contain lowercase letters, numbers and hyphens only.")
      .optional(),
    connection: z.enum(PrinterConnectionType).default(PrinterConnectionType.NETWORK),
    driver: z.enum(PrinterDriverType).default(PrinterDriverType.ESC_POS),
    host: z.string().max(255).nullish(),
    port: z.coerce.number().int().min(1).max(65535).nullish(),
    devicePath: z.string().max(255).nullish(),
    vendorId: z.string().max(32).nullish(),
    productId: z.string().max(32).nullish(),
    endpointUrl: z.string().url().max(500).nullish(),
    location: z.string().max(120).nullish(),
    dpi: z.coerce.number().int().min(96).max(1200).default(203),
    defaultWidthMm: millimetres.default(50),
    defaultHeightMm: millimetres.default(25),
    darkness: z.coerce.number().int().min(0).max(30).default(8),
    printSpeed: z.coerce.number().int().min(1).max(14).default(4),
    isDefault: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  // A network printer without a host can never print. Catching it here gives
  // the user an actionable message at save time instead of a failed job later.
  .refine(
    (value) => value.connection !== PrinterConnectionType.NETWORK || !!value.host,
    { message: "A network printer requires a host address.", path: ["host"] }
  )
  .refine(
    (value) => value.connection !== PrinterConnectionType.CLOUD || !!value.endpointUrl,
    { message: "A cloud printer requires an endpoint URL.", path: ["endpointUrl"] }
  );

/**
 * Update schema — every field optional (PATCH semantics).
 *
 * Declared as its own object rather than `printerWriteSchema.partial()`:
 * printerWriteSchema is a ZodEffects (it carries .refine cross-field rules),
 * and ZodEffects has no .partial(). The connection/host consistency rules are
 * re-checked in the service against the MERGED record, which is the only place
 * they can be evaluated correctly for a partial update anyway — a PATCH that
 * changes only `connection` must be validated against the existing host.
 */
export const printerUpdateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  connection: z.enum(PrinterConnectionType).optional(),
  driver: z.enum(PrinterDriverType).optional(),
  host: z.string().max(255).nullish(),
  port: z.coerce.number().int().min(1).max(65535).nullish(),
  devicePath: z.string().max(255).nullish(),
  vendorId: z.string().max(32).nullish(),
  productId: z.string().max(32).nullish(),
  endpointUrl: z.string().url().max(500).nullish(),
  location: z.string().max(120).nullish(),
  dpi: z.coerce.number().int().min(96).max(1200).optional(),
  defaultWidthMm: millimetres.optional(),
  defaultHeightMm: millimetres.optional(),
  darkness: z.coerce.number().int().min(0).max(30).optional(),
  printSpeed: z.coerce.number().int().min(1).max(14).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ─── Settings ─────────────────────────────────────────────────────────────────

export const printerSettingsSchema = z.object({
  defaultPrinterId: cuid.nullish(),
  defaultTemplateId: cuid.nullish(),
  defaultCopies: copies.optional(),
  defaultWidthMm: millimetres.optional(),
  defaultHeightMm: millimetres.optional(),
  marginTopMm: millimetres.optional(),
  marginRightMm: millimetres.optional(),
  marginBottomMm: millimetres.optional(),
  marginLeftMm: millimetres.optional(),
  orientation: z.enum(["portrait", "landscape"]).optional(),
  darkness: z.coerce.number().int().min(0).max(30).optional(),
  printSpeed: z.coerce.number().int().min(1).max(14).optional(),
  barcodeSymbology: z.enum(BarcodeSymbology).optional(),
  showPreviewBeforePrint: z.boolean().optional(),
  printAfterProductCreate: z.boolean().optional(),
  printAfterPurchase: z.boolean().optional(),
  outputMode: z.enum(PrintOutputMode).optional(),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type PreviewInput = z.infer<typeof previewSchema>;
export type PdfInput = z.infer<typeof pdfSchema>;
export type PrintInput = z.infer<typeof printSchema>;
export type BatchPrintInput = z.infer<typeof batchPrintSchema>;
export type ReprintInput = z.infer<typeof reprintSchema>;
export type ListJobsInput = z.infer<typeof listJobsSchema>;
export type TemplateWriteInput = z.infer<typeof templateWriteSchema>;
export type PrinterWriteInput = z.infer<typeof printerWriteSchema>;
export type PrinterUpdateInput = z.infer<typeof printerUpdateSchema>;
export type PrinterSettingsInput = z.infer<typeof printerSettingsSchema>;

export const labelValidation = {
  preview: previewSchema,
  printOptions: printOptionsSchema,
  pdf: pdfSchema,
  print: printSchema,
  batchPrint: batchPrintSchema,
  reprint: reprintSchema,
  retry: retrySchema,
  listJobs: listJobsSchema,
  templateWrite: templateWriteSchema,
  templateValidate: templateValidateSchema,
  duplicateTemplate: duplicateTemplateSchema,
  listTemplates: listTemplatesSchema,
  printerWrite: printerWriteSchema,
  printerUpdate: printerUpdateSchema,
  printerSettings: printerSettingsSchema,
} as const;
