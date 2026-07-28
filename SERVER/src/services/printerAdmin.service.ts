// =============================================================================
// PRINTER ADMINISTRATION SERVICE  (OWNER only)
//
// Printer CRUD, status probing, and the printer/label settings singleton.
// Every function here is reached only after the route layer has enforced
// requireRole("OWNER") — managers and cashiers never see these endpoints.
// =============================================================================

import {
  ActionModule,
  ActionType,
  PrinterConnectionType,
  type Prisma,
} from "../../generated/prisma";
import { HTTP_STATUS } from "../constants/httpStatus";
import { AppError } from "../errors/AppError";
import { listDrivers } from "../engines/label/printers/driver.registry";
import { listTransports } from "../engines/label/printers/transports";
import { auditRepository } from "../repositories/audit.repository";
import {
  printerRepository,
  type PrinterRow,
  type PrinterSettingRow,
} from "../repositories/printer.repository";
import { printerService } from "./printer.service";
import type {
  PrinterSettingsInput,
  PrinterUpdateInput,
  PrinterWriteInput,
} from "../validation/label.validation";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Cross-field consistency check against the FINAL record.
 *
 * Runs on the merged result rather than the request body, because a PATCH that
 * only flips `connection` to NETWORK must be validated against the host
 * already stored — validating the body alone would let that through.
 */
function assertTransportConsistency(record: {
  connection: PrinterConnectionType;
  host?: string | null | undefined;
  endpointUrl?: string | null | undefined;
}): void {
  if (record.connection === PrinterConnectionType.NETWORK && !record.host) {
    throw new AppError(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      "A network printer requires a host address.",
      { field: "host" }
    );
  }
  if (record.connection === PrinterConnectionType.CLOUD && !record.endpointUrl) {
    throw new AppError(
      HTTP_STATUS.UNPROCESSABLE_ENTITY,
      "A cloud printer requires an endpoint URL.",
      { field: "endpointUrl" }
    );
  }
}

export async function listPrinters(includeInactive = false): Promise<PrinterRow[]> {
  return printerRepository.findMany(includeInactive);
}

export async function getPrinterById(id: string): Promise<PrinterRow> {
  const printer = await printerRepository.findById(id);
  if (!printer) throw new AppError(HTTP_STATUS.NOT_FOUND, "Printer not found.");
  return printer;
}

export async function createPrinter(
  input: PrinterWriteInput,
  actorId: string
): Promise<PrinterRow> {
  const code = input.code?.trim() || slugify(input.name);

  const existing = await printerRepository.findByCode(code);
  if (existing) {
    throw new AppError(
      HTTP_STATUS.CONFLICT,
      `A printer with the code "${code}" already exists.`
    );
  }

  assertTransportConsistency(input);

  const printer = await printerRepository.create({
    name: input.name,
    code,
    connection: input.connection,
    driver: input.driver,
    host: input.host ?? null,
    port: input.port ?? null,
    devicePath: input.devicePath ?? null,
    vendorId: input.vendorId ?? null,
    productId: input.productId ?? null,
    endpointUrl: input.endpointUrl ?? null,
    location: input.location ?? null,
    dpi: input.dpi,
    defaultWidthMm: input.defaultWidthMm,
    defaultHeightMm: input.defaultHeightMm,
    darkness: input.darkness,
    printSpeed: input.printSpeed,
    isDefault: input.isDefault,
    isActive: input.isActive,
  });

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.CREATE,
    module: ActionModule.PRINTER,
    tableName: "printers",
    recordId: printer.id,
    newData: {
      name: printer.name,
      code: printer.code,
      connection: printer.connection,
      driver: printer.driver,
    },
  });

  return printer;
}

