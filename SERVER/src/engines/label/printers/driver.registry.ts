// =============================================================================
// PRINTER DRIVER REGISTRY
//
// Maps PrinterDriverType → driver implementation.
//
// This map is the entire cost of supporting a new printer manufacturer. Adding
// Brother, Godex, Citizen or any future device means:
//   1. write a driver file implementing PrinterDriver
//   2. add the enum value + one line here
//
// No route, controller, service, queue, component, hook or frontend file
// changes — which is the architectural guarantee the brief asks for.
// =============================================================================

import { PrinterDriverType } from "../../../../generated/prisma";
import type { PrinterDriver } from "./driver.types";
import {
  dymoDriver,
  nullDriver,
  pdfDriver,
  previewDriver,
} from "./drivers/document.drivers";
import { escPosDriver } from "./drivers/escpos.driver";
import { tsplDriver } from "./drivers/tspl.driver";
import { zplDriver } from "./drivers/zpl.driver";

const REGISTRY: Record<PrinterDriverType, PrinterDriver> = {
  [PrinterDriverType.ESC_POS]: escPosDriver,
  [PrinterDriverType.TSPL]: tsplDriver,
  [PrinterDriverType.ZPL]: zplDriver,
  [PrinterDriverType.DYMO]: dymoDriver,
  [PrinterDriverType.PDF]: pdfDriver,
  [PrinterDriverType.PREVIEW]: previewDriver,
  [PrinterDriverType.NULL]: nullDriver,
};

export function getDriver(type: PrinterDriverType): PrinterDriver {
  const driver = REGISTRY[type];
  if (!driver) {
    throw new Error(`No printer driver registered for type "${type}".`);
  }
  return driver;
}

/** Drivers available in the printer-management UI, with their known devices. */
export function listDrivers(): Array<{
  type: PrinterDriverType;
  displayName: string;
  knownDevices: string[];
  isDocumentDriver: boolean;
}> {
  return Object.values(REGISTRY).map((driver) => ({
    type: driver.type,
    displayName: driver.displayName,
    knownDevices: driver.knownDevices,
    isDocumentDriver: driver.isDocumentDriver,
  }));
}
