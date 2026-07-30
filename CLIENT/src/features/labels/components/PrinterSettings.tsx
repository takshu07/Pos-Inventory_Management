/**
 * PrinterSettings — the OWNER-only label/printing configuration panel.
 *
 * Saves optimistically (see useUpdateLabelSettings) because these are toggles
 * and small numbers where a round-trip delay makes the UI feel broken.
 *
 * The output-mode control is the single most consequential setting in the
 * engine: it decides whether jobs render a preview, produce a PDF, or drive
 * physical hardware — and nothing else in the app knows which is active.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Select,
} from "@/components/ui";

import {
  useLabelSettings,
  useLabelTemplates,
  usePrinterCapabilities,
  usePrinters,
  useUpdateLabelSettings,
} from "../hooks/useLabels";

/** Accessible toggle row — the design system has no Switch primitive. */
function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = React.useId();
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="flex-1">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary"
      />
    </div>
  );
}

export function PrinterSettings() {
  const { data: settings, isLoading } = useLabelSettings();
  const { data: printers } = usePrinters(false);
  const { data: templates } = useLabelTemplates();
  const { data: capabilities } = usePrinterCapabilities();
  const updateMutation = useUpdateLabelSettings();

  if (isLoading || !settings) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const save = (patch: Parameters<typeof updateMutation.mutate>[0]) =>
    updateMutation.mutate(patch);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* ── Defaults ──────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Defaults</CardTitle>
          <CardDescription>
            Applied whenever a print request does not specify its own options.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Select
            label="Default printer"
            value={settings.defaultPrinterId ?? ""}
            options={[
              { value: "", label: "None" },
              ...(printers ?? []).map((printer) => ({
                value: printer.id,
                label: printer.name,
              })),
            ]}
            onChange={(event) =>
              save({ defaultPrinterId: event.target.value || null })
            }
          />

          <Select
            label="Default label template"
            value={settings.defaultTemplateId ?? ""}
            options={[
              { value: "", label: "Default clothing label" },
              ...(templates ?? []).map((template) => ({
                value: template.id,
                label: template.name,
              })),
            ]}
            onChange={(event) =>
              save({ defaultTemplateId: event.target.value || null })
            }
          />

          <Input
            label="Default copies"
            type="number"
            min={1}
            max={999}
            defaultValue={settings.defaultCopies}
            onBlur={(event) =>
              save({
                defaultCopies: Math.max(
                  1,
                  Math.min(999, Number(event.target.value) || 1)
                ),
              })
            }
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Label width (mm)"
              type="number"
              min={5}
              max={500}
              step="0.5"
              defaultValue={Number(settings.defaultWidthMm)}
              onBlur={(event) =>
                save({ defaultWidthMm: Number(event.target.value) || 50 })
              }
            />
            <Input
              label="Label height (mm)"
              type="number"
              min={5}
              max={500}
              step="0.5"
              defaultValue={Number(settings.defaultHeightMm)}
              onBlur={(event) =>
                save({ defaultHeightMm: Number(event.target.value) || 25 })
              }
            />
          </div>

          <Select
            label="Barcode standard"
            value={settings.barcodeSymbology}
            options={(capabilities?.symbologies ?? []).map((symbology) => ({
              value: symbology.symbology,
              label: symbology.isImplemented
                ? symbology.displayName
                : `${symbology.displayName} (not available yet)`,
              disabled: !symbology.isImplemented,
            }))}
            onChange={(event) =>
              save({ barcodeSymbology: event.target.value as never })
            }
            hint="Non-numeric SKUs automatically fall back to Code 128 so every label stays scannable."
          />
        </CardContent>
      </Card>

      {/* ── Output & hardware ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle>Output & print quality</CardTitle>
          <CardDescription>
            How print jobs reach the world. Only this setting changes between
            development, testing and production.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Select
            label="Output mode"
            value={settings.outputMode}
            options={[
              { value: "PREVIEW", label: "Preview only — nothing is printed" },
              { value: "PDF", label: "PDF — generate a document" },
              { value: "THERMAL", label: "Thermal — print to hardware" },
            ]}
            onChange={(event) => save({ outputMode: event.target.value as never })}
          />

          <Select
            label="Paper orientation"
            value={settings.orientation}
            options={[
              { value: "portrait", label: "Portrait" },
              { value: "landscape", label: "Landscape" },
            ]}
            onChange={(event) => save({ orientation: event.target.value })}
          />

          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Darkness"
              type="number"
              min={0}
              max={30}
              defaultValue={settings.darkness}
              onBlur={(event) =>
                save({
                  darkness: Math.max(0, Math.min(30, Number(event.target.value) || 8)),
                })
              }
              hint="0–30 burn level"
            />
            <Input
              label="Print speed"
              type="number"
              min={1}
              max={14}
              defaultValue={settings.printSpeed}
              onBlur={(event) =>
                save({
                  printSpeed: Math.max(1, Math.min(14, Number(event.target.value) || 4)),
                })
              }
              hint="Inches per second"
            />
          </div>

          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ["marginTopMm", "Top"],
                ["marginRightMm", "Right"],
                ["marginBottomMm", "Bottom"],
                ["marginLeftMm", "Left"],
              ] as const
            ).map(([key, label]) => (
              <Input
                key={key}
                label={label}
                type="number"
                min={0}
                max={50}
                step="0.5"
                defaultValue={Number(settings[key])}
                onBlur={(event) => save({ [key]: Number(event.target.value) || 0 })}
              />
            ))}
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Margins in millimetres.</p>
        </CardContent>
      </Card>

      {/* ── Workflow ──────────────────────────────────────────────────────── */}
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
          <CardDescription>
            When the system should offer or trigger label printing automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border">
          <ToggleRow
            label="Show preview before printing"
            description="Open the preview pane in the print dialog by default."
            checked={settings.showPreviewBeforePrint}
            onChange={(value) => save({ showPreviewBeforePrint: value })}
          />
          <ToggleRow
            label="Print labels after creating a product"
            description="Automatically queue labels for every variant of a newly created product."
            checked={settings.printAfterProductCreate}
            onChange={(value) => save({ printAfterProductCreate: value })}
          />
          <ToggleRow
            label="Print labels after receiving a purchase"
            description="Queue one label per unit received. A printer problem never blocks the stock receipt."
            checked={settings.printAfterPurchase}
            onChange={(value) => save({ printAfterPurchase: value })}
          />
        </CardContent>
      </Card>
    </div>
  );
}
