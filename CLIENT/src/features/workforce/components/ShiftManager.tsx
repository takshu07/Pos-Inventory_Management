/**
 * Shift management (OWNER only) — create, edit and bulk-assign shifts.
 *
 * A drawer on the Attendance page rather than a new route: a shift only means
 * anything through the attendance it produces, so managing shifts belongs
 * beside the register they drive.
 *
 * `expectedMinutes` is deliberately NOT an input. It is the denominator of
 * every attendance percentage, so the server derives it from start/end/break —
 * letting it be typed would let someone make attendance read however they like.
 * The form shows the derived value so the effect of a change is visible.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Plus, Users } from "lucide-react";

import { Badge, Button, Card, Drawer, Input } from "@/components/ui";
import { cn } from "@/utils/cn";
import {
  useAssignShift,
  useCreateShift,
  useRoster,
  useShifts,
  useUpdateShift,
} from "../hooks/useWorkforce";
import { formatDuration, formatShiftWindow } from "../utils/format";
import type { Shift } from "../types";

/** Minutes-from-midnight ⇄ "HH:MM", the format a time input speaks. */
function toTimeValue(minutes: number): string {
  const h = Math.floor(((minutes % 1440) + 1440) % 1440 / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function fromTimeValue(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Mirrors the server's deriveExpectedMinutes, so the preview matches the save. */
function deriveExpected(start: number, end: number, breakMinutes: number): number {
  const normalisedEnd = end <= start ? end + 1440 : end;
  return Math.max(0, normalisedEnd - start - breakMinutes);
}

const WEEKDAYS = [
  { value: 0, label: "Sun" },
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
];

const BLANK = {
  name: "",
  code: "",
  startMinute: 540, // 09:00
  endMinute: 1080, // 18:00
  breakMinutes: 60,
  graceMinutes: 10,
  workingDays: [1, 2, 3, 4, 5, 6],
  isActive: true,
};

export function ShiftManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: shifts } = useShifts();
  const roster = useRoster("staff", { page: 1, limit: 200 });

  const createShift = useCreateShift();
  const updateShift = useUpdateShift();
  const assignShift = useAssignShift();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK);
  const [assignTo, setAssignTo] = useState<string[]>([]);

  // Seed the form when an existing shift is picked for editing.
  useEffect(() => {
    if (!editingId) {
      setForm(BLANK);
      return;
    }
    const shift = shifts?.find((s) => s.id === editingId);
    if (!shift) return;

    setForm({
      name: shift.name,
      code: shift.code,
      startMinute: shift.startMinute,
      endMinute: shift.endMinute,
      breakMinutes: shift.breakMinutes,
      graceMinutes: shift.graceMinutes,
      workingDays: shift.workingDays ?? [1, 2, 3, 4, 5, 6],
      isActive: shift.isActive ?? true,
    });
  }, [editingId, shifts]);

  const expected = useMemo(
    () => deriveExpected(form.startMinute, form.endMinute, form.breakMinutes),
    [form.startMinute, form.endMinute, form.breakMinutes]
  );

  const isOvernight = form.endMinute <= form.startMinute;
  const canSave = form.name.trim() !== "" && form.code.trim() !== "";

  const save = () => {
    if (!canSave) return;

    const payload = {
      name: form.name.trim(),
      code: form.code.trim().toUpperCase(),
      startMinute: form.startMinute,
      endMinute: form.endMinute,
      breakMinutes: form.breakMinutes,
      graceMinutes: form.graceMinutes,
      workingDays: form.workingDays,
      isActive: form.isActive,
    };

    if (editingId) {
      updateShift.mutate({ id: editingId, payload }, { onSuccess: () => setEditingId(null) });
    } else {
      createShift.mutate(payload, { onSuccess: () => setForm(BLANK) });
    }
  };

  const toggleDay = (day: number) =>
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(day)
        ? f.workingDays.filter((d) => d !== day)
        : [...f.workingDays, day].sort(),
    }));

  const toggleEmployee = (id: string) =>
    setAssignTo((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const saving = createShift.isPending || updateShift.isPending;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Shift management"
      description="Define working windows and assign them to staff."
      width="w-full max-w-2xl"
    >
      <div className="flex flex-col gap-6">
        {/* ── Existing shifts ────────────────────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Shifts
          </h3>

          {(shifts ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No shifts yet. Create one below — attendance can still be recorded without a
              shift, but late and overtime cannot be judged.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {(shifts ?? []).map((shift) => (
                <ShiftRow
                  key={shift.id}
                  shift={shift}
                  active={editingId === shift.id}
                  onEdit={() => setEditingId(shift.id)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Create / edit form ─────────────────────────────────────────── */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {editingId ? "Edit shift" : "New shift"}
            </h3>
            {editingId && (
              <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                Cancel edit
              </Button>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Labelled label="Name">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Morning"
                maxLength={60}
              />
            </Labelled>
            <Labelled label="Code">
              <Input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="MOR"
                maxLength={20}
              />
            </Labelled>
            <Labelled label="Starts">
              <Input
                type="time"
                value={toTimeValue(form.startMinute)}
                onChange={(e) => setForm({ ...form, startMinute: fromTimeValue(e.target.value) })}
              />
            </Labelled>
            <Labelled label="Ends">
              <Input
                type="time"
                value={toTimeValue(form.endMinute)}
                onChange={(e) => setForm({ ...form, endMinute: fromTimeValue(e.target.value) })}
              />
            </Labelled>
            <Labelled label="Break (minutes)">
              <Input
                type="number"
                min={0}
                max={480}
                value={form.breakMinutes}
                onChange={(e) => setForm({ ...form, breakMinutes: Number(e.target.value) })}
              />
            </Labelled>
            <Labelled
              label="Grace (minutes)"
              hint="Arriving later than this counts as late."
            >
              <Input
                type="number"
                min={0}
                max={120}
                value={form.graceMinutes}
                onChange={(e) => setForm({ ...form, graceMinutes: Number(e.target.value) })}
              />
            </Labelled>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Working days</span>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((d) => (
                <button
                  key={d.value}
                  type="button"
                  onClick={() => toggleDay(d.value)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-xs transition-colors",
                    form.workingDays.includes(d.value)
                      ? "border-primary bg-primary/10 font-medium text-foreground"
                      : "border-border text-muted-foreground hover:text-foreground"
                  )}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Derived, never typed — see the header note. */}
          <Card className="flex items-center justify-between gap-3 p-3">
            <div className="text-xs text-muted-foreground">
              Expected paid hours
              <span className="ml-1 text-[11px]">(derived from the window minus break)</span>
            </div>
            <div className="text-sm font-semibold tabular-nums">{formatDuration(expected)}</div>
          </Card>

          {isOvernight && (
            <p className="text-[11px] text-muted-foreground">
              This shift ends the next day — handled as an overnight window.
            </p>
          )}

          <Button
            onClick={save}
            disabled={!canSave || saving}
            loading={saving}
            leftIcon={editingId ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          >
            {editingId ? "Save shift" : "Create shift"}
          </Button>

          {(createShift.isError || updateShift.isError) && (
            <p className="text-sm text-destructive">
              Could not save the shift. The name and code must each be unique.
            </p>
          )}
        </section>

        {/* ── Bulk assignment ────────────────────────────────────────────── */}
        {editingId && (
          <section className="flex flex-col gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Assign employees to this shift
            </h3>

            <div className="max-h-64 overflow-y-auto rounded-lg border border-border">
              {(roster.data?.data ?? []).map((emp) => (
                <label
                  key={emp.id}
                  className="flex cursor-pointer items-center gap-2.5 border-b border-border/60 px-3 py-2 last:border-0 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={assignTo.includes(emp.id)}
                    onChange={() => toggleEmployee(emp.id)}
                    className="h-4 w-4"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">{emp.fullName}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {emp.shift ? `Currently: ${emp.shift.name}` : "Unassigned"}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={assignTo.length === 0 || assignShift.isPending}
                loading={assignShift.isPending}
                onClick={() =>
                  assignShift.mutate(
                    { shiftId: editingId, employeeIds: assignTo },
                    { onSuccess: () => setAssignTo([]) }
                  )
                }
                leftIcon={<Users className="h-3.5 w-3.5" />}
              >
                Assign {assignTo.length > 0 ? `(${assignTo.length})` : ""}
              </Button>

              {/* Clearing is the same endpoint with a null shift — one code path
                  for assign and unassign, so they cannot diverge. */}
              <Button
                variant="outline"
                size="sm"
                disabled={assignTo.length === 0 || assignShift.isPending}
                onClick={() =>
                  assignShift.mutate(
                    { shiftId: null, employeeIds: assignTo },
                    { onSuccess: () => setAssignTo([]) }
                  )
                }
              >
                Unassign
              </Button>
            </div>
          </section>
        )}
      </div>
    </Drawer>
  );
}

function ShiftRow({
  shift,
  active,
  onEdit,
}: {
  shift: Shift;
  active: boolean;
  onEdit: () => void;
}) {
  return (
    <Card
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 p-3 transition-colors",
        active ? "border-primary/50" : "hover:border-primary/30"
      )}
      onClick={onEdit}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: shift.colorHex ?? "#94a3b8" }}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{shift.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {formatShiftWindow(shift.startMinute, shift.endMinute)} ·{" "}
            {formatDuration(shift.expectedMinutes)} paid · {shift.breakMinutes}m break
          </div>
        </div>
      </div>

      {shift.isActive === false && <Badge variant="secondary">Inactive</Badge>}
    </Card>
  );
}

function Labelled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}
