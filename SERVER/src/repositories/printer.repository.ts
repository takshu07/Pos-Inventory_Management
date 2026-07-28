// =============================================================================
// PRINTER REPOSITORY
// All database access for printers and printer_settings.
//
// The "exactly one default printer" rule is enforced here in a transaction
// rather than by a partial unique index, because Prisma's schema language
// cannot express `UNIQUE (isDefault) WHERE isDefault = true`. Doing it in a
// transaction keeps the invariant true even under concurrent updates.
// =============================================================================

import type { Prisma } from "../../generated/prisma";
import { PrinterStatus } from "../../generated/prisma";
import { prisma } from "../config/prisma";

const PRINTER_SELECT = {
  id: true,
  name: true,
  code: true,
  connection: true,
  driver: true,
  status: true,
  host: true,
  port: true,
  devicePath: true,
  vendorId: true,
  productId: true,
  endpointUrl: true,
  location: true,
  dpi: true,
  defaultWidthMm: true,
  defaultHeightMm: true,
  darkness: true,
  printSpeed: true,
  isDefault: true,
  isActive: true,
  lastSeenAt: true,
  lastErrorAt: true,
  lastErrorText: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PrinterSelect;

export type PrinterRow = Prisma.PrinterGetPayload<{ select: typeof PRINTER_SELECT }>;

async function findMany(includeInactive: boolean): Promise<PrinterRow[]> {
  return prisma.printer.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: PRINTER_SELECT,
    // Default first, then alphabetical — the picker's most useful ordering.
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
  });
}

async function findById(id: string): Promise<PrinterRow | null> {
  return prisma.printer.findUnique({ where: { id }, select: PRINTER_SELECT });
}

async function findByCode(code: string): Promise<PrinterRow | null> {
  return prisma.printer.findUnique({ where: { code }, select: PRINTER_SELECT });
}

async function findDefault(): Promise<PrinterRow | null> {
  return prisma.printer.findFirst({
    where: { isDefault: true, isActive: true },
    select: PRINTER_SELECT,
  });
}

/**
 * Creates a printer, clearing any previous default when this one claims it.
 * Transactional so two concurrent "make default" operations cannot both win.
 */
async function create(data: Prisma.PrinterCreateInput): Promise<PrinterRow> {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.printer.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.printer.create({ data, select: PRINTER_SELECT });
  });
}

async function update(
  id: string,
  data: Prisma.PrinterUpdateInput
): Promise<PrinterRow> {
  return prisma.$transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx.printer.updateMany({
        where: { isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.printer.update({ where: { id }, data, select: PRINTER_SELECT });
  });
}

/** Promotes one printer to default and demotes the rest, atomically. */
async function setDefault(id: string): Promise<PrinterRow> {
  return prisma.$transaction(async (tx) => {
    await tx.printer.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    });
    return tx.printer.update({
      where: { id },
      data: { isDefault: true },
      select: PRINTER_SELECT,
    });
  });
}

/**
 * Soft-deletes by deactivating.
 *
 * Hard deletion is deliberately not offered: print_jobs reference printers, and
 * destroying a printer row would either orphan or cascade-delete print history
 * that an audit may depend on.
 */
async function deactivate(id: string): Promise<PrinterRow> {
  return prisma.printer.update({
    where: { id },
    data: { isActive: false, isDefault: false },
    select: PRINTER_SELECT,
  });
}

/** Records the outcome of a reachability probe. */
async function recordStatus(
  id: string,
  status: PrinterStatus,
  errorText?: string | null
): Promise<void> {
  await prisma.printer.update({
    where: { id },
    data: {
      status,
      ...(status === PrinterStatus.ONLINE
        ? { lastSeenAt: new Date(), lastErrorText: null }
        : { lastErrorAt: new Date(), lastErrorText: errorText ?? null }),
    },
  });
}

async function countJobsFor(printerId: string): Promise<number> {
  return prisma.printJob.count({ where: { printerId } });
}

// ─── Printer settings (singleton) ─────────────────────────────────────────────

const SETTINGS_ID = "singleton";

export type PrinterSettingRow = Prisma.PrinterSettingGetPayload<object>;

/**
 * Reads the settings singleton, creating it with defaults on first access.
 *
 * Upsert (not findUnique) so a fresh install never has to be seeded manually
 * before the first print — the engine is usable immediately.
 */
async function getSettings(): Promise<PrinterSettingRow> {
  return prisma.printerSetting.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

async function updateSettings(
  data: Prisma.PrinterSettingUpdateInput
): Promise<PrinterSettingRow> {
  return prisma.printerSetting.upsert({
    where: { id: SETTINGS_ID },
    update: data,
    create: { id: SETTINGS_ID, ...(data as Prisma.PrinterSettingCreateInput) },
  });
}

export const printerRepository = {
  findMany,
  findById,
  findByCode,
  findDefault,
  create,
  update,
  setDefault,
  deactivate,
  recordStatus,
  countJobsFor,
  getSettings,
  updateSettings,
} as const;
