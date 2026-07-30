/**
 * Label Engine — transport layer.
 *
 * Talks to /api/v1/labels (operational: preview, print, queue — all roles) and
 * /api/v1/owner/labels (administration: templates, printers, settings, history
 * — OWNER only). baseURL already includes /api/v1.
 *
 * ENVELOPE HANDLING: the axios response interceptor returns `response.data` —
 * i.e. the whole { success, message, data } envelope, NOT the payload. Every
 * function here therefore goes through `unwrap()` to reach the actual value.
 * A paginated endpoint yields `{ data: [...], meta: {...} }` from inside that
 * envelope, so those are unwrapped as `Paginated<T>`.
 *
 * On error the interceptor rejects with a FLAT Error carrying the server's
 * message (plus `status` and any structured `details`) — never an axios error
 * object. Callers read `error.message`, not `error.response.data.message`.
 *
 * Every endpoint here is enforced server-side. The frontend permission helpers
 * are a convenience; the 403 from the backend is the real boundary.
 */

import { apiClient } from "@/lib/api/axios";

/**
 * The server's response envelope.
 *
 * The axios interceptor returns `response.data`, so what a call resolves to is
 * this envelope — not the payload. Axios's own generics describe the
 * PRE-interceptor shape and are therefore wrong here, which is why every call
 * below goes through {@link unwrap} rather than annotating apiClient directly.
 */
interface Envelope<T> {
  success: boolean;
  message: string;
  data: T;
}

/** Awaits a request and returns the payload from inside the envelope. */
async function unwrap<T>(request: Promise<unknown>): Promise<T> {
  const envelope = (await request) as Envelope<T>;
  return envelope.data;
}

// ── Enums (mirror the Prisma enums exactly) ──────────────────────────────────

export type BarcodeSymbology =
  | "EAN13"
  | "CODE128"
  | "CODE39"
  | "UPC"
  | "ITF14"
  | "QR"
  | "DATA_MATRIX"
  | "NONE";

export type LabelTemplateKind =
  | "PRODUCT"
  | "BARCODE_ONLY"
  | "PRICE_TAG"
  | "SALE_TAG"
  | "CLEARANCE_TAG"
  | "SHELF_LABEL"
  | "WAREHOUSE_LABEL"
  | "QR_LABEL"
  | "RFID_TAG"
  | "CUSTOM";

export type PrinterConnectionType =
  | "NETWORK"
  | "USB"
  | "BLUETOOTH"
  | "CLOUD"
  | "VIRTUAL";

export type PrinterDriverType =
  | "ESC_POS"
  | "TSPL"
  | "ZPL"
  | "DYMO"
  | "PDF"
  | "PREVIEW"
  | "NULL";

export type PrinterStatus = "ONLINE" | "OFFLINE" | "ERROR" | "UNKNOWN";

export type PrintJobStatus =
  | "QUEUED"
  | "PENDING"
  | "PRINTING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type PrintJobItemStatus =
  | "PENDING"
  | "PRINTING"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type PrintSourceModule =
  | "PRODUCT"
  | "PURCHASE"
  | "INVENTORY"
  | "SALE"
  | "SEARCH"
  | "BATCH"
  | "MANUAL";

export type PrintOutputMode = "PREVIEW" | "PDF" | "THERMAL";

// ── Entities ─────────────────────────────────────────────────────────────────

export interface LabelElement {
  id: string;
  type: "text" | "barcode" | "price" | "image" | "line" | "box" | "qr";
  x: number;
  y: number;
  width?: number;
  height?: number;
  field?: string;
  text?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  maxLines?: number;
  letterSpacing?: number;
  symbology?: BarcodeSymbology;
  showBarcodeText?: boolean;
  strikeThrough?: boolean;
  showCurrency?: boolean;
  thickness?: number;
  filled?: boolean;
  hideWhenEmpty?: boolean;
}

