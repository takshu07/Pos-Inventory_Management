/**
 * Create/edit form for a brand.
 *
 * Validation mirrors the server's Zod schema (name 2–50 chars, unique; optional
 * description ≤500; optional URL). Client validation here is a courtesy that
 * avoids a pointless round-trip — the server remains authoritative, and its
 * uniqueness error is surfaced inline rather than swallowed.
 */

import { useEffect, useState } from "react";
import { Button, Drawer, Input } from "@/components/ui";
import type { Brand, BrandWriteInput } from "../types";

interface BrandFormDrawerProps {
  open: boolean;
  onClose: () => void;
  /** null = create mode. */
  brand: Brand | null;
  onSubmit: (input: BrandWriteInput) => Promise<unknown>;
  /** Names already in the list, for instant duplicate feedback. */
  existingNames: string[];
}

interface FormState {
  name: string;
  description: string;
  logoUrl: string;
  isActive: boolean;
}

const EMPTY: FormState = { name: "", description: "", logoUrl: "", isActive: true };

export function BrandFormDrawer({
  open,
  onClose,
  brand,
  onSubmit,
  existingNames,
}: BrandFormDrawerProps) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reload the drawer's fields whenever it opens or switches record, so an
  // aborted edit never leaks into the next one.
  useEffect(() => {
    if (!open) return;
    setForm(
      brand
        ? {
            name: brand.name,
            description: brand.description ?? "",
            logoUrl: brand.logoUrl ?? "",
            isActive: brand.isActive,
          }
        : EMPTY
    );
    setErrors({});
    setServerError(null);
  }, [open, brand]);

  function validate(): boolean {
    const next: Partial<Record<keyof FormState, string>> = {};
    const name = form.name.trim();

    if (name.length < 2) next.name = "Name must be at least 2 characters.";
    else if (name.length > 50) next.name = "Name must be 50 characters or fewer.";
    else if (
      existingNames.some(
        (n) => n.toLowerCase() === name.toLowerCase() && n !== brand?.name
      )
    ) {
      next.name = "A brand with this name already exists.";
    }

    if (form.description.length > 500) {
      next.description = "Description must be 500 characters or fewer.";
    }

    if (form.logoUrl.trim()) {
      try {
        new URL(form.logoUrl.trim());
      } catch {
        next.logoUrl = "Enter a valid URL (including https://).";
      }
    }

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
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        logoUrl: form.logoUrl.trim() || undefined,
        ...(brand ? { isActive: form.isActive } : {}),
      });
      onClose();
    } catch (err) {
      setServerError(
        err instanceof Error ? err.message : "The brand could not be saved."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={busy ? () => {} : onClose}
      title={brand ? `Edit ${brand.name}` : "New brand"}
      description={
        brand
          ? "Changes apply everywhere this brand appears."
          : "Add a brand you can assign to products."
      }
    >
      <form onSubmit={handleSubmit} className="flex h-full flex-col">
        <div className="flex-1 space-y-5 overflow-y-auto p-1">
          <div className="space-y-1.5">
            <label htmlFor="brand-name" className="text-sm font-medium text-foreground">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="brand-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Levi's"
              autoFocus
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? "brand-name-error" : undefined}
            />
            {errors.name && (
              <p id="brand-name-error" role="alert" className="text-xs text-destructive">
                {errors.name}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="brand-description"
              className="text-sm font-medium text-foreground"
            >
              Description
            </label>
            <textarea
              id="brand-description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={3}
              placeholder="Optional note about this brand"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              {form.description.length}/500
            </p>
            {errors.description && (
              <p role="alert" className="text-xs text-destructive">
                {errors.description}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="brand-logo" className="text-sm font-medium text-foreground">
              Logo URL
            </label>
            <Input
              id="brand-logo"
              value={form.logoUrl}
              onChange={(e) => setForm((f) => ({ ...f, logoUrl: e.target.value }))}
              placeholder="https://…"
              aria-invalid={Boolean(errors.logoUrl)}
            />
            {errors.logoUrl && (
              <p role="alert" className="text-xs text-destructive">
                {errors.logoUrl}
              </p>
            )}
          </div>

          {/* Only offered on edit: a brand is always created active. */}
          {brand && (
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
                  Inactive brands stay on existing products and reports but are
                  hidden from pickers.
                </span>
              </span>
            </label>
          )}

          {serverError && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} className="flex-1">
            {brand ? "Save changes" : "Create brand"}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}
