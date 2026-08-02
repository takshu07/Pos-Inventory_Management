/**
 * Create/edit form for a supplier.
 *
 * The phone rule (10-digit Indian mobile starting 6–9) is enforced identically
 * on the server, where it is also the UNIQUENESS key. Validating it here turns
 * the most common mistake into instant feedback instead of a round-trip, but the
 * server's duplicate check remains authoritative and its message is shown inline.
 */

import { useEffect, useState } from "react";
import { Button, Drawer, Input } from "@/components/ui";
import type { Supplier, SupplierWriteInput } from "../types";

interface SupplierFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** null = create mode. */
  supplier: Supplier | null;
  onSubmit: (input: SupplierWriteInput) => Promise<unknown>;
}

interface FormState {
  businessName: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

const EMPTY: FormState = {
  businessName: "",
  contactPerson: "",
  phone: "",
  email: "",
  address: "",
  notes: "",
  isActive: true,
};

const PHONE_RE = /^[6-9]\d{9}$/;

export function SupplierFormDrawer({
  open,
  onClose,
  supplier,
  onSubmit,
}: SupplierFormDrawerProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      supplier
        ? {
            businessName: supplier.businessName,
            contactPerson: supplier.contactPerson ?? "",
            phone: supplier.phone,
            email: supplier.email ?? "",
            address: supplier.address ?? "",
            notes: supplier.notes ?? "",
            isActive: supplier.isActive,
          }
        : EMPTY
    );
    setErrors({});
    setServerError(null);
  }, [open, supplier]);

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};

    const name = form.businessName.trim();
    if (name.length < 2) next.businessName = "Business name must be at least 2 characters.";
    else if (name.length > 100) next.businessName = "Business name must be 100 characters or fewer.";

    if (!PHONE_RE.test(form.phone.trim())) {
      next.phone = "Enter a valid 10-digit mobile number starting with 6–9.";
    }

    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      next.email = "Enter a valid email address.";
    }

    if (form.address.length > 500) next.address = "Address must be 500 characters or fewer.";
    if (form.notes.length > 1000) next.notes = "Notes must be 1000 characters or fewer.";

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setBusy(true);
    setServerError(null);
    try {
      await onSubmit({
        businessName: form.businessName.trim(),
        contactPerson: form.contactPerson.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        notes: form.notes.trim() || undefined,
        ...(supplier ? { isActive: form.isActive } : {}),
      });
      onClose();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "The supplier could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }

  const field = (key: keyof FormState) => ({
    value: String(form[key]),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
    "aria-invalid": Boolean(errors[key]),
  });

  return (
    <Drawer
      open={open}
      onClose={busy ? () => {} : onClose}
      title={supplier ? `Edit ${supplier.businessName}` : "New supplier"}
      description={
        supplier
          ? "Changes apply to future purchases; existing bills keep their history."
          : "Add a supplier you can raise purchase orders against."
      }
    >
      <form onSubmit={handleSubmit} className="flex h-full flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto p-1">
          <Field
            id="sup-name"
            label="Business name"
            required
            error={errors.businessName}
          >
            <Input id="sup-name" {...field("businessName")} placeholder="e.g. Sharma Textiles" autoFocus />
          </Field>

          <Field id="sup-contact" label="Contact person" error={errors.contactPerson}>
            <Input id="sup-contact" {...field("contactPerson")} placeholder="Who you deal with" />
          </Field>

          <Field id="sup-phone" label="Phone" required error={errors.phone}>
            <Input
              id="sup-phone"
              {...field("phone")}
              placeholder="10-digit mobile"
              inputMode="numeric"
              maxLength={10}
            />
          </Field>

          <Field id="sup-email" label="Email" error={errors.email}>
            <Input id="sup-email" {...field("email")} type="email" placeholder="billing@supplier.com" />
          </Field>

          <Field id="sup-address" label="Address" error={errors.address}>
            <textarea
              id="sup-address"
              {...field("address")}
              rows={2}
              placeholder="Optional"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>

          <Field id="sup-notes" label="Notes" error={errors.notes}>
            <textarea
              id="sup-notes"
              {...field("notes")}
              rows={3}
              placeholder="Payment terms, delivery preferences, anything worth remembering"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>

          {supplier && (
            <label className="flex items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
                className="mt-0.5 h-4 w-4 rounded border-input"
              />
              <span className="text-sm">
                <span className="font-medium text-foreground">Active</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Inactive suppliers keep every bill and payment but cannot be
                  chosen for new purchases.
                </span>
              </span>
            </label>
          )}

          {serverError && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {serverError}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} className="flex-1">
            {supplier ? "Save changes" : "Create supplier"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function Field({
  id,
  label,
  required,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
