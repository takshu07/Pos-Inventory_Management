/**
 * BatchPrintDialog — bulk label printing by selection OR by filter.
 *
 * The filter mode is what makes "print by category / brand / supplier /
 * purchase" possible without the caller first resolving thousands of variant
 * ids in the browser. The server expands the filter, bounded at 1000 labels so
 * a mis-set filter cannot consume an entire roll.
 *
 * MANAGER + OWNER only — enforced here for rendering and again server-side.
 */

import * as React from "react";
import { AlertTriangle, Layers, Printer } from "lucide-react";

import { Button, Input, Modal, Select } from "@/components/ui";
import { useAuthStore } from "@/store/auth.store";
import {
  canBatchPrintLabels,
  canManageLabelSettings,
} from "@/features/auth/utils/permissions";

import { useBatchPrintLabels } from "../hooks/useLabels";
import { usePrintPreferences } from "../hooks/usePrintPreferences";
import type { PrintSourceModule } from "../api/labelApi";
import { LabelPreview } from "./LabelPreview";
import { LabelTemplateSelector } from "./LabelTemplateSelector";
import { PrinterSelector } from "./PrinterSelector";

export type BatchMode = "selection" | "category" | "brand" | "supplier" | "search";

export interface BatchFilterOption {
  value: string;
  label: string;
}

export interface BatchPrintDialogProps {
  open: boolean;
  onClose: () => void;
  /** Pre-selected variants (selection mode). */
  variantIds?: string[];
  /** Sample variant for the preview pane. */
  previewVariantId?: string | null;
  categories?: BatchFilterOption[];
  brands?: BatchFilterOption[];
  suppliers?: BatchFilterOption[];
  source?: PrintSourceModule;
}

export function BatchPrintDialog({
  open,
  onClose,
  variantIds = [],
  previewVariantId = null,
  categories = [],
  brands = [],
  suppliers = [],
  source = "BATCH",
}: BatchPrintDialogProps) {
  const role = useAuthStore((state) => state.user?.role ?? null);
  const canConfigure = canManageLabelSettings(role);

  const { preferences, update } = usePrintPreferences();
  const [mode, setMode] = React.useState<BatchMode>(
    variantIds.length > 0 ? "selection" : "category"
  );
  const [filterValue, setFilterValue] = React.useState("");
  const [searchTerm, setSearchTerm] = React.useState("");
  const [copiesPerLabel, setCopiesPerLabel] = React.useState(1);
  const [reason, setReason] = React.useState("");

  const batchMutation = useBatchPrintLabels();

  React.useEffect(() => {
    if (open) {
      setMode(variantIds.length > 0 ? "selection" : "category");
      setFilterValue("");
      setSearchTerm("");
      setCopiesPerLabel(1);
      setReason("");
    }
  }, [open, variantIds.length]);

  // Only "selection" mode knows its size up front. Filter modes are resolved
  // server-side, so we must not display a fabricated count.
  const knownLabelCount =
    mode === "selection" ? variantIds.length * Math.max(1, copiesPerLabel) : null;

  const filterOptions =
    mode === "category" ? categories : mode === "brand" ? brands : suppliers;

  const canSubmit =
    mode === "selection"
      ? variantIds.length > 0
      : mode === "search"
        ? searchTerm.trim().length > 0
        : filterValue.length > 0;

  function handlePrint() {
    const options = {
      templateId: preferences.templateId,
      printerId: preferences.printerId,
    };

    batchMutation.mutate(
      {
        ...(mode === "selection" && { variantIds }),
        ...(mode === "category" && { filter: { categoryId: filterValue } }),
        ...(mode === "brand" && { filter: { brandId: filterValue } }),
        ...(mode === "supplier" && { filter: { supplierId: filterValue } }),
        ...(mode === "search" && { filter: { search: searchTerm.trim() } }),
        copiesPerLabel: Math.max(1, copiesPerLabel),
        source,
        reason: reason.trim() || null,
        options,
      },
      { onSuccess: () => onClose() }
    );
  }

  if (!canBatchPrintLabels(role)) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Batch print labels"
      description="Print labels for many products at once."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-sm text-muted-foreground tabular-nums">
            {knownLabelCount !== null
              ? `${knownLabelCount} label${knownLabelCount === 1 ? "" : "s"}`
              : "Quantity resolved when the job runs"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              leftIcon={<Printer className="h-4 w-4" />}
              onClick={handlePrint}
              loading={batchMutation.isPending}
              disabled={!canSubmit}
            >
              Queue batch
            </Button>
          </div>
        </div>
      }
    >
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Select
            label="Print by"
            value={mode}
            options={[
              {
                value: "selection",
                label: `Selected products (${variantIds.length})`,
                disabled: variantIds.length === 0,
              },
              { value: "category", label: "Category", disabled: categories.length === 0 },
              { value: "brand", label: "Brand", disabled: brands.length === 0 },
              { value: "supplier", label: "Supplier", disabled: suppliers.length === 0 },
              { value: "search", label: "Search term" },
            ]}
            onChange={(event) => {
              setMode(event.target.value as BatchMode);
              setFilterValue("");
            }}
          />

          {mode !== "selection" && mode !== "search" && (
            <Select
              label={
                mode === "category" ? "Category" : mode === "brand" ? "Brand" : "Supplier"
              }
              value={filterValue}
              placeholder="Choose…"
              options={filterOptions}
              onChange={(event) => setFilterValue(event.target.value)}
            />
          )}

          {mode === "search" && (
            <Input
              label="Search term"
              placeholder="Product name contains…"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              hint="Every active product matching this term will be printed."
            />
          )}

          <Input
            label="Copies per product"
            type="number"
            min={1}
            max={999}
            value={copiesPerLabel}
            onChange={(event) =>
              setCopiesPerLabel(
                Math.max(1, Math.min(999, Number(event.target.value) || 1))
              )
            }
          />

          <Input
            label="Reason (optional)"
            placeholder="e.g. Seasonal re-tagging"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        </div>

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

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Preview</h3>
            <LabelPreview
              variantId={previewVariantId ?? variantIds[0] ?? null}
              templateId={preferences.templateId}
              sample={!previewVariantId && variantIds.length === 0}
              showZoomControls={false}
            />
          </div>

          {mode !== "selection" && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Filter-based batches are capped at 1000 labels. Check the print
                queue after queueing to see the exact quantity.
              </p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Compact trigger for tables with a multi-select toolbar. */
export function BatchPrintButton({
  selectedCount,
  onClick,
  disabled,
}: {
  selectedCount: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  const role = useAuthStore((state) => state.user?.role ?? null);
  if (!canBatchPrintLabels(role)) return null;

  return (
    <Button
      variant="outline"
      size="sm"
      leftIcon={<Layers className="h-4 w-4" />}
      onClick={onClick}
      disabled={disabled || selectedCount === 0}
    >
      Print {selectedCount > 0 ? `${selectedCount} ` : ""}labels
    </Button>
  );
}
