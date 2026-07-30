/**
 * LabelPreview — live preview of a single label, with zoom.
 *
 * Fetches from the server rather than rendering locally, because the preview
 * must come from the SAME template engine that drives the PDF and the thermal
 * printer. A client-side approximation would drift from printed output, which
 * is exactly the failure mode "preview must match thermal printer output"
 * warns against.
 */

import * as React from "react";
import { AlertTriangle, Loader2, ZoomIn, ZoomOut } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";

import { useLabelPreview } from "../hooks/useLabels";
import { LabelCanvas } from "./LabelCanvas";

const ZOOM_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;

export interface LabelPreviewProps {
  variantId?: string | null;
  templateId?: string | null;
  /** Preview with sample data (template designer, no product selected). */
  sample?: boolean;
  showZoomControls?: boolean;
  initialZoom?: number;
  className?: string;
}

export function LabelPreview({
  variantId,
  templateId,
  sample = false,
  showZoomControls = true,
  initialZoom = 1,
  className,
}: LabelPreviewProps) {
  const [zoomIndex, setZoomIndex] = React.useState(() => {
    const found = ZOOM_STEPS.indexOf(initialZoom as (typeof ZOOM_STEPS)[number]);
    return found >= 0 ? found : 2; // default to 100%
  });

  const { data, isLoading, isError, error } = useLabelPreview({
    variantId: variantId ?? null,
    templateId: templateId ?? null,
    sample,
  });

  const zoom = ZOOM_STEPS[zoomIndex] ?? 1;

  if (isLoading) {
    return (
      <div
        className={cn(
          "flex h-48 items-center justify-center rounded-lg border border-border bg-muted/20",
          className
        )}
      >
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Rendering label…</span>
      </div>
    );
  }

  if (isError) {
    // The axios interceptor rejects with a FLAT Error carrying the server's
    // message (plus `status`/`details`), not an axios error object — so read
    // `.message` rather than `.response.data.message`.
    const message =
      error instanceof Error
        ? error.message
        : "The label preview could not be generated.";
    return (
      <div
        className={cn(
          "flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-center",
          className
        )}
      >
        <AlertTriangle className="h-5 w-5 text-destructive" />
        <p className="text-sm text-destructive">{message}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <LabelCanvas
        svg={data?.svg}
        zoom={zoom}
        widthMm={data?.widthMm}
        heightMm={data?.heightMm}
      />

      {showZoomControls && (
        <div className="flex items-center justify-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setZoomIndex((index) => Math.max(0, index - 1))}
            disabled={zoomIndex === 0}
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>

          <span className="min-w-16 text-center text-xs tabular-nums text-muted-foreground">
            {Math.round(zoom * 100)}%
          </span>

          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() =>
              setZoomIndex((index) => Math.min(ZOOM_STEPS.length - 1, index + 1))
            }
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Warnings are non-fatal (e.g. a variant with no barcode) — the label
          still prints, minus that element. Surfacing them here prevents a
          "why is the barcode missing?" support call. */}
      {data?.warnings && data.warnings.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
              {data.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
