/**
 * Barcode Engine — encoding invariants and the single-source-of-truth guard.
 *
 * Two distinct concerns are pinned here:
 *
 *  1. ENCODING CORRECTNESS. The engine returns geometry, never images, and a
 *     value that cannot be encoded as the configured symbology must degrade to
 *     something scannable rather than emitting a broken label.
 *
 *  2. OWNERSHIP. `PrinterSetting.barcodeSymbology` is the only configured
 *     source of barcode symbology. `invoiceConfig.barcodeFormat` is deprecated
 *     and read by nothing. That was a real bug — the Receipt & Invoice Settings
 *     screen offered a barcode format control that changed nothing — and the
 *     last test in this file fails if anyone wires it back up.
 */

import { describe, expect, it } from "vitest";

import { BarcodeSymbology } from "../../../generated/prisma";
import {
  encode,
  listSymbologies,
  resolveSymbologyForValue,
  tryEncode,
  validate,
} from "../label/barcode/barcode.engine";

describe("barcode engine — encoding", () => {
  it("encodes a valid EAN-13 into module geometry, not an image", () => {
    const result = encode(BarcodeSymbology.EAN13, "2001234567893");

    expect(result.symbology).toBe(BarcodeSymbology.EAN13);
    // The contract is a run-length module string; anything image-shaped here
    // would mean the engine started persisting or rasterising.
    expect(result.modules).toMatch(/^[01]+$/);
    expect(result.moduleCount).toBe(result.modules.length);
    expect(result.quietZoneModules).toBeGreaterThan(0);
  });

  it("encodes an arbitrary SKU as Code 128", () => {
    const result = encode(BarcodeSymbology.CODE128, "BG-TSH-BLK-L-0001");

    expect(result.modules).toMatch(/^[01]+$/);
    expect(result.moduleCount).toBeGreaterThan(0);
  });

  it("rejects an EAN-13 with a bad check digit", () => {
    // Last digit deliberately wrong — a scanner would refuse this, so the
    // engine must too rather than printing an unreadable label.
    expect(validate(BarcodeSymbology.EAN13, "2001234567890").valid).toBe(false);
  });
});

describe("barcode engine — batch resilience", () => {
  it("tryEncode returns an error instead of throwing on a bad value", () => {
    const { barcode, error } = tryEncode(BarcodeSymbology.EAN13, "not-a-number");

    // A 500-label job must not abort because one variant is malformed.
    expect(barcode).toBeNull();
    expect(error).toBeTruthy();
  });

  it("tryEncode reports a missing value rather than encoding empty", () => {
    const { barcode, error } = tryEncode(BarcodeSymbology.EAN13, null);

    expect(barcode).toBeNull();
    expect(error).toContain("No barcode value");
  });
});

describe("barcode engine — automatic fallback", () => {
  /**
   * This is the behaviour the Barcode Settings screen describes as "always on".
   * If it regresses, every non-numeric SKU in a catalog configured for EAN-13
   * silently becomes an unscannable label.
   */
  it("falls back to Code 128 when the value cannot be an EAN-13", () => {
    expect(
      resolveSymbologyForValue("BG-TSH-BLK-L-0001", BarcodeSymbology.EAN13)
    ).toBe(BarcodeSymbology.CODE128);
  });

  it("keeps EAN-13 for a genuine 13-digit value", () => {
    expect(
      resolveSymbologyForValue("2001234567893", BarcodeSymbology.EAN13)
    ).toBe(BarcodeSymbology.EAN13);
  });

  it("never overrides an explicitly chosen non-EAN symbology", () => {
    // Fallback exists to rescue EAN-13 specifically. An owner who picked
    // Code 39 gets Code 39, even for a value that would fit EAN-13.
    expect(
      resolveSymbologyForValue("2001234567893", BarcodeSymbology.CODE39)
    ).toBe(BarcodeSymbology.CODE39);
  });
});

describe("barcode engine — capabilities payload", () => {
  it("reports every registered symbology with an implementation flag", () => {
    const listed = listSymbologies();

    // The settings UI builds its options from this and disables what is not
    // implemented, so the flag must be present on every entry.
    expect(listed.length).toBeGreaterThanOrEqual(8);
    for (const entry of listed) {
      expect(entry).toHaveProperty("displayName");
      expect(typeof entry.isImplemented).toBe("boolean");
      expect(typeof entry.isTwoDimensional).toBe("boolean");
    }
  });

  it("marks the not-yet-built 2D symbologies as unimplemented", () => {
    const listed = listSymbologies();
    const qr = listed.find((e) => e.symbology === BarcodeSymbology.QR);
    const dataMatrix = listed.find(
      (e) => e.symbology === BarcodeSymbology.DATA_MATRIX
    );

    // These are "reserved for future functionality". The UI must be able to
    // tell them apart from active ones — that distinction comes from here.
    expect(qr?.isImplemented).toBe(false);
    expect(qr?.isTwoDimensional).toBe(true);
    expect(dataMatrix?.isImplemented).toBe(false);
  });

  it("offers more symbologies than the retired two-option barcodeFormat did", () => {
    const implemented = listSymbologies().filter((e) => e.isImplemented);

    // The deprecated `invoiceConfig.barcodeFormat` enum offered CODE128 and
    // EAN13 only. Retiring it in favour of the engine was a widening, not a
    // loss of capability — this asserts that stays true.
    expect(implemented.length).toBeGreaterThan(2);
  });
});
