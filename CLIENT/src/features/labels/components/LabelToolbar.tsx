/**
 * LabelToolbar — the reusable Print / Preview / Reprint action cluster.
 *
 * This is the component every OTHER module drops in: product tables, variant
 * rows, search results, inventory screens. It owns the dialogs, so no feature
 * has to know that printing involves a queue, a template or a printer.
 *
 * "Do not duplicate UI" in practice: adding label printing to a new screen is
 * one <LabelToolbar variants={…} /> and nothing else.
 */

import * as React from "react";
import { Eye, Printer } from "lucide-react";

import { Button, Modal } from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import {
  canBatchPrintLabels,
  canPreviewLabels,
  canPrintLabels,
} from "@/features/auth/utils/permissions";
import { cn } from "@/utils/cn";

import type { PrintSourceModule } from "../api/labelApi";
import { LabelPreview } from "./LabelPreview";
import { PrintDialog, type PrintDialogVariant } from "./PrintDialog";

export interface LabelToolbarProps {
  /** Variants this toolbar acts on. One = row actions; many = bulk actions. */
  variants: PrintDialogVariant[];
  source?: PrintSourceModule;
  size?: "sm" | "md";
  /** Icon-only buttons for dense table rows. */
  compact?: boolean;
  className?: string;
  /** Hide the preview action (e.g. where a preview is already on screen). */
  hidePreview?: boolean;
}

export function LabelToolbar({
  variants,
  source = "MANUAL",
  size = "sm",
  compact = false,
  className,
  hidePreview = false,
}: LabelToolbarProps) {
  const role = useAuthStore((state) => state.user?.role ?? null);
  const [printOpen, setPrintOpen] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);

  const isBatch = variants.length > 1;

  // A cashier may print one label but not a batch — hide rather than let them
  // click into a guaranteed 403.
  const allowed = isBatch ? canBatchPrintLabels(role) : canPrintLabels(role);

  if (!allowed && !canPreviewLabels(role)) return null;

  return (
    <>
      <div className={cn("flex items-center gap-1", className)}>
        {!hidePreview && canPreviewLabels(role) && (
          <Button
            variant="ghost"
            size={compact ? "icon" : size}
            onClick={() => setPreviewOpen(true)}
            disabled={variants.length === 0}
            aria-label="Preview label"
            title="Preview label"
          >
            <Eye className="h-4 w-4" />
            {!compact && <span className="ml-1.5">Preview</span>}
          </Button>
        )}

        {allowed && (
          <Button
            variant="ghost"
            size={compact ? "icon" : size}
            onClick={() => setPrintOpen(true)}
            disabled={variants.length === 0}
            aria-label={isBatch ? "Print labels" : "Print label"}
            title={isBatch ? "Print labels" : "Print label"}
          >
            <Printer className="h-4 w-4" />
            {!compact && (
              <span className="ml-1.5">
                Print{isBatch ? ` (${variants.length})` : ""}
              </span>
            )}
          </Button>
        )}
      </div>

      <PrintDialog
        open={printOpen}
        onClose={() => setPrintOpen(false)}
        variants={variants}
        source={source}
      />

      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Label preview"
        description={variants[0]?.label}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>
              Close
            </Button>
            {allowed && (
              <Button
                leftIcon={<Printer className="h-4 w-4" />}
                onClick={() => {
                  setPreviewOpen(false);
                  setPrintOpen(true);
                }}
              >
                Print
              </Button>
            )}
          </div>
        }
      >
        <LabelPreview variantId={variants[0]?.variantId ?? null} initialZoom={2} />
      </Modal>
    </>
  );
}
