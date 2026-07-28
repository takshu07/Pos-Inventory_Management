// =============================================================================
// MONOCHROME RASTERISER
//
// Renders the shared layout primitives into a 1-bit bitmap for printers that
// cannot position elements themselves (ESC/POS) and for any future driver that
// needs a bitmap (Bluetooth mini-printers, some cloud print APIs).
//
// This is intentionally a small, dependency-free renderer:
//   • Thermal output is 1-bit — there is no anti-aliasing to reproduce, so a
//     canvas library would add weight without adding fidelity.
//   • It runs headless with no native modules, which keeps deployment simple.
//
// The bundled 5×7 bitmap font covers ASCII 32–126. Characters outside that
// range (e.g. the ₹ symbol) render via a substitution table where a sensible
// equivalent exists, and are otherwise skipped rather than drawn as garbage.
// =============================================================================

import type { LayoutResult } from "../../templates/template.engine";

/**
 * 5×7 bitmap font, ASCII 32–126. Each glyph is 5 columns; each column is a
 * 7-bit mask (bit 0 = top row). This is the classic embedded-systems font
 * layout, chosen because it is legible at the small point sizes labels use.
 */
const FONT_5X7: Record<string, number[]> = {
  " ": [0x00, 0x00, 0x00, 0x00, 0x00],
  "!": [0x00, 0x00, 0x5f, 0x00, 0x00],
  '"': [0x00, 0x07, 0x00, 0x07, 0x00],
  "#": [0x14, 0x7f, 0x14, 0x7f, 0x14],
  $: [0x24, 0x2a, 0x7f, 0x2a, 0x12],
  "%": [0x23, 0x13, 0x08, 0x64, 0x62],
  "&": [0x36, 0x49, 0x55, 0x22, 0x50],
  "'": [0x00, 0x05, 0x03, 0x00, 0x00],
  "(": [0x00, 0x1c, 0x22, 0x41, 0x00],
  ")": [0x00, 0x41, 0x22, 0x1c, 0x00],
  "*": [0x14, 0x08, 0x3e, 0x08, 0x14],
  "+": [0x08, 0x08, 0x3e, 0x08, 0x08],
  ",": [0x00, 0x50, 0x30, 0x00, 0x00],
  "-": [0x08, 0x08, 0x08, 0x08, 0x08],
  ".": [0x00, 0x60, 0x60, 0x00, 0x00],
  "/": [0x20, 0x10, 0x08, 0x04, 0x02],
  "0": [0x3e, 0x51, 0x49, 0x45, 0x3e],
  "1": [0x00, 0x42, 0x7f, 0x40, 0x00],
  "2": [0x42, 0x61, 0x51, 0x49, 0x46],
  "3": [0x21, 0x41, 0x45, 0x4b, 0x31],
  "4": [0x18, 0x14, 0x12, 0x7f, 0x10],
  "5": [0x27, 0x45, 0x45, 0x45, 0x39],
  "6": [0x3c, 0x4a, 0x49, 0x49, 0x30],
  "7": [0x01, 0x71, 0x09, 0x05, 0x03],
  "8": [0x36, 0x49, 0x49, 0x49, 0x36],
  "9": [0x06, 0x49, 0x49, 0x29, 0x1e],
  ":": [0x00, 0x36, 0x36, 0x00, 0x00],
  ";": [0x00, 0x56, 0x36, 0x00, 0x00],
  "<": [0x08, 0x14, 0x22, 0x41, 0x00],
  "=": [0x14, 0x14, 0x14, 0x14, 0x14],
  ">": [0x00, 0x41, 0x22, 0x14, 0x08],
  "?": [0x02, 0x01, 0x51, 0x09, 0x06],
  "@": [0x32, 0x49, 0x79, 0x41, 0x3e],
  A: [0x7e, 0x11, 0x11, 0x11, 0x7e],
  B: [0x7f, 0x49, 0x49, 0x49, 0x36],
  C: [0x3e, 0x41, 0x41, 0x41, 0x22],
  D: [0x7f, 0x41, 0x41, 0x22, 0x1c],
  E: [0x7f, 0x49, 0x49, 0x49, 0x41],
  F: [0x7f, 0x09, 0x09, 0x09, 0x01],
  G: [0x3e, 0x41, 0x49, 0x49, 0x7a],
  H: [0x7f, 0x08, 0x08, 0x08, 0x7f],
  I: [0x00, 0x41, 0x7f, 0x41, 0x00],
  J: [0x20, 0x40, 0x41, 0x3f, 0x01],
  K: [0x7f, 0x08, 0x14, 0x22, 0x41],
  L: [0x7f, 0x40, 0x40, 0x40, 0x40],
  M: [0x7f, 0x02, 0x0c, 0x02, 0x7f],
  N: [0x7f, 0x04, 0x08, 0x10, 0x7f],
  O: [0x3e, 0x41, 0x41, 0x41, 0x3e],
  P: [0x7f, 0x09, 0x09, 0x09, 0x06],
  Q: [0x3e, 0x41, 0x51, 0x21, 0x5e],
  R: [0x7f, 0x09, 0x19, 0x29, 0x46],
  S: [0x46, 0x49, 0x49, 0x49, 0x31],
  T: [0x01, 0x01, 0x7f, 0x01, 0x01],
  U: [0x3f, 0x40, 0x40, 0x40, 0x3f],
  V: [0x1f, 0x20, 0x40, 0x20, 0x1f],
  W: [0x3f, 0x40, 0x38, 0x40, 0x3f],
  X: [0x63, 0x14, 0x08, 0x14, 0x63],
  Y: [0x07, 0x08, 0x70, 0x08, 0x07],
  Z: [0x61, 0x51, 0x49, 0x45, 0x43],
  "[": [0x00, 0x7f, 0x41, 0x41, 0x00],
  "\\": [0x02, 0x04, 0x08, 0x10, 0x20],
  "]": [0x00, 0x41, 0x41, 0x7f, 0x00],
  "^": [0x04, 0x02, 0x01, 0x02, 0x04],
  _: [0x40, 0x40, 0x40, 0x40, 0x40],
  "`": [0x00, 0x01, 0x02, 0x04, 0x00],
  a: [0x20, 0x54, 0x54, 0x54, 0x78],
  b: [0x7f, 0x48, 0x44, 0x44, 0x38],
  c: [0x38, 0x44, 0x44, 0x44, 0x20],
  d: [0x38, 0x44, 0x44, 0x48, 0x7f],
  e: [0x38, 0x54, 0x54, 0x54, 0x18],
  f: [0x08, 0x7e, 0x09, 0x01, 0x02],
  g: [0x0c, 0x52, 0x52, 0x52, 0x3e],
  h: [0x7f, 0x08, 0x04, 0x04, 0x78],
  i: [0x00, 0x44, 0x7d, 0x40, 0x00],
  j: [0x20, 0x40, 0x44, 0x3d, 0x00],
  k: [0x7f, 0x10, 0x28, 0x44, 0x00],
  l: [0x00, 0x41, 0x7f, 0x40, 0x00],
  m: [0x7c, 0x04, 0x18, 0x04, 0x78],
  n: [0x7c, 0x08, 0x04, 0x04, 0x78],
  o: [0x38, 0x44, 0x44, 0x44, 0x38],
  p: [0x7c, 0x14, 0x14, 0x14, 0x08],
  q: [0x08, 0x14, 0x14, 0x18, 0x7c],
  r: [0x7c, 0x08, 0x04, 0x04, 0x08],
  s: [0x48, 0x54, 0x54, 0x54, 0x20],
  t: [0x04, 0x3f, 0x44, 0x40, 0x20],
  u: [0x3c, 0x40, 0x40, 0x20, 0x7c],
  v: [0x1c, 0x20, 0x40, 0x20, 0x1c],
  w: [0x3c, 0x40, 0x30, 0x40, 0x3c],
  x: [0x44, 0x28, 0x10, 0x28, 0x44],
  y: [0x0c, 0x50, 0x50, 0x50, 0x3c],
  z: [0x44, 0x64, 0x54, 0x4c, 0x44],
  "{": [0x00, 0x08, 0x36, 0x41, 0x00],
  "|": [0x00, 0x00, 0x7f, 0x00, 0x00],
  "}": [0x00, 0x41, 0x36, 0x08, 0x00],
  "~": [0x08, 0x04, 0x08, 0x10, 0x08],
};

