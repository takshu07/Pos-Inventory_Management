/**
 * LabelCanvas — renders server-generated label SVG at a controllable zoom.
 *
 * The server returns SVG whose width/height are declared in MILLIMETRES, so at
 * 100% zoom the browser draws the label at true physical size — what you see is
 * the size of the sticker that comes out of the printer.
 *
 * The SVG is injected with dangerouslySetInnerHTML. That is safe here and not a
 * shortcut: the markup is produced by our own renderer from our own database,
 * never from user-supplied HTML, and every dynamic value passes through the
 * server's escapeXml() before it reaches the string. An <img src="data:...">
 * alternative would block the zoom/inspection behaviour this component exists
 * for, since the SVG must scale as vector geometry.
 */

import { cn } from "@/utils/cn";

export interface LabelCanvasProps {
  /** SVG markup from the preview endpoint. */
  svg: string | undefined;
  /** 1 = actual physical size. */
  zoom?: number;
  /** Checkerboard behind the label, so white-on-white is still visible. */
  showCheckerboard?: boolean;
  className?: string;
  /** Physical dimensions, shown as a caption. */
  widthMm?: number;
  heightMm?: number;
}

export function LabelCanvas({
  svg,
  zoom = 1,
  showCheckerboard = true,
  className,
  widthMm,
  heightMm,
}: LabelCanvasProps) {
  if (!svg) {
    return (
      <div
        className={cn(
          "flex h-40 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-sm text-muted-foreground",
          className
        )}
      >
        No preview available
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <div
        className={cn(
          "inline-flex items-center justify-center overflow-auto rounded-lg border border-border p-4",
          showCheckerboard ? "bg-[#f8fafc] dark:bg-[#0f172a]" : "bg-white"
        )}
        style={
          showCheckerboard
            ? {
                // A subtle checkerboard makes the white label edge visible in
                // both light and dark themes.
                backgroundImage:
                  "linear-gradient(45deg, rgba(148,163,184,0.15) 25%, transparent 25%)," +
                  "linear-gradient(-45deg, rgba(148,163,184,0.15) 25%, transparent 25%)," +
                  "linear-gradient(45deg, transparent 75%, rgba(148,163,184,0.15) 75%)," +
                  "linear-gradient(-45deg, transparent 75%, rgba(148,163,184,0.15) 75%)",
                backgroundSize: "12px 12px",
                backgroundPosition: "0 0, 0 6px, 6px -6px, -6px 0px",
              }
            : undefined
        }
      >
        <div
          // transform (not width/height) so scaling stays GPU-composited and
          // the zoom control feels instant even on a large batch preview.
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: "center center",
            transition: "transform 120ms ease-out",
          }}
          className="shadow-sm"
          // Trusted, server-generated, fully escaped markup — see the file note.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>

      {widthMm !== undefined && heightMm !== undefined && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {widthMm} × {heightMm} mm
          {zoom !== 1 && ` · ${Math.round(zoom * 100)}%`}
        </p>
      )}
    </div>
  );
}