export interface LabelTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  kind: LabelTemplateKind;
  widthMm: string | number;
  heightMm: string | number;
  marginTopMm: string | number;
  marginRightMm: string | number;
  marginBottomMm: string | number;
  marginLeftMm: string | number;
  elements: LabelElement[];
  barcodeSymbology: BarcodeSymbology;
  rotation: number;
  /** System templates cannot be edited or deleted — only cloned. */
  isSystem: boolean;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Printer {
  id: string;
  name: string;
  code: string;
  connection: PrinterConnectionType;
  driver: PrinterDriverType;
  status: PrinterStatus;
  host: string | null;
  port: number | null;
  devicePath: string | null;
  endpointUrl: string | null;
  location: string | null;
  dpi: number;
  defaultWidthMm: string | number;
  defaultHeightMm: string | number;
  darkness: number;
  printSpeed: number;
  isDefault: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  lastErrorAt: string | null;
  lastErrorText: string | null;
}

export interface PrintJobItem {
  id: string;
  variantId: string;
  copies: number;
  status: PrintJobItemStatus;
  failureReason: string | null;
  barcodeValue: string | null;
  barcodeSymbology: BarcodeSymbology;
  sortOrder: number;
  templateId: string | null;
  variant: {
    id: string;
    sku: string;
    barcode: string | null;
    size: { name: string } | null;
    color: { name: string } | null;
    product: { id: string; name: string };
  };
}

export interface PrintJob {
  id: string;
  jobNumber: string;
  status: PrintJobStatus;
  source: PrintSourceModule;
  output: PrintOutputMode;
  reason: string | null;
  totalLabels: number;
  totalCopies: number;
  attempts: number;
  maxAttempts: number;
  failureReason: string | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  createdAt: string;
  reprintOfId: string | null;
  printer: {
    id: string;
    name: string;
    driver: PrinterDriverType;
    connection: PrinterConnectionType;
  } | null;
  template: { id: string; code: string; name: string; kind: LabelTemplateKind };
  requestedBy: { id: string; firstName: string; lastName: string; role: string };
  /** Present on detail responses only. */
  items?: PrintJobItem[];
}

export interface PrinterSettings {
  id: string;
  defaultPrinterId: string | null;
  defaultTemplateId: string | null;
  defaultCopies: number;
  defaultWidthMm: string | number;
  defaultHeightMm: string | number;
  marginTopMm: string | number;
  marginRightMm: string | number;
  marginBottomMm: string | number;
  marginLeftMm: string | number;
  orientation: string;
  darkness: number;
  printSpeed: number;
  barcodeSymbology: BarcodeSymbology;
  showPreviewBeforePrint: boolean;
  printAfterProductCreate: boolean;
  printAfterPurchase: boolean;
  outputMode: PrintOutputMode;
}

export interface PrintOptions {
  templateId?: string | null;
  printerId?: string | null;
  copies?: number;
  output?: PrintOutputMode;
  barcodeSymbology?: BarcodeSymbology;
  darkness?: number;
  printSpeed?: number;
  orientation?: string;
}

export interface PreviewResult {
  svg: string;
  widthMm: number;
  heightMm: number;
  warnings: string[];
  template: { id: string; code: string; name: string };
}

export interface QueueStats {
  counts: Record<PrintJobStatus, number>;
  worker: {
    running: boolean;
    workerId: string;
    currentJobId: string | null;
    processedCount: number;
  };
}

export interface PrinterCapabilities {
  drivers: Array<{
    type: PrinterDriverType;
    displayName: string;
    knownDevices: string[];
    isDocumentDriver: boolean;
  }>;
  transports: Array<{
    kind: string;
    displayName: string;
    isAvailable: boolean;
    unavailableReason: string | null;
  }>;
  symbologies: Array<{
    symbology: BarcodeSymbology;
    displayName: string;
    isTwoDimensional: boolean;
    isImplemented: boolean;
  }>;
}

export interface TemplateIssue {
  elementId: string | null;
  severity: "error" | "warning";
  message: string;
}

export interface Paginated<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
  };
}

// ── Operational endpoints (all roles) ────────────────────────────────────────

export async function fetchPreview(params: {
  variantId?: string | null;
  templateId?: string | null;
  sample?: boolean;
}): Promise<PreviewResult> {
  return unwrap<PreviewResult>(apiClient.get("/labels/preview", { params }));
}

export interface PrintJobParams {
  items: Array<{ variantId: string; copies?: number }>;
  source?: PrintSourceModule;
  reason?: string | null;
  options?: PrintOptions;
}

export async function submitPrintJob(payload: PrintJobParams): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post("/labels/print", payload));
}

