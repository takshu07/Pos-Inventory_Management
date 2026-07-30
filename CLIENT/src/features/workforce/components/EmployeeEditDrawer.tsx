/**
 * Owner-only employee edit form.
 *
 * Scope is deliberately narrow: the WORKFORCE-owned fields only (shift,
 * employment status, register, target, emergency contact). Core identity —
 * name, phone, email, role — belongs to the employee module, which owns
 * uniqueness and the role hierarchy; duplicating those writes here would put
 * two sources of truth on the same columns.
 *
 * Setting `monthlyTarget` is what unlocks the performance score, so it is the
 * field this form exists for as much as anything.
 */

import { useEffect, useState } from "react";

import { Button, Drawer, Input, Select } from "@/components/ui";
import { useShifts, useUpdateEmployee } from "../hooks/useWorkforce";
import { formatShiftWindow } from "../utils/format";
import type { EmploymentStatus, WorkforceEmployee } from "../types";

const EMPLOYMENT_OPTIONS: Array<{ value: EmploymentStatus; label: string }> = [
  { value: "ACTIVE", label: "Active" },
  { value: "PROBATION", label: "Probation" },
  { value: "ON_LEAVE", label: "On Leave" },
  { value: "SUSPENDED", label: "Suspended" },
  { value: "TERMINATED", label: "Terminated" },
];

export function EmployeeEditDrawer({
  employee,
  open,
  onClose,
}: {
  employee: WorkforceEmployee | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: shifts } = useShifts();
  const update = useUpdateEmployee();

  const [shiftId, setShiftId] = useState("");
  const [employmentStatus, setEmploymentStatus] = useState<EmploymentStatus>("ACTIVE");
  const [assignedRegister, setAssignedRegister] = useState("");
  const [monthlyTarget, setMonthlyTarget] = useState("");
  const [storeCode, setStoreCode] = useState("");

  // Re-seed whenever a different employee is opened. Without this the form
  // would show the previous employee's values over the new one's name.
  useEffect(() => {
    if (!employee) return;
    setShiftId(employee.shift?.id ?? "");
    setEmploymentStatus(employee.employmentStatus);
    setAssignedRegister(employee.assignedRegister ?? "");
    setMonthlyTarget(employee.monthlyTarget != null ? String(employee.monthlyTarget) : "");
    setStoreCode(employee.storeCode ?? "");
  }, [employee]);

  if (!employee) return null;

  const submit = () => {
    const trimmedTarget = monthlyTarget.trim();

    update.mutate(
      {
        id: employee.id,
        payload: {
          shiftId: shiftId || null,
          employmentStatus,
          assignedRegister: assignedRegister.trim() || null,
          // An empty box CLEARS the target (null), it does not mean zero.
          // Null and 0 are different facts — see the null-safety rule on the
          // performance score.
          monthlyTarget: trimmedTarget === "" ? null : Number(trimmedTarget),
          storeCode: storeCode.trim() || null,
        },
      },
      { onSuccess: onClose }
    );
  };

  const shiftOptions = [
    { value: "", label: "Unassigned" },
    ...(shifts ?? []).map((s) => ({
      value: s.id,
      label: `${s.name} (${formatShiftWindow(s.startMinute, s.endMinute)})`,
    })),
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Edit ${employee.fullName}`}
      description="Shift, employment status, assigned till and sales target."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={update.isPending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Shift">
          <Select
            options={shiftOptions}
            value={shiftId}
            onChange={(e) => setShiftId(e.target.value)}
          />
        </Field>

        <Field label="Employment status">
          <Select
            options={EMPLOYMENT_OPTIONS}
            value={employmentStatus}
            onChange={(e) => setEmploymentStatus(e.target.value as EmploymentStatus)}
          />
        </Field>

        <Field label="Assigned register / counter">
          <Input
            value={assignedRegister}
            onChange={(e) => setAssignedRegister(e.target.value)}
            placeholder="e.g. Counter 1"
            maxLength={50}
          />
        </Field>

        <Field
          label="Monthly sales target"
          hint="Leave empty for no target. Without one, this employee has no performance score or target percentage — they are shown as “Not set”, not as zero."
        >
          <Input
            type="number"
            min={0}
            value={monthlyTarget}
            onChange={(e) => setMonthlyTarget(e.target.value)}
            placeholder="e.g. 100000"
          />
        </Field>

        <Field label="Store code" hint="Leave empty for the default store.">
          <Input
            value={storeCode}
            onChange={(e) => setStoreCode(e.target.value)}
            placeholder="e.g. MAIN"
            maxLength={50}
          />
        </Field>

        {update.isError && (
          <p className="text-sm text-destructive">
            Could not save. Check the values and try again.
          </p>
        )}
      </div>
    </Drawer>
  );
}

function Field({
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
