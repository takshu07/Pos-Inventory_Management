/**
 * PrinterManagementTable — OWNER-only printer CRUD with live status.
 *
 * The driver and transport lists come from the server's capability endpoint
 * rather than being hardcoded here. That is what makes "adding a printer brand
 * never requires a frontend change" true: register a driver server-side and it
 * appears in this form automatically.
 */

import * as React from "react";
import { CheckCircle2, Plug, Plus, Star, Trash2 } from "lucide-react";

import {
  Button,
  EmptyState,
  Input,
  Modal,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from "@/components/ui";

import {
  useCreatePrinter,
  useDeletePrinter,
  usePrinterCapabilities,
  usePrinters,
  useProbeAllPrinters,
  useSetDefaultPrinter,
  useTestPrinter,
  useUpdatePrinter,
} from "../hooks/useLabels";
import type {
  Printer,
  PrinterConnectionType,
  PrinterDriverType,
} from "../api/labelApi";
import { PrinterStatus } from "./PrinterStatus";

interface PrinterFormState {
  name: string;
  connection: PrinterConnectionType;
  driver: PrinterDriverType;
  host: string;
  port: string;
  endpointUrl: string;
  location: string;
  dpi: string;
  defaultWidthMm: string;
  defaultHeightMm: string;
}

const EMPTY_FORM: PrinterFormState = {
  name: "",
  connection: "NETWORK",
  driver: "ESC_POS",
  host: "",
  port: "9100",
  endpointUrl: "",
  location: "",
  dpi: "203",
  defaultWidthMm: "50",
  defaultHeightMm: "25",
};

export function PrinterManagementTable() {
  const { data: printers, isLoading } = usePrinters(true);
  const { data: capabilities } = usePrinterCapabilities();

  const createMutation = useCreatePrinter();
  const updateMutation = useUpdatePrinter();
  const deleteMutation = useDeletePrinter();
  const defaultMutation = useSetDefaultPrinter();
  const testMutation = useTestPrinter();
  const probeAllMutation = useProbeAllPrinters();

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Printer | null>(null);
  const [form, setForm] = React.useState<PrinterFormState>(EMPTY_FORM);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  }

  function openEdit(printer: Printer) {
    setEditing(printer);
    setForm({
      name: printer.name,
      connection: printer.connection,
      driver: printer.driver,
      host: printer.host ?? "",
      port: printer.port ? String(printer.port) : "9100",
      endpointUrl: printer.endpointUrl ?? "",
      location: printer.location ?? "",
      dpi: String(printer.dpi),
      defaultWidthMm: String(Number(printer.defaultWidthMm)),
      defaultHeightMm: String(Number(printer.defaultHeightMm)),
    });
    setFormOpen(true);
  }

  function handleSubmit() {
    const payload = {
      name: form.name.trim(),
      connection: form.connection,
      driver: form.driver,
      // Only send the transport fields that matter for the chosen connection —
      // a stale host on a USB printer would be confusing in the audit log.
      host: form.connection === "NETWORK" ? form.host.trim() || null : null,
      port: form.connection === "NETWORK" ? Number(form.port) || 9100 : null,
      endpointUrl: form.connection === "CLOUD" ? form.endpointUrl.trim() || null : null,
      location: form.location.trim() || null,
      dpi: Number(form.dpi) || 203,
      defaultWidthMm: Number(form.defaultWidthMm) || 50,
      defaultHeightMm: Number(form.defaultHeightMm) || 25,
    };

    if (editing) {
      updateMutation.mutate(
        { id: editing.id, payload },
        { onSuccess: () => setFormOpen(false) }
      );
    } else {
      createMutation.mutate(payload, { onSuccess: () => setFormOpen(false) });
    }
  }

  const transportForConnection = capabilities?.transports.find((transport) =>
    form.connection === "NETWORK"
      ? transport.kind === "network"
      : form.connection === "USB"
        ? transport.kind === "usb"
        : form.connection === "BLUETOOTH"
          ? transport.kind === "bluetooth"
          : form.connection === "CLOUD"
            ? transport.kind === "cloud"
            : transport.kind === "virtual"
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Printers</h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<Plug className="h-4 w-4" />}
            onClick={() => probeAllMutation.mutate()}
            loading={probeAllMutation.isPending}
          >
            Refresh status
          </Button>
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={openCreate}>
            Add printer
          </Button>
        </div>
      </div>

      {isLoading ? (
        <TableSkeleton rows={3} cols={6} />
      ) : !printers || printers.length === 0 ? (
        <EmptyState
          title="No printers configured"
          description="Add a printer to start printing labels to hardware. Until then, jobs can still produce PDFs."
          action={{ label: "Add printer", onClick: openCreate }}
        />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Connection</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Location</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {printers.map((printer) => (
                <TableRow key={printer.id} className={printer.isActive ? "" : "opacity-50"}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{printer.name}</span>
                      {printer.isDefault && (
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      )}
                      {!printer.isActive && (
                        <span className="text-xs text-muted-foreground">(inactive)</span>
                      )}
                    </div>
                    <span className="font-mono text-xs text-muted-foreground">
                      {printer.code}
                    </span>
                  </TableCell>

                  <TableCell>
                    <PrinterStatus
                      status={printer.status}
                      lastSeenAt={printer.lastSeenAt}
                      lastErrorText={printer.lastErrorText}
                    />
                  </TableCell>

                  <TableCell className="text-sm">
                    {printer.connection}
                    {printer.host && (
                      <span className="block font-mono text-xs text-muted-foreground">
                        {printer.host}:{printer.port ?? 9100}
                      </span>
                    )}
                  </TableCell>

                  <TableCell className="text-sm">{printer.driver}</TableCell>
                  <TableCell className="text-sm">{printer.location ?? "—"}</TableCell>

                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testMutation.mutate(printer.id)}
                        loading={
                          testMutation.isPending && testMutation.variables === printer.id
                        }
                      >
                        Test
                      </Button>
                      {!printer.isDefault && printer.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<CheckCircle2 className="h-3.5 w-3.5" />}
                          onClick={() => defaultMutation.mutate(printer.id)}
                        >
                          Set default
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => openEdit(printer)}>
                        Edit
                      </Button>
                      {printer.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={() => deleteMutation.mutate(printer.id)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* ── Create / edit form ────────────────────────────────────────────── */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? `Edit ${editing.name}` : "Add printer"}
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              loading={createMutation.isPending || updateMutation.isPending}
              disabled={!form.name.trim()}
            >
              {editing ? "Save changes" : "Add printer"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Input
            label="Printer name"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            placeholder="Counter 1 Label Printer"
          />

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Connection"
              value={form.connection}
              options={[
                { value: "NETWORK", label: "Network (TCP/IP)" },
                { value: "USB", label: "USB" },
                { value: "BLUETOOTH", label: "Bluetooth" },
                { value: "CLOUD", label: "Cloud / remote" },
                { value: "VIRTUAL", label: "Virtual (file output)" },
              ]}
              onChange={(event) =>
                setForm({
                  ...form,
                  connection: event.target.value as PrinterConnectionType,
                })
              }
            />

            <Select
              label="Driver"
              value={form.driver}
              options={(capabilities?.drivers ?? []).map((driver) => ({
                value: driver.type,
                label: driver.displayName,
              }))}
              onChange={(event) =>
                setForm({ ...form, driver: event.target.value as PrinterDriverType })
              }
            />
          </div>

          {/* Transports that are declared but not operational are surfaced
              here, so an owner learns before saving rather than at print time. */}
          {transportForConnection && !transportForConnection.isAvailable && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-400">
              {transportForConnection.unavailableReason}
            </p>
          )}

          {form.connection === "NETWORK" && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Input
                  label="Host / IP address"
                  required
                  value={form.host}
                  onChange={(event) => setForm({ ...form, host: event.target.value })}
                  placeholder="192.168.1.50"
                />
              </div>
              <Input
                label="Port"
                type="number"
                value={form.port}
                onChange={(event) => setForm({ ...form, port: event.target.value })}
                hint="Usually 9100"
              />
            </div>
          )}

          {form.connection === "CLOUD" && (
            <Input
              label="Endpoint URL"
              required
              value={form.endpointUrl}
              onChange={(event) => setForm({ ...form, endpointUrl: event.target.value })}
              placeholder="https://print-relay.example.com/jobs"
            />
          )}

          <Input
            label="Location"
            value={form.location}
            onChange={(event) => setForm({ ...form, location: event.target.value })}
            placeholder="Counter 1 / Stock room"
          />

          <div className="grid grid-cols-3 gap-3">
            <Input
              label="DPI"
              type="number"
              value={form.dpi}
              onChange={(event) => setForm({ ...form, dpi: event.target.value })}
              hint="203 typical"
            />
            <Input
              label="Width (mm)"
              type="number"
              step="0.5"
              value={form.defaultWidthMm}
              onChange={(event) =>
                setForm({ ...form, defaultWidthMm: event.target.value })
              }
            />
            <Input
              label="Height (mm)"
              type="number"
              step="0.5"
              value={form.defaultHeightMm}
              onChange={(event) =>
                setForm({ ...form, defaultHeightMm: event.target.value })
              }
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