export interface BatchPrintParams {
  variantIds?: string[];
  filter?: {
    categoryId?: string;
    brandId?: string;
    supplierId?: string;
    purchaseId?: string;
    search?: string;
  };
  copiesPerLabel?: number;
  source?: PrintSourceModule;
  reason?: string | null;
  options?: PrintOptions;
}

export async function submitBatchPrintJob(payload: BatchPrintParams): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post("/labels/print/batch", payload));
}

export async function reprintJob(
  jobId: string,
  payload: { reason?: string | null; options?: PrintOptions } = {}
): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post(
    `/labels/jobs/${jobId}/reprint`,
    payload
  ));
}

/**
 * Downloads a label PDF.
 *
 * Uses responseType "blob" and bypasses the JSON unwrapping interceptor —
 * the response body is binary, not an envelope.
 */
export async function downloadLabelPdf(payload: {
  variantIds: string[];
  templateId?: string | null;
  copies?: number;
}): Promise<Blob> {
  const response = await apiClient.post("/labels/pdf", payload, {
    responseType: "blob",
    // Overrides the 15s client default: a bulk download resolves up to 1000
    // variants and renders a vector barcode on every page, which legitimately
    // outruns a normal request budget. Aborting early would leave the user with
    // a "timeout" error for work the server went on to finish anyway.
    timeout: 120_000,
  });
  // The interceptor returns response.data for JSON; for a blob response the
  // unwrapped value IS the Blob.
  return response as unknown as Blob;
}

export interface ListJobsParams {
  page?: number;
  limit?: number;
  status?: PrintJobStatus;
  source?: PrintSourceModule;
  printerId?: string;
  templateId?: string;
  requestedById?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

export async function fetchJobs(params: ListJobsParams): Promise<Paginated<PrintJob>> {
  return unwrap<Paginated<PrintJob>>(apiClient.get("/labels/jobs", { params }));
}

export async function fetchJob(jobId: string): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.get(`/labels/jobs/${jobId}`));
}

export async function fetchQueue(): Promise<PrintJob[]> {
  return unwrap<PrintJob[]>(apiClient.get("/labels/queue"));
}

export async function fetchQueueStats(): Promise<QueueStats> {
  return unwrap<QueueStats>(apiClient.get("/labels/queue/stats"));
}

export async function cancelJob(jobId: string): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post(`/labels/jobs/${jobId}/cancel`));
}

export async function retryJob(
  jobId: string,
  printerId?: string | null
): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post(`/labels/jobs/${jobId}/retry`, {
    printerId,
  }));
}

// ── Module-scoped printing ───────────────────────────────────────────────────

export async function printProductLabels(
  productId: string,
  payload: { variantIds?: string[]; copies?: number; reason?: string | null } = {}
): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post(
    `/labels/print/product/${productId}`,
    payload
  ));
}

export async function printPurchaseLabels(
  purchaseId: string,
  payload: { singlePerVariant?: boolean; reason?: string | null } = {}
): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post(
    `/labels/print/purchase/${purchaseId}`,
    payload
  ));
}

export async function printInventoryLabels(payload: {
  variantIds: string[];
  reason?: "REPLACE_DAMAGED" | "MISSING_LABELS" | "RECOUNT" | "RELABEL";
  copies?: number;
}): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post("/labels/print/inventory", payload));
}

export async function printFromSearch(payload: {
  variantIds: string[];
  copies?: number;
}): Promise<PrintJob> {
  return unwrap<PrintJob>(apiClient.post("/labels/print/search", payload));
}

// ── Templates (read is available to all print-capable roles via preview; ─────
//    write endpoints below are OWNER-only and will 403 for others) ───────────

export async function fetchTemplates(params: {
  kind?: LabelTemplateKind;
  includeInactive?: boolean;
  search?: string;
} = {}): Promise<LabelTemplate[]> {
  return unwrap<LabelTemplate[]>(apiClient.get("/owner/labels/templates", { params }));
}

export async function fetchTemplate(id: string): Promise<LabelTemplate> {
  return unwrap<LabelTemplate>(apiClient.get(`/owner/labels/templates/${id}`));
}

export interface TemplateWritePayload {
  code?: string;
  name: string;
  description?: string | null;
  kind: LabelTemplateKind;
  widthMm: number;
  heightMm: number;
  margins: { top: number; right: number; bottom: number; left: number };
  elements: LabelElement[];
  barcodeSymbology: BarcodeSymbology;
  rotation?: number;
  isActive?: boolean;
}

