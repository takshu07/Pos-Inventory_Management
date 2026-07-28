// =============================================================================
// LABEL CONTROLLER
//
// Preview, PDF, print, batch, reprint and queue endpoints.
//
// Access here is intentionally broad (MANAGER/CASHIER reach several of these);
// the fine-grained rules — who may batch print, whose jobs a cashier can see —
// live in labelService and are enforced on every call, not just at the route.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import * as labelService from "../services/label.service";
import * as labelIntegrationService from "../services/labelIntegration.service";
import { asyncHandler } from "../utils/asyncHandler";
import { labelValidation } from "../validation/label.validation";

/** The authenticated actor, as the service layer expects it. */
function actorFrom(req: Request) {
  return { id: req.user.id, role: req.user.role };
}

// ─── Preview ──────────────────────────────────────────────────────────────────

export const preview = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.preview.parse({ ...req.query, ...req.body });
  const data = await labelService.previewLabel(input, actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Label preview generated.",
    data,
  });
});

/**
 * Serves the preview as a raw SVG document.
 *
 * Lets an <img>/<object> point straight at the endpoint, which the batch
 * preview grid uses to render many labels without inlining megabytes of markup
 * into one JSON response.
 */
export const previewSvg = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.preview.parse(req.query);
  const data = await labelService.previewLabel(input, actorFrom(req));

  res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
  // Previews reflect live pricing, so they must not be cached by the browser.
  res.setHeader("Cache-Control", "no-store");
  return res.status(HTTP_STATUS.OK).send(data.svg);
});

// ─── PDF ──────────────────────────────────────────────────────────────────────

export const generatePdf = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.pdf.parse(req.body);
  const result = await labelService.generatePdf(input, actorFrom(req));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${result.filename}"`);
  res.setHeader("Content-Length", String(result.buffer.length));
  // Surface non-fatal issues (e.g. a variant with no barcode) without
  // corrupting the binary body.
  if (result.warnings.length > 0) {
    res.setHeader("X-Label-Warnings", encodeURIComponent(result.warnings.join(" | ")));
  }

  return res.status(HTTP_STATUS.OK).send(result.buffer);
});

// ─── Printing ─────────────────────────────────────────────────────────────────

export const print = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.print.parse(req.body);
  const job = await labelService.enqueuePrintJob(input, actorFrom(req));

  // 202 Accepted, not 200: the job is queued, not yet printed. The client
  // polls the queue for the outcome.
  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Print job ${job.jobNumber} queued (${job.totalCopies} label${job.totalCopies === 1 ? "" : "s"}).`,
    data: job,
  });
});

export const printBatch = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.batchPrint.parse(req.body);
  const job = await labelService.enqueueBatchPrintJob(input, actorFrom(req));

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Batch print job ${job.jobNumber} queued (${job.totalCopies} labels).`,
    data: job,
  });
});

export const reprint = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.reprint.parse(req.body ?? {});
  const job = await labelService.reprintJob(
    req.params["id"] as string,
    actorFrom(req),
    input.options ?? {},
    input.reason ?? null
  );

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Reprint queued as job ${job.jobNumber}.`,
    data: job,
  });
});

// ─── Module-scoped printing ───────────────────────────────────────────────────

export const printProduct = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    variantIds?: string[];
    copies?: number;
    reason?: string | null;
    options?: Record<string, unknown>;
  };

  const job = await labelIntegrationService.printProductLabels(
    req.params["productId"] as string,
    actorFrom(req),
    {
      ...(body.variantIds !== undefined && { variantIds: body.variantIds }),
      ...(body.copies !== undefined && { copies: body.copies }),
      ...(body.reason !== undefined && { reason: body.reason }),
      ...(body.options !== undefined && {
        // printOptions (template/printer/copies/output), NOT the settings
        // singleton — a per-request override must never touch stored defaults.
        printOptions: labelValidation.printOptions.parse(body.options),
      }),
    }
  );

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Product labels queued as job ${job.jobNumber}.`,
    data: job,
  });
});

export const printPurchase = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { singlePerVariant?: boolean; reason?: string | null };

  const job = await labelIntegrationService.printPurchaseLabels(
    req.params["purchaseId"] as string,
    actorFrom(req),
    {
      ...(body.singlePerVariant !== undefined && {
        singlePerVariant: body.singlePerVariant,
      }),
      ...(body.reason !== undefined && { reason: body.reason }),
    }
  );

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Purchase labels queued as job ${job.jobNumber} (${job.totalCopies} labels).`,
    data: job,
  });
});

export const printInventory = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as {
    variantIds: string[];
    reason?: labelIntegrationService.InventoryPrintReason;
    copies?: number;
  };

  const job = await labelIntegrationService.printInventoryLabels(
    body.variantIds ?? [],
    actorFrom(req),
    body.reason ?? "RELABEL",
    { ...(body.copies !== undefined && { copies: body.copies }) }
  );

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Inventory labels queued as job ${job.jobNumber}.`,
    data: job,
  });
});

export const printFromSearch = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { variantIds: string[]; copies?: number };

  const job = await labelIntegrationService.printFromSearch(
    body.variantIds ?? [],
    actorFrom(req),
    { ...(body.copies !== undefined && { copies: body.copies }) }
  );

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Labels queued as job ${job.jobNumber}.`,
    data: job,
  });
});

// ─── Queue ────────────────────────────────────────────────────────────────────

export const listJobs = asyncHandler(async (req: Request, res: Response) => {
  const query = labelValidation.listJobs.parse(req.query);
  const data = await labelService.listJobs(query, actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Print jobs retrieved.",
    data,
  });
});

export const getJob = asyncHandler(async (req: Request, res: Response) => {
  const data = await labelService.getJob(req.params["id"] as string, actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Print job retrieved.",
    data,
  });
});

export const getQueue = asyncHandler(async (req: Request, res: Response) => {
  const data = await labelService.getActiveQueue(actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Print queue retrieved.",
    data,
  });
});

export const getQueueStats = asyncHandler(async (req: Request, res: Response) => {
  const data = await labelService.getQueueStats(actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Queue statistics retrieved.",
    data,
  });
});

export const cancelJob = asyncHandler(async (req: Request, res: Response) => {
  const data = await labelService.cancelJob(req.params["id"] as string, actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Print job ${data.jobNumber} cancelled.`,
    data,
  });
});

export const retryJob = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.retry.parse(req.body ?? {});
  const data = await labelService.retryJob(
    req.params["id"] as string,
    actorFrom(req),
    input.printerId ?? null
  );

  return res.status(HTTP_STATUS.ACCEPTED).json({
    success: true,
    message: `Print job ${data.jobNumber} re-queued.`,
    data,
  });
});

// ─── History (OWNER) ──────────────────────────────────────────────────────────

export const getHistory = asyncHandler(async (req: Request, res: Response) => {
  const query = labelValidation.listJobs.parse(req.query);
  const data = await labelService.getHistory(query, actorFrom(req));

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Print history retrieved.",
    data,
  });
});
