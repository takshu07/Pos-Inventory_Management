/**
 * PrintDialog — the standard "print labels for these variants" modal.
 *
 * Every module (Product, Inventory, Search, POS) opens THIS dialog rather than
 * building its own print UI. That is what keeps the print experience identical
 * everywhere and stops printing logic leaking into feature code.
 *
 * Options shown adapt to the caller's role: template and printer pickers are
 * OWNER-readable resources, so a cashier sees a simplified dialog (preview +
 * copies) and prints to the configured default.
 */

import * as React from "react";
import { Download, Printer } from "lucide-react";

import { Button, Input, Modal } from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import {
  canManageLabelSettings,
  canPreviewLabels,
} from "@/features/auth/utils/permissions";

import { usePrintLabels, useDownloadPdf } from "../hooks/useLabels";
import { usePrintPreferences } from "../hooks/usePrintPreferences";
import type { PrintSourceModule } from "../api/labelApi";
import { LabelPreview } from "./LabelPreview";
import { LabelTemplateSelector } from "./LabelTemplateSelector";
import { PrinterSelector } from "./PrinterSelector";

export interface PrintDialogVariant {
  variantId: string;
  /** Shown in the summary so the user can confirm what they selected. */
  label: string;
  sku?: string;
}

export interface PrintDialogProps {
  open: boolean;
  onClose: () => void;
  variants: PrintDialogVariant[];
  source?: PrintSourceModule;
  title?: string;
  /** Prefilled business justification (e.g. "Replacing damaged labels"). */
  defaultReason?: string | null;
}

export function PrintDialog({
  open,
  onClose,
  variants,
  source = "MANUAL",
  title = "Print labels",
  defaultReason = null,
}: PrintDialogProps) {
  const role = useAuthStore((state) => state.user?.role ?? null);
  const canConfigure = canManageLabelSettings(role);

  const { preferences, update } = usePrintPreferences();
  const [copies, setCopies] = React.useState(preferences.copies);
  const [reason, setReason] = React.useState(defaultReason ?? "");

  const printMutation = usePrintLabels();
  const pdfMutation = useDownloadPdf();

  // Re-sync from saved preferences each time the dialog opens, so a change made
  // in another dialog is reflected here.
  React.useEffect(() => {
    if (open) {
      setCopies(preferences.copies);
      setReason(defaultReason ?? "");
    }
    // preferences is a fresh object each render; keying on `open` is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultReason]);

  const firstVariantId = variants[0]?.variantId ?? null;
  const totalLabels = variants.length * Math.max(1, copies);

  function handlePrint() {
    printMutation.mutate(
      {
        items: variants.map((variant) => ({
          variantId: variant.variantId,
          copies: Math.max(1, copies),
        })),
        source,
        reason: reason.trim() || null,
        options: {
          templateId: preferences.templateId,
          printerId: preferences.printerId,
          copies: Math.max(1, copies),
        },
      },
      { onSuccess: () => onClose() }
    );
  }

  function handleDownloadPdf() {
    pdfMutation.mutate({
      variantIds: variants.map((variant) => variant.variantId),
      templateId: preferences.templateId,
      copies: Math.max(1, copies),
    });
  }

  if (!canPreviewLabels(role)) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={
        variants.length === 1
          ? variants[0]?.label
          : `${variants.length} products selected`
      }
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {totalLabels} label{totalLabels === 1 ? "" : "s"} will be printed
          </span>

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="outline"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={handleDownloadPdf}
              loading={pdfMutation.isPending}
            >
              PDF
            </Button>
            <Button
              leftIcon={<Printer className="h-4 w-4" />}
              onClick={handlePrint}
              loading={printMutation.isPending}
              disabled={variants.length === 0}
            >
              Print
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        {/* ── Preview ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Preview</h3>
          <LabelPreview
            variantId={firstVariantId}
            templateId={preferences.templateId}
            initialZoom={2}
          />
          {variants.length > 1 && (
            <p className="text-center text-xs text-muted-foreground">
              Showing the first of {variants.length} selected products.
            </p>
          )}
        </div>

        {/* ── Options ─────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <LabelTemplateSelector
            value={preferences.templateId}
            onChange={(templateId) => update({ templateId })}
            canReadTemplates={canConfigure}
          />

          <PrinterSelector
            value={preferences.printerId}
            onChange={(printerId) => update({ printerId })}
            canReadPrinters={canConfigure}
          />

          <Input
            label="Copies per product"
            type="number"
            min={1}
            max={999}
            value={copies}
            onChange={(event) => {
              // Clamp on entry so an accidental extra digit cannot queue a
              // thousand labels.
              const next = Math.max(
                1,
                Math.min(999, Number(event.target.value) || 1)
              );
              setCopies(next);
              update({ copies: next });
            }}
          />

          <Input
            label="Reason (optional)"
            placeholder="e.g. Replacing damaged labels"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            hint="Recorded in the print history."
          />

          {variants.length > 1 && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="mb-1.5 text-xs font-medium">Selected products</p>
              <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-muted-foreground">
                {variants.slice(0, 20).map((variant) => (
                  <li key={variant.variantId} className="truncate">
                    {variant.label}
                    {variant.sku && (
                      <span className="ml-1 font-mono opacity-70">{variant.sku}</span>
                    )}
                  </li>
                ))}
                {variants.length > 20 && (
                  <li className="italic">…and {variants.length - 20} more</li>
                )}
              </ul>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