export async function createTemplate(
  payload: TemplateWritePayload
): Promise<{ template: LabelTemplate; warnings: TemplateIssue[] }> {
  return unwrap<{
    template: LabelTemplate;
    warnings: TemplateIssue[];
  }>(apiClient.post("/owner/labels/templates", payload));
}

export async function updateTemplate(
  id: string,
  payload: TemplateWritePayload
): Promise<{ template: LabelTemplate; warnings: TemplateIssue[] }> {
  return unwrap<{
    template: LabelTemplate;
    warnings: TemplateIssue[];
  }>(apiClient.patch(`/owner/labels/templates/${id}`, payload));
}

export async function duplicateTemplate(
  id: string,
  name?: string
): Promise<LabelTemplate> {
  return unwrap<LabelTemplate>(apiClient.post(`/owner/labels/templates/${id}/duplicate`, {
    name,
  }));
}

export async function deleteTemplate(
  id: string
): Promise<{ deleted: boolean; deactivated: boolean }> {
  return unwrap<{
    deleted: boolean;
    deactivated: boolean;
  }>(apiClient.delete(`/owner/labels/templates/${id}`));
}

// ── Printers (OWNER) ─────────────────────────────────────────────────────────

export async function fetchPrinters(includeInactive = false): Promise<Printer[]> {
  return unwrap<Printer[]>(apiClient.get("/owner/labels/printers", {
    params: { includeInactive },
  }));
}

export interface PrinterWritePayload {
  name: string;
  code?: string;
  connection: PrinterConnectionType;
  driver: PrinterDriverType;
  host?: string | null;
  port?: number | null;
  devicePath?: string | null;
  endpointUrl?: string | null;
  location?: string | null;
  dpi?: number;
  defaultWidthMm?: number;
  defaultHeightMm?: number;
  darkness?: number;
  printSpeed?: number;
  isDefault?: boolean;
  isActive?: boolean;
}

export async function createPrinter(payload: PrinterWritePayload): Promise<Printer> {
  return unwrap<Printer>(apiClient.post("/owner/labels/printers", payload));
}

export async function updatePrinter(
  id: string,
  payload: Partial<PrinterWritePayload>
): Promise<Printer> {
  return unwrap<Printer>(apiClient.patch(
    `/owner/labels/printers/${id}`,
    payload
  ));
}

export async function deletePrinter(id: string): Promise<Printer> {
  return unwrap<Printer>(apiClient.delete(`/owner/labels/printers/${id}`));
}

export async function setDefaultPrinter(id: string): Promise<Printer> {
  return unwrap<Printer>(apiClient.post(
    `/owner/labels/printers/${id}/default`
  ));
}

export async function testPrinter(
  id: string
): Promise<{ online: boolean; error?: string; printer: Printer }> {
  return unwrap<{
    online: boolean;
    error?: string;
    printer: Printer;
  }>(apiClient.post(`/owner/labels/printers/${id}/test`));
}

export async function probeAllPrinters(): Promise<
  Array<{ id: string; name: string; online: boolean; error?: string }>
> {
  return unwrap<Array<{ id: string; name: string; online: boolean; error?: string }>>(apiClient.post("/owner/labels/printers/probe"));
}

export async function fetchCapabilities(): Promise<PrinterCapabilities> {
  return unwrap<PrinterCapabilities>(apiClient.get(
    "/owner/labels/printers/capabilities"
  ));
}

// ── Settings (OWNER) ─────────────────────────────────────────────────────────

export async function fetchSettings(): Promise<PrinterSettings> {
  return unwrap<PrinterSettings>(apiClient.get("/owner/labels/settings"));
}

export async function updateSettings(
  payload: Partial<PrinterSettings>
): Promise<PrinterSettings> {
  return unwrap<PrinterSettings>(apiClient.patch(
    "/owner/labels/settings",
    payload
  ));
}

// ── History (OWNER) ──────────────────────────────────────────────────────────

export async function fetchHistory(
  params: ListJobsParams
): Promise<Paginated<PrintJob>> {
  return unwrap<Paginated<PrintJob>>(apiClient.get("/owner/labels/history", { params }));
}