/**
 * Currency and punctuation outside the bundled font. Mapping to an ASCII
 * equivalent is better than dropping the glyph: a price must never print as
 * "1199.00" with no indication of currency.
 */
// Keys use explicit \u escapes: several of these characters are visually
// indistinguishable from their ASCII counterparts in an editor, and a literal
// curly quote here would silently collide with the straight-quote key.
const CHAR_SUBSTITUTIONS: Record<string, string> = {
  "₹": "Rs.", // ₹ Indian rupee — the store default currency
  "€": "EUR", // €
  "£": "GBP", // £
  "¥": "JPY", // ¥
  "–": "-",   // en dash
  "—": "-",   // em dash
  "…": "...", // ellipsis (emitted by our own text truncation)
  "‘": "'",   // left single quote
  "’": "'",   // right single quote / apostrophe
  "“": '"',   // left double quote
  "”": '"',   // right double quote
  "×": "x",   // ×
};

const GLYPH_WIDTH = 5;
const GLYPH_HEIGHT = 7;
const GLYPH_SPACING = 1;

/**
 * A 1-bit-per-pixel bitmap with just enough drawing primitives to render a
 * label. Pixels are stored one byte each for simple addressing; packing into
 * the printer's bit format happens once in toEscPosRaster().
 */
export class MonoBitmap {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixels = new Uint8Array(this.width * this.height);
  }

  private setPixel(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    this.pixels[py * this.width + px] = 1;
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    const x0 = Math.round(x);
    const y0 = Math.round(y);
    const x1 = Math.round(x + width);
    const y1 = Math.round(y + height);
    for (let py = y0; py < y1; py += 1) {
      for (let px = x0; px < x1; px += 1) {
        this.setPixel(px, py);
      }
    }
  }

  strokeRect(
    x: number,
    y: number,
    width: number,
    height: number,
    thickness: number
  ): void {
    const t = Math.max(1, Math.round(thickness));
    this.fillRect(x, y, width, t);
    this.fillRect(x, y + height - t, width, t);
    this.fillRect(x, y, t, height);
    this.fillRect(x + width - t, y, t, height);
  }

  /** Applies substitutions and drops anything still unrenderable. */
  private static normaliseText(text: string): string {
    let result = "";
    for (const char of text) {
      if (FONT_5X7[char]) {
        result += char;
        continue;
      }
      const substitute = CHAR_SUBSTITUTIONS[char];
      if (substitute) {
        result += substitute;
        continue;
      }
      // Unknown glyph: a space preserves spacing without printing noise.
      result += " ";
    }
    return result;
  }

  /** Width in pixels of a string at the given integer scale. */
  static measureText(text: string, scale: number): number {
    const normalised = MonoBitmap.normaliseText(text);
    return normalised.length * (GLYPH_WIDTH + GLYPH_SPACING) * scale;
  }

  /**
   * Draws text using the bundled bitmap font, scaled by an integer factor.
   * Integer scaling only — fractional scaling of a 1-bit font produces uneven
   * stems that look broken on a thermal head.
   */
  drawText(text: string, x: number, y: number, scale: number, bold: boolean): void {
    const s = Math.max(1, Math.round(scale));
    const normalised = MonoBitmap.normaliseText(text);
    let cursorX = x;

    for (const char of normalised) {
      const glyph = FONT_5X7[char];
      if (glyph) {
        for (let column = 0; column < GLYPH_WIDTH; column += 1) {
          const columnBits = glyph[column] ?? 0;
          for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
            if ((columnBits >> row) & 1) {
              this.fillRect(cursorX + column * s, y + row * s, s, s);
              // Emulate bold by smearing one pixel right — the standard trick
              // for bitmap fonts, and legible on thermal output.
              if (bold) this.fillRect(cursorX + column * s + s, y + row * s, s, s);
            }
          }
        }
      }
      cursorX += (GLYPH_WIDTH + GLYPH_SPACING) * s;
    }
  }

  /**
   * Renders a laid-out label into a bitmap at the printer's resolution.
   *
   * Consumes the SAME LayoutResult as the SVG and PDF renderers, so an ESC/POS
   * label is positionally identical to its preview — the entire reason this
   * rasteriser exists rather than emitting flowed text commands.
   */
  static fromLayout(layout: LayoutResult, dpi: number): MonoBitmap {
    const toPx = (mm: number) => (mm / 25.4) * dpi;

    const bitmap = new MonoBitmap(
      Math.ceil(toPx(layout.widthMm)),
      Math.ceil(toPx(layout.heightMm))
    );

    for (const primitive of layout.primitives) {
      switch (primitive.kind) {
        case "text": {
          // Point size → pixel height → integer font scale.
          const targetHeightPx = (primitive.fontSize / 72) * dpi;
          const scale = Math.max(1, Math.round(targetHeightPx / GLYPH_HEIGHT));

          const textWidth = MonoBitmap.measureText(primitive.text, scale);
          const boxWidth = toPx(primitive.widthMm);

          let x = toPx(primitive.xMm);
          if (primitive.align === "center") {
            x += Math.max(0, (boxWidth - textWidth) / 2);
          } else if (primitive.align === "right") {
            x += Math.max(0, boxWidth - textWidth);
          }

          bitmap.drawText(primitive.text, x, toPx(primitive.yMm), scale, primitive.bold);

          if (primitive.strikeThrough) {
            bitmap.fillRect(
              x,
              toPx(primitive.yMm) + (GLYPH_HEIGHT * scale) / 2,
              textWidth,
              Math.max(1, Math.round(scale / 2))
            );
          }
          break;
        }

        case "barcode": {
          const { encoded } = primitive;
          if (!encoded.modules) break;

          const textHeightPx = primitive.showText
            ? (primitive.textFontSize / 72) * dpi * 1.2
            : 0;
          const barsHeight = Math.max(4, toPx(primitive.heightMm) - textHeightPx);

          const totalModules = encoded.moduleCount + encoded.quietZoneModules * 2;
          // Module width must be a WHOLE number of pixels. A fractional width
          // makes some bars 2px and others 3px, which is the classic cause of
          // an unscannable thermal barcode.
          const moduleWidth = Math.max(
            1,
            Math.floor(toPx(primitive.widthMm) / totalModules)
          );
          const startX =
            toPx(primitive.xMm) + encoded.quietZoneModules * moduleWidth;
          const y = toPx(primitive.yMm);

          for (let index = 0; index < encoded.modules.length; index += 1) {
            if (encoded.modules[index] === "1") {
              bitmap.fillRect(startX + index * moduleWidth, y, moduleWidth, barsHeight);
            }
          }

          if (primitive.showText && encoded.text) {
            const targetHeightPx = (primitive.textFontSize / 72) * dpi;
            const scale = Math.max(1, Math.round(targetHeightPx / GLYPH_HEIGHT));
            const textWidth = MonoBitmap.measureText(encoded.text, scale);
            bitmap.drawText(
              encoded.text,
              toPx(primitive.xMm) + (toPx(primitive.widthMm) - textWidth) / 2,
              y + barsHeight + 1,
              scale,
              false
            );
          }
          break;
        }

        case "line": {
          bitmap.fillRect(
            toPx(primitive.xMm),
            toPx(primitive.yMm),
            toPx(primitive.widthMm),
            Math.max(1, toPx(primitive.thicknessMm))
          );
          break;
        }

        case "box": {
          if (primitive.filled) {
            bitmap.fillRect(
              toPx(primitive.xMm),
              toPx(primitive.yMm),
              toPx(primitive.widthMm),
              toPx(primitive.heightMm)
            );
          } else if (primitive.thicknessMm > 0) {
            bitmap.strokeRect(
              toPx(primitive.xMm),
              toPx(primitive.yMm),
              toPx(primitive.widthMm),
              toPx(primitive.heightMm),
              toPx(primitive.thicknessMm)
            );
          }
          break;
        }
      }
    }

    return bitmap;
  }

  /**
   * Packs the bitmap into an ESC/POS `GS v 0` raster image command.
   *
   * Format: GS v 0 m xL xH yL yH [data], where data is row-major with 8 pixels
   * per byte, MSB first.
   */
  toEscPosRaster(): Buffer {
    const bytesPerRow = Math.ceil(this.width / 8);
    const data = Buffer.alloc(bytesPerRow * this.height);

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.pixels[y * this.width + x]) {
          const byteIndex = y * bytesPerRow + (x >> 3);
          // MSB first: pixel 0 is bit 7 of the first byte.
          data[byteIndex] = (data[byteIndex] ?? 0) | (0x80 >> (x & 7));
        }
      }
    }

    const header = Buffer.from([
      0x1d, // GS
      0x76, // v
      0x30, // 0
      0x00, // m = normal density
      bytesPerRow & 0xff,
      (bytesPerRow >> 8) & 0xff,
      this.height & 0xff,
      (this.height >> 8) & 0xff,
    ]);

    return Buffer.concat([header, data]);
  }

  /** ASCII-art dump for debugging a layout without a printer attached. */
  toAsciiArt(maxWidth = 100): string {
    const step = Math.max(1, Math.ceil(this.width / maxWidth));
    const lines: string[] = [];
    for (let y = 0; y < this.height; y += step * 2) {
      let line = "";
      for (let x = 0; x < this.width; x += step) {
        line += this.pixels[y * this.width + x] ? "█" : " ";
      }
      lines.push(line);
    }
    return lines.join("\n");
  }
}
