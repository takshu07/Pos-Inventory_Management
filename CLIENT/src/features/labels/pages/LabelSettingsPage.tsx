/**
 * LabelSettingsPage — OWNER-only label engine administration.
 *
 * Printers, templates and defaults in one place. Reached only inside the
 * OwnerRoute subtree; the backend enforces the same restriction independently,
 * so a manager typing the URL gets both a redirect and a 403.
 */

import * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/utils/cn";

import { LabelTemplateTable } from "../components/LabelTemplateTable";
import { PrinterManagementTable } from "../components/PrinterManagementTable";
import { PrinterSettings } from "../components/PrinterSettings";

type Tab = "settings" | "printers" | "templates";

const TABS: Array<{ id: Tab; label: string; description: string }> = [
  {
    id: "settings",
    label: "Defaults",
    description: "Default printer, template, sizes, quality and workflow toggles.",
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
];

export default function LabelSettingsPage() {
  const [tab, setTab] = React.useState<Tab>("settings");
  const active = TABS.find((entry) => entry.id === tab);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Label & Printer Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure how every printable label in the system is produced.
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
            aria-selected={tab === entry.id}
            onClick={() => setTab(entry.id)}
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

      {tab === "settings" && <PrinterSettings />}

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
  );
}
