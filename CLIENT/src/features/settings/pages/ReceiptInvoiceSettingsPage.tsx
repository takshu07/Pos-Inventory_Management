/**
 * Receipt & Invoice Settings — /admin/settings/receipt.
 *
 * Document numbering and printed-receipt content. The second screen built on the
 * centralized settings architecture, and deliberately a demonstration of it:
 * this file contains NO data fetching, NO dirty tracking, NO patch diffing and
 * NO version-conflict handling. All of that comes from `useSettingsForm`, which
 * is the constraint recorded in docs/STORE_SETTINGS.md §9.1 — one settings
 * infrastructure, extended rather than duplicated.
 *
 * RBAC: OWNER-only, via `OwnerRoute` plus `requireRole("OWNER")` on both verbs
 * of `/settings`. Same boundary as Store Settings; no permission was widened.
 *
 * WHAT IS ACTUALLY WIRED, AND WHAT IS NOT
 * ---------------------------------------
 * A settings screen that offers fields nothing reads is worse than no screen —
 * it invites someone to configure a receipt footer and wonder why it never
 * prints. So this page marks each field with what consumes it TODAY:
 *
 *   • invoicePrefix / invoiceNumberLength → LIVE. Read by
 *     InvoiceService.generateNextInvoiceNumber on every sale (wired 2026-08-03;
 *     they were previously hardcoded and these settings did nothing).
 *   • exchangePrefix / purchasePrefix     → stored, not yet read. Exchange and
 *     purchase numbering still derive their own formats.
 *   • receiptHeader / receiptFooter / qrCodeEnabled → stored, not yet read. The
 *     receipt renderer is the "Future Expansion" block in invoice.service.ts.
 *   • barcodeFormat → read by the Label Engine for product labels.
 *
 * The not-yet-wired fields are shown because they are real configuration that
 * persists and will be consumed by the receipt renderer — but each says so, in
 * the UI, rather than implying an effect it does not have.
 */

import { useMemo, useState } from "react";
import { FileText, Hash, Printer } from "lucide-react";

import { Input, Select } from "@/components/ui";
import { CriticalChangeDialog } from "../components/CriticalChangeDialog";
import {
  SettingsRow,
  SettingsSaveBar,
  SettingsSection,
  SettingsToggle,
} from "../components/SettingsPrimitives";
import { SettingsErrorState, SettingsSkeleton } from "../components/SettingsStates";
import { useSettingsForm } from "../hooks/useSettingsForm";
import { findCriticalChanges } from "../validation";
import { validateReceiptSettings } from "../validation/receipt";
import { BARCODE_FORMAT_OPTIONS } from "../utils/options";
import { countChanges } from "../utils/patch";
import { previewInvoiceNumber } from "../utils/invoicePreview";

/**
 * This screen owns exactly one block.
 *
 * Store Settings owns the other eight. The split means two owners editing the
 * two screens send disjoint patches — though they still conflict on `version`,
 * which is correct: they are writing the same row (§9.2).
 */
const OWNED_BLOCKS = ["invoiceConfig"] as const;

const SECTIONS = [
  { id: "document-numbering", label: "Numbering" },
  { id: "receipt-content", label: "Receipt Content" },
  { id: "print-options", label: "Print Options" },
] as const;