export async function updatePrinter(
  id: string,
  // Typed from the dedicated PATCH schema (not Partial<PrinterWriteInput>):
  // printerWriteSchema is a ZodEffects carrying cross-field refinements, and
  // its inferred shape does not survive Partial<> under
  // exactOptionalPropertyTypes. The refinements are re-applied below against
  // the merged record, which is the only correct place for a partial update.
  input: PrinterUpdateInput,
  actorId: string
): Promise<PrinterRow> {
  const existing = await getPrinterById(id);

  // Validate the merged shape, not the patch — see assertTransportConsistency.
  assertTransportConsistency({
    connection: input.connection ?? existing.connection,
    host: input.host !== undefined ? input.host : existing.host,
    endpointUrl:
      input.endpointUrl !== undefined ? input.endpointUrl : existing.endpointUrl,
  });

  const data: Prisma.PrinterUpdateInput = {
    ...(input.name !== undefined && { name: input.name }),
    ...(input.connection !== undefined && { connection: input.connection }),
    ...(input.driver !== undefined && { driver: input.driver }),
    ...(input.host !== undefined && { host: input.host }),
    ...(input.port !== undefined && { port: input.port }),
    ...(input.devicePath !== undefined && { devicePath: input.devicePath }),
    ...(input.vendorId !== undefined && { vendorId: input.vendorId }),
    ...(input.productId !== undefined && { productId: input.productId }),
    ...(input.endpointUrl !== undefined && { endpointUrl: input.endpointUrl }),
    ...(input.location !== undefined && { location: input.location }),
    ...(input.dpi !== undefined && { dpi: input.dpi }),
    ...(input.defaultWidthMm !== undefined && { defaultWidthMm: input.defaultWidthMm }),
    ...(input.defaultHeightMm !== undefined && { defaultHeightMm: input.defaultHeightMm }),
    ...(input.darkness !== undefined && { darkness: input.darkness }),
    ...(input.printSpeed !== undefined && { printSpeed: input.printSpeed }),
    ...(input.isDefault !== undefined && { isDefault: input.isDefault }),
    ...(input.isActive !== undefined && { isActive: input.isActive }),
  };

  const printer = await printerRepository.update(id, data);

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.PRINTER_CHANGED,
    module: ActionModule.PRINTER,
    tableName: "printers",
    recordId: printer.id,
    oldData: {
      name: existing.name,
      connection: existing.connection,
      driver: existing.driver,
      host: existing.host,
      isDefault: existing.isDefault,
    },
    newData: {
      name: printer.name,
      connection: printer.connection,
      driver: printer.driver,
      host: printer.host,
      isDefault: printer.isDefault,
    },
  });

  return printer;
}

export async function setDefaultPrinter(
  id: string,
  actorId: string
): Promise<PrinterRow> {
  await getPrinterById(id);
  const printer = await printerRepository.setDefault(id);

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.PRINTER_CHANGED,
    module: ActionModule.PRINTER,
    tableName: "printers",
    recordId: printer.id,
    newData: { isDefault: true, name: printer.name },
  });

  return printer;
}

/**
 * Deactivates a printer.
 *
 * Never hard-deletes: print_jobs reference printers, and removing the row would
 * take the print history with it (or orphan it).
 */
export async function deactivatePrinter(
  id: string,
  actorId: string
): Promise<{ printer: PrinterRow; jobCount: number }> {
  const existing = await getPrinterById(id);
  const jobCount = await printerRepository.countJobsFor(id);

  const printer = await printerRepository.deactivate(id);

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.DELETE,
    module: ActionModule.PRINTER,
    tableName: "printers",
    recordId: id,
    oldData: { name: existing.name, isActive: true },
    newData: { isActive: false, retainedJobs: jobCount },
  });

  return { printer, jobCount };
}

/** Probes reachability and records the result. Powers the status column. */
export async function testPrinter(
  id: string,
  actorId: string
): Promise<{ online: boolean; error?: string; printer: PrinterRow }> {
  const printer = await getPrinterById(id);
  const result = await printerService.probe(printer);

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.UPDATE,
    module: ActionModule.PRINTER,
    tableName: "printers",
    recordId: id,
    newData: { probe: result.online ? "ONLINE" : "OFFLINE", error: result.error ?? null },
  });

  const refreshed = await getPrinterById(id);
  return { ...result, printer: refreshed };
}

/** Probes every active printer in parallel for the status grid. */
export async function probeAllPrinters(): Promise<
  Array<{ id: string; name: string; online: boolean; error?: string }>
> {
  const printers = await printerRepository.findMany(false);

  return Promise.all(
    printers.map(async (printer) => {
      const result = await printerService.probe(printer);
      return {
        id: printer.id,
        name: printer.name,
        online: result.online,
        ...(result.error !== undefined && { error: result.error }),
      };
    })
  );
}

