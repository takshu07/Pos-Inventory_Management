/**
 * BarcodeRenderer — displays a barcode VALUE as a scannable symbol.
 *
 * Why this renders client-side rather than requesting an image:
 *   • The engine's rule is "never store barcode images". Fetching one per row
 *     in a 50-row table would mean 50 round-trips for data we already have.
 *   • A barcode is pure geometry derived from its value, so a table cell can
 *     draw it locally with no network at all.
 *
 * This is a DISPLAY component. The authoritative encoding for anything that
 * gets printed always happens server-side in the Barcode Engine — the printed
 * label is never generated from this file.
 */

import * as React from "react";

import { cn } from "@/utils/cn";

export interface BarcodeRendererProps {
  value: string | null | undefined;
  /** Display height of the bars in pixels. */
  height?: number;
  /** Show the human-readable value beneath the bars. */
  showText?: boolean;
  className?: string;
  /** Rendered when there is no value — keeps table rows aligned. */
  placeholder?: React.ReactNode;
}

// ── Code 128 (subset B) encoding ─────────────────────────────────────────────
// Subset B covers the full printable-ASCII range, which is what SKUs use.
// The 107 patterns are indexed by the encoded character value.

const CODE128_PATTERNS = [
  "11011001100", "11001101100", "11001100110", "10010011000", "10010001100",
  "10001001100", "10011001000", "10011000100", "10001100100", "11001001000",
  "11001000100", "11000100100", "10110011100", "10011011100", "10011001110",
  "10111001100", "10011101100", "10011100110", "11001110010", "11001011100",
  "11001001110", "11011100100", "11001110100", "11101101110", "11101001100",
  "11100101100", "11100100110", "11101100100", "11100110100", "11100110010",
  "11011011000", "11011000110", "11000110110", "10100011000", "10001011000",
  "10001000110", "10110001000", "10001101000", "10001100010", "11010001000",
  "11000101000", "11000100010", "10110111000", "10110001110", "10001101110",
  "10111011000", "10111000110", "10001110110", "11101110110", "11010001110",
  "11000101110", "11011101000", "11011100010", "11011101110", "11101011000",
  "11101000110", "11100010110", "11101101000", "11101100010", "11100011010",
  "11101111010", "11001000010", "11110001010", "10100110000", "10100001100",
  "10010110000", "10010000110", "10000101100", "10000100110", "10110010000",
  "10110000100", "10011010000", "10011000010", "10000110100", "10000110010",
  "11000010010", "11001010000", "11110111010", "11000010100", "10001111010",
  "10100111100", "10010111100", "10010011110", "10111100100", "10011110100",
  "10011110010", "11110100100", "11110010100", "11110010010", "11011011110",
  "11011110110", "11110110110", "10101111000", "10100011110", "10001011110",
  "10111101000", "10111100010", "11110101000", "11110100010", "10111011110",
  "10111101110", "11101011110", "11110101110", "11010000100", "11010010000",
  "11010011100", "11000111010",
];

const CODE128_STOP = "1100011101011";

/** Encodes a string as Code 128 subset B modules ("1" = bar, "0" = space). */
function encodeCode128B(value: string): string | null {
  const START_B = 104;
  let checksum = START_B;
  let modules = CODE128_PATTERNS[START_B] ?? "";

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    // Subset B maps printable ASCII 32..126 to values 0..94.
    if (code < 32 || code > 126) return null;
    const charValue = code - 32;
    modules += CODE128_PATTERNS[charValue] ?? "";
    checksum += charValue * (index + 1);
  }

  modules += CODE128_PATTERNS[checksum % 103] ?? "";
  modules += CODE128_STOP;
  return modules;
}

// ── EAN-13 encoding ──────────────────────────────────────────────────────────

const EAN_L = ["0001101", "0011001", "0010011", "0111101", "0100011",
               "0110001", "0101111", "0111011", "0110111", "0001011"];
const EAN_G = ["0100111", "0110011", "0011011", "0100001", "0011101",
               "0111001", "0000101", "0010001", "0001001", "0010111"];
