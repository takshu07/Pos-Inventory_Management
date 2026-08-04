/**
 * BarcodeSettings — the single place barcode encoding is configured.
 *
 * WHY THIS LIVES IN THE LABEL ENGINE AND NOT IN /admin/settings
 * ------------------------------------------------------------
 * Barcode configuration is not an independent domain. The value that decides
 * how a barcode is encoded is `PrinterSetting.barcodeSymbology`, which is read
 * by LabelService (label.service.ts) and resolved per value by the Barcode
 * Engine (barcode.engine.ts → resolveSymbologyForValue). Templates may override
 * it per layout. Every one of those consumers already sits inside this module.
 *
 * A standalone Barcode Settings screen writing to a different store would have
 * created a second source of truth for one value — which is precisely the bug
 * this component was built to remove: `invoiceConfig.barcodeFormat` was
 * editable in Receipt & Invoice Settings and read by absolutely nothing. That
 * field is now retired (see docs/BARCODE_SETTINGS.md §3) and
 * /admin/settings/barcode redirects here.
 *
 * ARCHITECTURAL CONSISTENCY
 * -------------------------
 * This is a Label Engine component, but it deliberately renders with the
 * centralized settings primitives (SettingsSection / SettingsRow /
 * SettingsToggle) from @/features/settings. The module owns the DATA; the
 * settings architecture owns the PRESENTATION. That is what makes an owner
 * moving between Store Settings and this tab see one product rather than two.
 *
 * Saves are optimistic via useUpdateLabelSettings — these are selects and
 * toggles where a round-trip delay reads as a broken control. Failure rolls the
 * cache back to the exact prior snapshot and toasts.
 */

import { Loader2, ScanBarcode, ShieldCheck } from "lucide-react";

import { Input, Select } from "@/components/ui";
import { SettingsRow, SettingsSection, SettingsToggle } from "@/features/settings";

import {
  useLabelSettings,
  usePrinterCapabilities,
  useUpdateLabelSettings,
} from "../hooks/useLabels";

/**
 * Symbologies whose encoders are registered but not yet implemented.
 *
 * The server reports this per symbology via `isImplemented` on the capabilities
 * payload (barcode.engine.ts → listSymbologies), so this UI never hardcodes the
 * list — when QR and DataMatrix land, the option simply stops being disabled
 * with no change here.
 */
function symbologyLabel(entry: {
  displayName: string;
  isImplemented: boolean;
  isTwoDimensional: boolean;
}): string {
  if (!entry.isImplemented) return `${entry.displayName} — not available yet`;
  return entry.isTwoDimensional
    ? `${entry.displayName} (2D)`
    : entry.displayName;
}

export function BarcodeSettings() {
  const { data: settings, isLoading } = useLabelSettings();
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

  const symbologies = capabilities?.symbologies ?? [];
  const selected = symbologies.find(
    (entry) => entry.symbology === settings.barcodeSymbology
  );

  return (
    <div className="flex flex-col gap-6">
      {/* ══ ENCODING ═════════════════════════════════════════════════════ */}
      <SettingsSection
        id="barcode-encoding"
        title="Barcode Encoding"
        description="How barcode values are turned into printable bars. Applies to every label the system produces."
        icon={<ScanBarcode className="h-5 w-5" />}
      >
        <SettingsRow
          label="Default symbology"
          description="The standard used when a label template does not specify its own. Templates may override this per layout."
        >
          <Select
            value={settings.barcodeSymbology}
            options={symbologies.map((entry) => ({
              value: entry.symbology,
              label: symbologyLabel(entry),
              disabled: !entry.isImplemented,
            }))}
            onChange={(event) =>
              save({ barcodeSymbology: event.target.value as never })
            }
          />
        </SettingsRow>

        <SettingsRow
          label="Automatic fallback"
          description="Always on. EAN-13 requires exactly 12–13 digits, but internal SKUs are rarely numeric — so a value that cannot be encoded as the chosen symbology falls back to Code 128 rather than printing an unscannable label."
        >
          <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
            <span>
              Enforced by the Barcode Engine — not configurable, because
              disabling it can only ever produce labels that will not scan.
            </span>
          </div>
        </SettingsRow>

        {selected?.isTwoDimensional && (
          <SettingsRow
            label="2D symbology selected"
            description="Matrix codes encode a square grid rather than a linear run of bars. Confirm your printer and scanner both support it before printing a batch."
          >
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              {selected.displayName} is a 2D code.
            </div>
          </SettingsRow>
        )}
      </SettingsSection>

      {/* ══ PRINTED SIZE ═════════════════════════════════════════════════ */}
      <SettingsSection
        id="barcode-size"
        title="Printed Size & Quality"
        description="Physical dimensions and burn settings that decide whether a printed barcode actually scans."
        icon={<ScanBarcode className="h-5 w-5" />}
      >
        <SettingsRow
          label="Label size (mm)"
          description="The default canvas a barcode is laid out on. Templates with their own size override this."
        >
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Width"
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
              label="Height"
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
        </SettingsRow>

        <SettingsRow
          label="Darkness"
          description="Thermal burn level, 0–30. Too low and bars are faint; too high and they bleed into the spaces — both break scanning."
        >
          <Input
            type="number"
            min={0}
            max={30}
            defaultValue={settings.darkness}
            onBlur={(event) =>
              save({
                darkness: Math.max(
                  0,
                  Math.min(30, Number(event.target.value) || 8)
                ),
              })
            }
          />
        </SettingsRow>

        <SettingsRow
          label="Print speed"
          description="Inches per second, 1–14. Slower printing produces crisper bars on dense symbologies."
        >
          <Input
            type="number"
            min={1}
            max={14}
            defaultValue={settings.printSpeed}
            onBlur={(event) =>
              save({
                printSpeed: Math.max(
                  1,
                  Math.min(14, Number(event.target.value) || 4)
                ),
              })
            }
          />
        </SettingsRow>
      </SettingsSection>

      {/* ══ WORKFLOW ═════════════════════════════════════════════════════ */}
      <SettingsSection
        id="barcode-workflow"
        title="When Barcodes Are Printed"
        description="The points in the workflow where label printing is offered or triggered automatically."
        icon={<ScanBarcode className="h-5 w-5" />}
      >
        <SettingsRow
          label="Preview before printing"
          description="Open the preview pane in the print dialog by default."
          dirty={false}
        >
          <SettingsToggle
            label="Preview before printing"
            checked={settings.showPreviewBeforePrint}
            onChange={(value) => save({ showPreviewBeforePrint: value })}
          />
        </SettingsRow>

        <SettingsRow
          label="Print after creating a product"
          description="Queue labels for every variant of a newly created product."
        >
          <SettingsToggle
            label="Print after creating a product"
            checked={settings.printAfterProductCreate}
            onChange={(value) => save({ printAfterProductCreate: value })}
          />
        </SettingsRow>

        <SettingsRow
          label="Print after receiving a purchase"
          description="Queue one label per unit received. A printer problem never blocks the stock receipt."
        >
          <SettingsToggle
            label="Print after receiving a purchase"
            checked={settings.printAfterPurchase}
            onChange={(value) => save({ printAfterPurchase: value })}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