// ─── Capability discovery ─────────────────────────────────────────────────────

/**
 * Lists available drivers and transports.
 *
 * The printer form reads this instead of hardcoding options, so a newly
 * registered driver appears in the UI automatically — no frontend change.
 */
export function getCapabilities() {
  return {
    drivers: listDrivers(),
    transports: listTransports().map((transport) => ({
      kind: transport.kind,
      displayName: transport.displayName,
      isAvailable: transport.isAvailable,
      unavailableReason: transport.unavailableReason ?? null,
    })),
  };
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<PrinterSettingRow> {
  return printerRepository.getSettings();
}

export async function updateSettings(
  input: PrinterSettingsInput,
  actorId: string
): Promise<PrinterSettingRow> {
  const existing = await printerRepository.getSettings();

  // Reject dangling references up front — a default pointing at a deleted
  // printer would surface much later as a confusing failed job.
  if (input.defaultPrinterId) {
    const printer = await printerRepository.findById(input.defaultPrinterId);
    if (!printer) {
      throw new AppError(HTTP_STATUS.NOT_FOUND, "The selected default printer does not exist.");
    }
  }

  const data: Prisma.PrinterSettingUpdateInput = {
    ...(input.defaultPrinterId !== undefined && {
      defaultPrinter: input.defaultPrinterId
        ? { connect: { id: input.defaultPrinterId } }
        : { disconnect: true },
    }),
    ...(input.defaultTemplateId !== undefined && {
      defaultTemplate: input.defaultTemplateId
        ? { connect: { id: input.defaultTemplateId } }
        : { disconnect: true },
    }),
    ...(input.defaultCopies !== undefined && { defaultCopies: input.defaultCopies }),
    ...(input.defaultWidthMm !== undefined && { defaultWidthMm: input.defaultWidthMm }),
    ...(input.defaultHeightMm !== undefined && { defaultHeightMm: input.defaultHeightMm }),
    ...(input.marginTopMm !== undefined && { marginTopMm: input.marginTopMm }),
    ...(input.marginRightMm !== undefined && { marginRightMm: input.marginRightMm }),
    ...(input.marginBottomMm !== undefined && { marginBottomMm: input.marginBottomMm }),
    ...(input.marginLeftMm !== undefined && { marginLeftMm: input.marginLeftMm }),
    ...(input.orientation !== undefined && { orientation: input.orientation }),
    ...(input.darkness !== undefined && { darkness: input.darkness }),
    ...(input.printSpeed !== undefined && { printSpeed: input.printSpeed }),
    ...(input.barcodeSymbology !== undefined && { barcodeSymbology: input.barcodeSymbology }),
    ...(input.showPreviewBeforePrint !== undefined && {
      showPreviewBeforePrint: input.showPreviewBeforePrint,
    }),
    ...(input.printAfterProductCreate !== undefined && {
      printAfterProductCreate: input.printAfterProductCreate,
    }),
    ...(input.printAfterPurchase !== undefined && {
      printAfterPurchase: input.printAfterPurchase,
    }),
    ...(input.outputMode !== undefined && { outputMode: input.outputMode }),
  };

  const settings = await printerRepository.updateSettings(data);

  void auditRepository.create({
    performedBy: actorId,
    action: ActionType.PRINTER_SETTINGS_CHANGED,
    module: ActionModule.PRINTER,
    tableName: "printer_settings",
    recordId: settings.id,
    oldData: {
      defaultPrinterId: existing.defaultPrinterId,
      defaultTemplateId: existing.defaultTemplateId,
      outputMode: existing.outputMode,
      defaultCopies: existing.defaultCopies,
    },
    newData: {
      defaultPrinterId: settings.defaultPrinterId,
      defaultTemplateId: settings.defaultTemplateId,
      outputMode: settings.outputMode,
      defaultCopies: settings.defaultCopies,
    },
  });

  return settings;
}

export const printerAdminService = {
  listPrinters,
  getPrinterById,
  createPrinter,
  updatePrinter,
  setDefaultPrinter,
  deactivatePrinter,
  testPrinter,
  probeAllPrinters,
  getCapabilities,
  getSettings,
  updateSettings,
} as const;
