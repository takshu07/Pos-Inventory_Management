/**
 * Export control, shared by every inventory report screen.
 *
 * The filters currently on screen are passed straight through to the server,
 * which runs the SAME scoped function the screen used — so the file matches
 * what the user is looking at, including every row of it rather than just the
 * page they happen to be on.
 *
 * PDF is served as printable HTML and opens a print window rather than
 * downloading. That is stated on the menu item, because a button labelled "PDF"
 * that opens a print dialog is otherwise surprising.
 */

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";

import { Button } from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  downloadReport,
  type ExportFormat,
  type InventoryReport,
} from "../api/inventoryApi";

const FORMATS: Array<{
  value: ExportFormat;
  label: string;
  hint: string;
  icon: React.ElementType;
}> = [
  { value: "csv", label: "CSV", hint: "Opens in any spreadsheet", icon: FileText },
  { value: "excel", label: "Excel", hint: "Typed cells and formatting", icon: FileSpreadsheet },
  { value: "pdf", label: "PDF", hint: "Opens a print window", icon: Printer },
];

export function InventoryExportMenu({
  report,
  filters,
  disabled,
}: {
  report: InventoryReport;
  /** The screen's current filters — the export mirrors them exactly. */
  filters?: Record<string, unknown>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState(false);

  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — a menu that can only be dismissed by
  // picking something is a trap.
  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const run = async (format: ExportFormat) => {
    setBusy(format);
    setError(false);
    try {
      await downloadReport(report, format, filters ?? {});
      setOpen(false);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || busy !== null}
        onClick={() => setOpen((v) => !v)}
        leftIcon={
          busy ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )
        }
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Export
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-lg"
        >
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="menuitem"
              disabled={busy !== null}
              onClick={() => run(f.value)}
              className={cn(
                "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                "hover:bg-muted disabled:opacity-50"
              )}
            >
              <f.icon
                className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{f.label}</span>
                <span className="block text-[11px] text-muted-foreground">{f.hint}</span>
              </span>
              {busy === f.value && (
                <Loader2 className="ml-auto mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
              )}
            </button>
          ))}

          {error && (
            <p className="border-t border-border px-3 py-2 text-[11px] text-destructive">
              Export failed. Please try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
