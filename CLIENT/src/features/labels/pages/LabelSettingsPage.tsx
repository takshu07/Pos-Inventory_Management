/**
 * LabelSettingsPage — OWNER-only label engine administration.
 *
 * Printers, templates, barcode encoding and defaults in one place. Reached only
 * inside the OwnerRoute subtree; the backend enforces the same restriction
 * independently, so a manager typing the URL gets both a redirect and a 403.
 *
 * DEEP LINKING
 * ------------
 * The active tab is held in the URL (`?tab=barcode`) rather than in local state
 * alone, because /admin/settings/barcode redirects here with that param — the
 * sidebar's "Barcode Settings" entry has to land on the barcode section, not on
 * whatever tab happens to be first. It also makes the tabs linkable and
 * back-button correct, which local state would not.
 *
 * An unknown or missing `tab` falls back to "settings" rather than erroring, so
 * a stale bookmark degrades to the default view instead of a blank page.
 */

import { useSearchParams } from "react-router";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/utils/cn";

import { BarcodeSettings } from "../components/BarcodeSettings";
import { LabelTemplateTable } from "../components/LabelTemplateTable";
import { PrinterManagementTable } from "../components/PrinterManagementTable";
import { PrinterSettings } from "../components/PrinterSettings";

const TABS = [
  {
    id: "settings",
    label: "Defaults",
    description: "Default printer, template, sizes, quality and workflow toggles.",
  },
  {
    id: "barcode",
    label: "Barcode",
    description: "Symbology, printed size and when barcodes are produced.",
  },
  {
    id: "printers",
    label: "Printers",
    description: "Add, configure and test the printers this store can use.",
  },
  {
    id: "templates",
    label: "Templates",
    description: "The label layouts available for printing.",
  },
] as const;

type Tab = (typeof TABS)[number]["id"];

const TAB_IDS = TABS.map((entry) => entry.id) as readonly string[];

function isTab(value: string | null): value is Tab {
  return value !== null && TAB_IDS.includes(value);
}

export default function LabelSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const param = searchParams.get("tab");
  const tab: Tab = isTab(param) ? param : "settings";

  const selectTab = (next: Tab) => {
    // `replace` so clicking through four tabs does not bury the previous page
    // under four history entries the back button has to walk out of.
    setSearchParams(next === "settings" ? {} : { tab: next }, { replace: true });
  };

  const active = TABS.find((entry) => entry.id === tab);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Label & Printer Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how every printable label and barcode in the system is produced.
        </p>
      </div>

      <div
        className="flex gap-1 border-b border-border"
        role="tablist"
        aria-label="Label settings sections"
      >
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            id={`label-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`label-panel-${entry.id}`}
            onClick={() => selectTab(entry.id)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              tab === entry.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`label-panel-${tab}`}
        aria-labelledby={`label-tab-${tab}`}
      >
        {tab === "settings" && <PrinterSettings />}

        {tab === "barcode" && <BarcodeSettings />}

        {tab === "printers" && (
          <Card>
            <CardHeader>
              <CardTitle>Printers</CardTitle>
              <CardDescription>{active?.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <PrinterManagementTable />
            </CardContent>
          </Card>
        )}

        {tab === "templates" && (
          <Card>
            <CardHeader>
              <CardTitle>Label templates</CardTitle>
              <CardDescription>
                Built-in templates are protected — duplicate one to create an
                editable copy.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <LabelTemplateTable />
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