export function ReceiptInvoiceSettingsPage() {
  const form = useSettingsForm({
    blocks: OWNED_BLOCKS,
    validate: validateReceiptSettings,
  });

  const {
    draft,
    isLoading,
    isError,
    error,
    refetch,
    isSaving,
    isDirty,
    isFieldDirty,
    patch,
    errorFor,
    setField,
    save,
    reset,
  } = form;

  const [confirming, setConfirming] = useState(false);

  const criticalPaths = useMemo(
    () => findCriticalChanges(patch as Record<string, unknown>),
    [patch]
  );
  const changeCount = useMemo(() => countChanges(patch), [patch]);

  function handleSave() {
    if (criticalPaths.length > 0) {
      setConfirming(true);
      return;
    }
    void save();
  }

  async function handleConfirmedSave() {
    const ok = await save();
    if (ok) setConfirming(false);
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <PageHeader />
        <SettingsSkeleton />
      </div>
    );
  }

  if (isError || !draft) {
    return (
      <div className="flex flex-col gap-5 p-4 sm:p-6">
        <PageHeader />
        <SettingsErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const invoice = draft.invoiceConfig;

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      <PageHeader version={draft.version} />

      <nav
        aria-label="Settings sections"
        className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <ul className="flex w-max gap-1 sm:w-auto sm:flex-wrap">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex h-8 items-center rounded-md px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-4">
        {/* ══ DOCUMENT NUMBERING ═════════════════════════════════════════ */}
        <SettingsSection
          id="document-numbering"
          title="Document Numbering"
          description="How invoice, exchange and purchase numbers are composed. Existing documents are never renumbered."
          icon={<Hash className="h-5 w-5" />}
        >
          <SettingsRow
            label="Invoice prefix"
            description="Applied to every new sale. Changing it mid-day starts a fresh sequence under the new prefix; existing numbers keep theirs."
            dirty={isFieldDirty("invoiceConfig", "invoicePrefix")}
            error={errorFor("invoiceConfig.invoicePrefix")}
          >
            <Input
              value={invoice.invoicePrefix}
              onChange={(e) =>
                setField("invoiceConfig", "invoicePrefix", e.target.value.toUpperCase())
              }
              placeholder="INV"
              maxLength={10}
            />
          </SettingsRow>

          <SettingsRow
            label="Sequence length"
            description="Digits in the running number. Widening or narrowing it never collides with an existing number."
            dirty={isFieldDirty("invoiceConfig", "invoiceNumberLength")}
            error={errorFor("invoiceConfig.invoiceNumberLength")}
          >
            <Input
              type="number"
              min={4}
              max={10}
              value={invoice.invoiceNumberLength}
              onChange={(e) =>
                setField(
                  "invoiceConfig",
                  "invoiceNumberLength",
                  numberFrom(e.target.value)
                )
              }
            />
          </SettingsRow>

          {/* Shows the composed result, because the two fields above only make
              sense together and neither previews on its own. */}
          <SettingsRow
            label="Next invoice will look like"
            description="Live preview. The date segment comes from the sale date; the sequence restarts each day."
          >
            <output className="block rounded-md border border-border bg-muted/50 px-3 py-2 font-mono text-sm text-foreground">
              {previewInvoiceNumber(invoice.invoicePrefix, invoice.invoiceNumberLength)}
            </output>
          </SettingsRow>

          <SettingsRow
            label="Exchange prefix"
            description="Stored for the exchange documents. Exchange numbering does not read this yet."
            dirty={isFieldDirty("invoiceConfig", "exchangePrefix")}
            error={errorFor("invoiceConfig.exchangePrefix")}
          >
            <Input
              value={invoice.exchangePrefix}
              onChange={(e) =>
                setField("invoiceConfig", "exchangePrefix", e.target.value.toUpperCase())
              }
              placeholder="EX"
              maxLength={10}
            />
          </SettingsRow>

          <SettingsRow
            label="Purchase order prefix"
            description="Stored for purchase orders. Purchase numbering does not read this yet."
            dirty={isFieldDirty("invoiceConfig", "purchasePrefix")}
            error={errorFor("invoiceConfig.purchasePrefix")}
          >
            <Input
              value={invoice.purchasePrefix}
              onChange={(e) =>
                setField("invoiceConfig", "purchasePrefix", e.target.value.toUpperCase())
              }
              placeholder="PO"
              maxLength={10}
            />
          </SettingsRow>

          <SettingsRow
            label="Reset numbering each financial year"
            description="Restarts the sequence at the financial-year boundary set in Store Settings."
            dirty={isFieldDirty("invoiceConfig", "financialYearReset")}
          >
            <SettingsToggle
              label="Reset numbering each financial year"
              checked={invoice.financialYearReset}
              onChange={(v) => setField("invoiceConfig", "financialYearReset", v)}
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ RECEIPT CONTENT ════════════════════════════════════════════ */}
        <SettingsSection
          id="receipt-content"
          title="Receipt Content"
          description="Text printed above and below the itemised lines. Store name, address and GST come from Store Information."
          icon={<FileText className="h-5 w-5" />}
        >
          <SettingsRow
            label="Receipt header"
            description="Printed under the store name. Good for a tagline or a counter number."
            dirty={isFieldDirty("invoiceConfig", "receiptHeader")}
            error={errorFor("invoiceConfig.receiptHeader")}
          >
            <textarea
              value={invoice.receiptHeader ?? ""}
              onChange={(e) => setField("invoiceConfig", "receiptHeader", e.target.value)}
              rows={2}
              maxLength={200}
              placeholder="e.g. Thank you for shopping with us"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </SettingsRow>

          <SettingsRow
            label="Receipt footer"
            description="Printed last. Commonly the exchange policy — which is enforced by the exchange window in Store Settings, not by this text."
            dirty={isFieldDirty("invoiceConfig", "receiptFooter")}
            error={errorFor("invoiceConfig.receiptFooter")}
          >
            <textarea
              value={invoice.receiptFooter ?? ""}
              onChange={(e) => setField("invoiceConfig", "receiptFooter", e.target.value)}
              rows={3}
              maxLength={300}
              placeholder="e.g. Exchange within 3 days with the original bill and tags intact"
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </SettingsRow>
        </SettingsSection>

        {/* ══ PRINT OPTIONS ══════════════════════════════════════════════ */}
        <SettingsSection
          id="print-options"
          title="Print Options"
          description="What is encoded on printed documents."
          icon={<Printer className="h-5 w-5" />}
        >
          <SettingsRow
            label="Print QR code on receipts"
            description="Stored for the receipt renderer. Not yet printed."
            dirty={isFieldDirty("invoiceConfig", "qrCodeEnabled")}
          >
            <SettingsToggle
              label="Print QR code on receipts"
              checked={invoice.qrCodeEnabled}
              onChange={(v) => setField("invoiceConfig", "qrCodeEnabled", v)}
            />
          </SettingsRow>

          <SettingsRow
            label="Barcode symbology"
            description="Used by the Label Engine for product labels. EAN-13 requires a valid 13-digit code; CODE128 encodes any SKU."
            dirty={isFieldDirty("invoiceConfig", "barcodeFormat")}
            error={errorFor("invoiceConfig.barcodeFormat")}
          >
            <Select
              value={invoice.barcodeFormat}
              options={BARCODE_FORMAT_OPTIONS}
              onChange={(e) =>
                setField(
                  "invoiceConfig",
                  "barcodeFormat",
                  e.target.value as typeof invoice.barcodeFormat
                )
              }
            />
          </SettingsRow>
        </SettingsSection>
      </div>

      <SettingsSaveBar
        visible={isDirty}
        saving={isSaving}
        changeCount={changeCount}
        onSave={handleSave}
        onDiscard={reset}
      />

      <CriticalChangeDialog
        open={confirming}
        paths={criticalPaths}
        saving={isSaving}
        onConfirm={() => void handleConfirmedSave()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}

function PageHeader({ version }: { version?: number }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Receipt &amp; Invoice Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Document numbering and printed receipt content. Changes apply to
          documents issued from now on — existing ones are never renumbered.
        </p>
      </div>
      {version !== undefined && (
        <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
          Revision {version}
        </span>
      )}
    </div>
  );
}

/** See the note on the identical helper in StoreSettingsPage. */
function numberFrom(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
