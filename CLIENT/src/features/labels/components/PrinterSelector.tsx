/**
 * PrinterSelector — printer picker with live status.
 *
 * Like the template list, the printer list is OWNER-scoped. Managers and
 * cashiers print to the configured default and see a disabled control rather
 * than an error — printing must not depend on being able to enumerate hardware.
 */

import { Select, type SelectOption } from "@/components/ui";

import { usePrinters } from "../hooks/useLabels";
import { PrinterStatus } from "./PrinterStatus";

export interface PrinterSelectorProps {
  value: string | null | undefined;
  onChange: (printerId: string | null) => void;
  label?: string;
  /** False for roles that may not read the printer list. */
  canReadPrinters?: boolean;
  disabled?: boolean;
  /** Show the selected printer's status beneath the control. */
  showStatus?: boolean;
}

export function PrinterSelector({
  value,
  onChange,
  label = "Printer",
  canReadPrinters = true,
  disabled,
  showStatus = true,
}: PrinterSelectorProps) {
  const { data: printers, isLoading } = usePrinters(false, {
    enabled: canReadPrinters,
  });

  if (!canReadPrinters) {
    return (
      <Select
        label={label}
        value=""
        disabled
        options={[{ value: "", label: "Default printer" }]}
        hint="Your role prints to the store's default printer."
        onChange={() => {}}
      />
    );
  }

  const options: SelectOption[] = [
    { value: "", label: isLoading ? "Loading printers…" : "Use default printer" },
    ...(printers ?? []).map((printer) => ({
      value: printer.id,
      label: `${printer.name}${printer.isDefault ? " (default)" : ""}${
        printer.location ? ` · ${printer.location}` : ""
      }`,
    })),
  ];

  const selected = printers?.find((printer) => printer.id === value);

  return (
    <div className="flex w-full flex-col gap-1.5">
      <Select
        label={label}
        value={value ?? ""}
        options={options}
        disabled={disabled || isLoading}
        onChange={(event) => onChange(event.target.value || null)}
      />

      {showStatus && selected && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <PrinterStatus
            status={selected.status}
            lastSeenAt={selected.lastSeenAt}
            lastErrorText={selected.lastErrorText}
          />
          <span>
            {selected.driver} · {selected.connection}
          </span>
        </div>
      )}

      {/* An offline printer does NOT block printing — the job queues and the
          worker retries. Saying so prevents users cancelling a valid job. */}
      {showStatus && selected?.status === "OFFLINE" && (
        <p className="text-xs text-amber-600 dark:text-amber-400">
          This printer is offline. The job will be queued and printed when it
          comes back online.
        </p>
      )}
    </div>
  );
}
