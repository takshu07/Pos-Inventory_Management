/**
 * Validates the baggy-jeans barcodes through the real Barcode Engine, so we
 * know they will actually scan before using them as test data.
 */
import { BarcodeSymbology } from "./generated/prisma";
import { barcodeEngine } from "./src/engines/label/barcode/barcode.engine";

const CODES = [
  ["2103894251324", "Black / S"],
  ["2109942090006", "Black / M"],
  ["2105673829458", "Black / L"],
  ["2108862576201", "Black / XL"],
  ["2101213514464", "navy / S"],
  ["2107776813181", "navy / M"],
  ["2100648206081", "navy / L"],
  ["2107923101918", "navy / XL"],
] as const;

let bad = 0;
for (const [code, variant] of CODES) {
  const check = barcodeEngine.validate(BarcodeSymbology.EAN13, code);
  const encoded = barcodeEngine.tryEncode(BarcodeSymbology.EAN13, code);
  const resolved = barcodeEngine.resolveSymbologyForValue(code, BarcodeSymbology.EAN13);

  if (check.valid && encoded.barcode) {
    console.log(
      `  VALID    ${code}  ${variant.padEnd(12)} ${resolved}  ${encoded.barcode.moduleCount} modules`
    );
  } else {
    bad += 1;
    console.log(
      `  INVALID  ${code}  ${variant.padEnd(12)} ${check.reason ?? encoded.error}`
    );
  }
}

console.log(
  bad === 0
    ? "\nAll 8 barcodes are valid EAN-13 and will scan.\n"
    : `\n${bad} barcode(s) will NOT scan.\n`
);
