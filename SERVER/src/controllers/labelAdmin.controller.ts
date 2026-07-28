// =============================================================================
// LABEL ADMIN CONTROLLER  (OWNER only)
//
// Template management, printer management and label settings. Every handler
// here runs only after requireRole("OWNER") at the route layer — a manager or
// cashier calling any of these receives 403 before reaching this file.
// =============================================================================

import type { Request, Response } from "express";

import { HTTP_STATUS } from "../constants/httpStatus";
import { barcodeEngine } from "../engines/label/barcode/barcode.engine";
import * as labelTemplateService from "../services/labelTemplate.service";
import * as printerAdminService from "../services/printerAdmin.service";
import { asyncHandler } from "../utils/asyncHandler";
import { labelValidation } from "../validation/label.validation";

// ─── Templates ────────────────────────────────────────────────────────────────

export const listTemplates = asyncHandler(async (req: Request, res: Response) => {
  const query = labelValidation.listTemplates.parse(req.query);
  const data = await labelTemplateService.listTemplates(query);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Label templates retrieved.",
    data,
  });
});

export const getTemplate = asyncHandler(async (req: Request, res: Response) => {
  const data = await labelTemplateService.getTemplateById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Label template retrieved.",
    data,
  });
});

export const createTemplate = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.templateWrite.parse(req.body);
  const { template, warnings } = await labelTemplateService.createTemplate(
    input,
    req.user.id
  );

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: `Template "${template.name}" created.`,
    data: { template, warnings },
  });
});

export const updateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.templateWrite.parse(req.body);
  const { template, warnings } = await labelTemplateService.updateTemplate(
    req.params["id"] as string,
    input,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Template "${template.name}" updated.`,
    data: { template, warnings },
  });
});

export const duplicateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.duplicateTemplate.parse(req.body ?? {});
  const template = await labelTemplateService.duplicateTemplate(
    req.params["id"] as string,
    req.user.id,
    input.name
  );

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: `Template duplicated as "${template.name}".`,
    data: template,
  });
});

export const deleteTemplate = asyncHandler(async (req: Request, res: Response) => {
  const result = await labelTemplateService.deleteTemplate(
    req.params["id"] as string,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: result.deleted
      ? "Template deleted."
      : "Template is referenced by print history, so it was deactivated instead of deleted.",
    data: result,
  });
});

/** Live validation for the template designer — validates without saving. */
export const validateTemplate = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.templateValidate.parse(req.body);
  const issues = labelTemplateService.validateDraft(input);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Template validated.",
    data: {
      issues,
      errors: issues.filter((issue) => issue.severity === "error"),
      warnings: issues.filter((issue) => issue.severity === "warning"),
      isValid: issues.every((issue) => issue.severity !== "error"),
    },
  });
});

export const listBuiltinTemplates = asyncHandler(async (_req: Request, res: Response) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Built-in templates retrieved.",
    data: labelTemplateService.listBuiltins(),
  });
});

// ─── Printers ─────────────────────────────────────────────────────────────────

export const listPrinters = asyncHandler(async (req: Request, res: Response) => {
  const includeInactive = req.query["includeInactive"] === "true";
  const data = await printerAdminService.listPrinters(includeInactive);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Printers retrieved.",
    data,
  });
});

export const getPrinter = asyncHandler(async (req: Request, res: Response) => {
  const data = await printerAdminService.getPrinterById(req.params["id"] as string);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Printer retrieved.",
    data,
  });
});

export const createPrinter = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.printerWrite.parse(req.body);
  const data = await printerAdminService.createPrinter(input, req.user.id);

  return res.status(HTTP_STATUS.CREATED).json({
    success: true,
    message: `Printer "${data.name}" added.`,
    data,
  });
});

export const updatePrinter = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.printerUpdate.parse(req.body);
  const data = await printerAdminService.updatePrinter(
    req.params["id"] as string,
    input,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `Printer "${data.name}" updated.`,
    data,
  });
});

export const setDefaultPrinter = asyncHandler(async (req: Request, res: Response) => {
  const data = await printerAdminService.setDefaultPrinter(
    req.params["id"] as string,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: `"${data.name}" is now the default printer.`,
    data,
  });
});

export const deletePrinter = asyncHandler(async (req: Request, res: Response) => {
  const result = await printerAdminService.deactivatePrinter(
    req.params["id"] as string,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message:
      result.jobCount > 0
        ? `Printer deactivated. ${result.jobCount} historical job(s) still reference it.`
        : "Printer deactivated.",
    data: result.printer,
  });
});

export const testPrinter = asyncHandler(async (req: Request, res: Response) => {
  const result = await printerAdminService.testPrinter(
    req.params["id"] as string,
    req.user.id
  );

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: result.online
      ? `"${result.printer.name}" is online.`
      : `"${result.printer.name}" is not reachable.`,
    data: result,
  });
});

export const probeAllPrinters = asyncHandler(async (_req: Request, res: Response) => {
  const data = await printerAdminService.probeAllPrinters();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Printer status refreshed.",
    data,
  });
});

/** Drivers + transports + symbologies, so the UI never hardcodes these lists. */
export const getCapabilities = asyncHandler(async (_req: Request, res: Response) => {
  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Printer capabilities retrieved.",
    data: {
      ...printerAdminService.getCapabilities(),
      symbologies: barcodeEngine.listSymbologies(),
    },
  });
});

// ─── Settings ─────────────────────────────────────────────────────────────────

export const getSettings = asyncHandler(async (_req: Request, res: Response) => {
  const data = await printerAdminService.getSettings();

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Label settings retrieved.",
    data,
  });
});

export const updateSettings = asyncHandler(async (req: Request, res: Response) => {
  const input = labelValidation.printerSettings.parse(req.body);
  const data = await printerAdminService.updateSettings(input, req.user.id);

  return res.status(HTTP_STATUS.OK).json({
    success: true,
    message: "Label settings updated.",
    data,
  });
});
