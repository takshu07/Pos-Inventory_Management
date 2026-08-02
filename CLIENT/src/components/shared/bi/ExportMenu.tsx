/**
 * Export menu — Print / CSV / Excel / PDF, on every report.
 *
 * WHY THIS BYPASSES apiClient
 * ---------------------------
 * The shared axios instance has a response interceptor that unwraps the
 * `{ success, data }` JSON envelope. Running a CSV body through that mangles
 * it, and the instance cannot express `responseType: blob` without a
 * special case per call. Fetching the URL directly keeps the transport honest
 * and lets the server's Content-Disposition drive the filename rather than the
 * client guessing one.
 *
 * PDF IS PRINTABLE HTML, DELIBERATELY
 * -----------------------------------
 * The server renders a print-ready HTML document and serves it as text/html
 * rather than claiming application/pdf for bytes it did not produce. This
 * component opens it in a new window, where the browser's own engine renders
 * the PDF via Print → Save as PDF. "Print" and "PDF" are therefore the same
 * transport with a different intent, which is why both appear here.
 */

import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Loader2, Printer, Table } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui";
import { ENV } from "@/config/env";
import { useAuthStore } from "@/store/auth.store";
import { cn } from "@/utils/cn";

export type ExportFormat = "csv" | "excel" | "pdf";

// =============================================================================
// DOWNLOAD
// =============================================================================

/**
 * Fetches an export endpoint and either downloads it or opens a print window.
 *
 * Exported standalone so a screen can trigger an export from somewhere other
 * than this menu (a keyboard shortcut, a row action) without duplicating the
 * blob/filename handling.
 */
export async function downloadExport(
  path: string,
  format: ExportFormat,
  filters: Record<string, unknown> = {}
): Promise<void> {
  const params = new URLSearchParams({ format });
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }

  const token = useAuthStore.getState().accessToken;

  const response = await fetch(`${ENV.VITE_API_URL}${path}?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    // Surface the server's message when it sent one — "Export failed (403)" is
    // far less useful than "Only an owner can export financial reports".
    let detail = `Export failed (${response.status})`;
    try {
      const body = await response.clone().json();
      if (body?.message) detail = body.message;
    } catch {
      /* Not JSON — keep the status-code message. */
    }
    throw new Error(detail);
  }

  const blob = await response.blob();

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match?.[1] ?? `export.${format === "excel" ? "xls" : format}`;

  if (format === "pdf") {
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank");
    if (!opened) {
      URL.revokeObjectURL(url);
      throw new Error("Your browser blocked the print window. Allow pop-ups for this site and try again.");
    }
    // Revoked late — revoking immediately can race the new window's load.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// =============================================================================
// MENU
// =============================================================================

const ITEMS: Array<{ format: ExportFormat; label: string; hint: string; icon: typeof FileText }> = [
  { format: "pdf", label: "Print", hint: "Opens a print-ready view", icon: Printer },
  { format: "pdf", label: "Save as PDF", hint: "Print → Save as PDF", icon: FileText },
  { format: "csv", label: "CSV", hint: "Comma-separated, opens anywhere", icon: Table },
  { format: "excel", label: "Excel", hint: "Typed cells and styling", icon: FileSpreadsheet },
];

export interface ExportMenuProps {
  /** API path, e.g. "/reports/export/sales". Format is appended as a query. */
  path: string;
  /** Current filters — the export must match the screen it was launched from. */
  filters?: Record<string, unknown>;
  label?: string;
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
}

export function ExportMenu({
  path,
  filters = {},
  label = "Export",
  size = "sm",
  disabled,
  className,
}: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click and on Escape. Both are needed: a menu that only
  // closes on click traps keyboard users, and one that only closes on Escape
  // stays open behind whatever the user clicks next.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const run = async (item: (typeof ITEMS)[number]) => {
    const key = `${item.label}`;
    setBusy(key);
    try {
      await downloadExport(path, item.format, filters);
      setOpen(false);
      if (item.format !== "pdf") toast.success(`${item.label} export ready.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-1.5 w-56 overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-lg"
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            const isBusy = busy === item.label;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={busy !== null}
                onClick={() => void run(item)}
                className="flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:opacity-60"
              >
                {isBusy ? (
                  <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="min-w-0">
                  <span className="block font-medium leading-tight">{item.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