const EAN_R = ["1110010", "1100110", "1101100", "1000010", "1011100",
               "1001110", "1010000", "1000100", "1001000", "1110100"];
/** Which left-half digits use G-code, selected by the first digit. */
const EAN_PARITY = [
  "LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG",
  "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL",
];

function ean13CheckDigit(twelve: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    sum += Number(twelve[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Encodes an EAN-13. Accepts 12 digits (check digit computed) or 13 (verified).
 *
 * The leading digit is never drawn as bars — it is encoded in the PARITY
 * pattern of the left half, which is why EAN-13 has 95 modules for 13 digits.
 */
function encodeEan13(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let value = digits;

  if (digits.length === 12) {
    value = digits + String(ean13CheckDigit(digits));
  } else if (digits.length !== 13) {
    return null;
  }

  const first = Number(value[0]);
  const parity = EAN_PARITY[first];
  if (parity === undefined) return null;

  let modules = "101"; // start guard

  for (let i = 1; i <= 6; i += 1) {
    const digit = Number(value[i]);
    const pattern = parity[i - 1] === "L" ? EAN_L[digit] : EAN_G[digit];
    if (pattern === undefined) return null;
    modules += pattern;
  }

  modules += "01010"; // centre guard

  for (let i = 7; i <= 12; i += 1) {
    const pattern = EAN_R[Number(value[i])];
    if (pattern === undefined) return null;
    modules += pattern;
  }

  modules += "101"; // end guard
  return modules;
}

/**
 * Chooses an encoding for the value.
 *
 * Mirrors the server's resolveSymbologyForValue so the on-screen symbol matches
 * what will actually be printed: 12/13 digits → EAN-13, anything else → Code 128.
 */
function encode(value: string): { modules: string; text: string } | null {
  const digitsOnly = /^\d+$/.test(value);

  if (digitsOnly && (value.length === 12 || value.length === 13)) {
    const modules = encodeEan13(value);
    if (modules) {
      const text =
        value.length === 12 ? value + String(ean13CheckDigit(value)) : value;
      return { modules, text };
    }
  }

  const modules = encodeCode128B(value);
  return modules ? { modules, text: value } : null;
}

export const BarcodeRenderer = React.memo(function BarcodeRenderer({
  value,
  height = 40,
  showText = true,
  className,
  placeholder,
}: BarcodeRendererProps) {
  // Encoding is pure and can be non-trivial for long values; memoise so a
  // parent re-render (e.g. a copies spinner) never re-encodes.
  const encoded = React.useMemo(() => (value ? encode(value) : null), [value]);

  if (!value || !encoded) {
    return (
      <span className={cn("text-xs text-muted-foreground", className)}>
        {placeholder ?? (value ? "Invalid barcode" : "No barcode")}
      </span>
    );
  }

  const { modules, text } = encoded;

  // One <rect> per contiguous bar run rather than per module — an EAN-13
  // becomes ~30 rects instead of 95, which matters in a long table.
  const bars: Array<{ x: number; width: number }> = [];
  let index = 0;
  while (index < modules.length) {
    if (modules[index] === "1") {
      let run = 1;
      while (modules[index + run] === "1") run += 1;
      bars.push({ x: index, width: run });
      index += run;
    } else {
      index += 1;
    }
  }

  const textHeight = showText ? 10 : 0;

  return (
    <span className={cn("inline-flex flex-col items-center", className)}>
      <svg
        viewBox={`0 0 ${modules.length} ${height + textHeight}`}
        width="100%"
        height={height + textHeight}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Barcode ${text}`}
        className="max-w-full"
      >
        <rect
          x={0}
          y={0}
          width={modules.length}
          height={height + textHeight}
          fill="#ffffff"
        />
        {bars.map((bar) => (
          <rect
            key={bar.x}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill="#000000"
            shapeRendering="crispEdges"
          />
        ))}
      </svg>
      {showText && (
        <span className="font-mono text-[10px] leading-none tracking-widest text-foreground">
          {text}
        </span>
      )}
    </span>
  );
});
