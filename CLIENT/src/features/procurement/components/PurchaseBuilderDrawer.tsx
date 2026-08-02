/**
 * Purchase order builder.
 *
 * TOTALS ARE COMPUTED HERE FOR PREVIEW ONLY. The server recomputes subtotal and
 * total from the submitted lines and is the sole authority — this mirrors its
 * arithmetic (`subtotal - discount + tax`) so the number the user approves is
 * the number that gets saved, but a mismatch would be resolved in the server's
 * favour, not this component's.
 *
 * DRAFT vs ORDERED is a real distinction, not a formality: a DRAFT is a
 * working document, while ORDERED means it has been placed with the supplier.
 * Both create a payable — the bill exists either way — which is why the due
 * date is offered at creation.
 */

import { useMemo, useState } from "react";
import { Package, Plus, Search, Trash2, X } from "lucide-react";
import { Button, Card, Drawer, Input, Select } from "@/components/ui";
import { formatCurrencyExact, formatNumber } from "@/components/shared/bi";
import {
  useProductSearch,
  useProductVariants,
  useSupplierOptions,
} from "../hooks/useProcurement";
import type { CreatePurchaseInput, VariantOption } from "../types";

interface Line extends VariantOption {
  quantity: number;
  /** Cost for THIS purchase — defaults to the variant's current cost. */
  lineCost: number;
  lineSelling: number;
}

interface PurchaseBuilderDrawerProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: CreatePurchaseInput) => Promise<unknown>;
}

export function PurchaseBuilderDrawer({
  open,
  onClose,
  onSubmit,
}: PurchaseBuilderDrawerProps) {
  const [supplierId, setSupplierId] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState("0");
  const [tax, setTax] = useState("0");
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<"DRAFT" | "ORDERED">("ORDERED");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Product picker state
  const [query, setQuery] = useState("");
  const [pickedProduct, setPickedProduct] = useState<{ id: string; name: string } | null>(null);

  const { data: suppliers = [] } = useSupplierOptions();
  const { data: products = [], isFetching: searching } = useProductSearch(query);
  const { data: variants = [], isLoading: variantsLoading } = useProductVariants(
    pickedProduct?.id ?? null
  );

  const discountNum = Math.max(0, Number(discount) || 0);
  const taxNum = Math.max(0, Number(tax) || 0);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * l.lineCost, 0),
    [lines]
  );
  const total = subtotal - discountNum + taxNum;

  function reset() {
    setSupplierId("");
    setInvoiceNumber("");
    setDueDate("");
    setNotes("");
    setDiscount("0");
    setTax("0");
    setLines([]);
    setStatus("ORDERED");
    setError(null);
    setQuery("");
    setPickedProduct(null);
  }

  function addVariant(v: VariantOption) {
    setLines((prev) => {
      // Adding the same variant twice bumps its quantity instead of creating a
      // duplicate line — two lines for one SKU is confusing and the server
      // would happily accept it.
      const existing = prev.findIndex((l) => l.variantId === v.variantId);
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = { ...next[existing]!, quantity: next[existing]!.quantity + 1 };
        return next;
      }
      return [
        ...prev,
        { ...v, quantity: 1, lineCost: v.costPrice, lineSelling: v.sellingPrice },
      ];
    });
  }

  function patchLine(variantId: string, patch: Partial<Line>) {
    setLines((prev) =>
      prev.map((l) => (l.variantId === variantId ? { ...l, ...patch } : l))
    );
  }

  function removeLine(variantId: string) {
    setLines((prev) => prev.filter((l) => l.variantId !== variantId));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!supplierId) return setError("Choose a supplier.");
    if (lines.length === 0) return setError("Add at least one product line.");
    if (lines.some((l) => l.quantity <= 0)) return setError("Every line needs a quantity of at least 1.");
    if (total < 0) return setError("The discount cannot exceed the subtotal plus tax.");

    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        supplierId,
        supplierInvoiceNumber: invoiceNumber.trim() || undefined,
        notes: notes.trim() || undefined,
        discountAmount: discountNum,
        taxAmount: taxNum,
        status,
        dueDate: dueDate || undefined,
        items: lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          costPrice: l.lineCost,
          sellingPriceAtPurchase: l.lineSelling,
        })),
      });
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The purchase could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={busy ? () => {} : onClose}
      title="New purchase order"
      description="Choose a supplier, add the products you are buying, and set the terms."
      width="max-w-3xl"
    >
      <form onSubmit={handleSubmit} className="flex h-full flex-col">
        <div className="flex-1 space-y-6 overflow-y-auto p-1">
          {/* ── Supplier & terms ──────────────────────────────────────────── */}
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="po-supplier" className="text-sm font-medium text-foreground">
                Supplier <span className="text-destructive">*</span>
              </label>
              <Select
                id="po-supplier"
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                options={[
                  { value: "", label: "Choose a supplier…" },
                  ...suppliers.map((s) => ({ value: s.id, label: s.businessName })),
                ]}
              />
              {suppliers.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No active suppliers. Add one before raising a purchase.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="po-status" className="text-sm font-medium text-foreground">
                Status
              </label>
              <Select
                id="po-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as "DRAFT" | "ORDERED")}
                options={[
                  { value: "ORDERED", label: "Ordered — placed with the supplier" },
                  { value: "DRAFT", label: "Draft — still being prepared" },
                ]}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="po-invoice" className="text-sm font-medium text-foreground">
                Supplier invoice number
              </label>
              <Input
                id="po-invoice"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="po-due" className="text-sm font-medium text-foreground">
                Payment due date
              </label>
              <Input
                id="po-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave blank if there is no agreed term — the bill will not be
                flagged overdue.
              </p>
            </div>
          </section>

          {/* ── Product picker ────────────────────────────────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Products</h3>

            {!pickedProduct ? (
              <div className="space-y-2">
                <div className="relative">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search products by name or SKU (at least 2 characters)…"
                    className="pl-9"
                    aria-label="Search products to add"
                  />
                </div>

                {query.trim().length >= 2 && (
                  <Card className="max-h-56 overflow-y-auto p-1">
                    {searching ? (
                      <p className="p-3 text-sm text-muted-foreground">Searching…</p>
                    ) : products.length === 0 ? (
                      <p className="p-3 text-sm text-muted-foreground">
                        No products match “{query}”.
                      </p>
                    ) : (
                      products.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPickedProduct({ id: p.id, name: p.name })}
                          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <Package className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-foreground">
                              {p.name}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {p.brand?.name ? `${p.brand.name} · ` : ""}
                              {formatNumber(p.variantCount)} variant(s)
                            </span>
                          </span>
                        </button>
                      ))
                    )}
                  </Card>
                )}
              </div>
            ) : (
              <Card className="p-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">
                    {pickedProduct.name} — choose variants
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setPickedProduct(null)}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                    Back to search
                  </Button>
                </div>

                {variantsLoading ? (
                  <p className="text-sm text-muted-foreground">Loading variants…</p>
                ) : variants.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    This product has no variants to purchase.
                  </p>
                ) : (
                  <div className="max-h-48 space-y-1 overflow-y-auto">
                    {variants.map((v) => (
                      <button
                        key={v.variantId}
                        type="button"
                        onClick={() => addVariant(v)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">
                            {[v.sizeName, v.colorName].filter(Boolean).join(" · ") || "Default"}
                          </span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {v.sku}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatNumber(v.currentStock)} in stock
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </Card>
            )}
          </section>

          {/* ── Lines ─────────────────────────────────────────────────────── */}
          {lines.length > 0 && (
            <section className="space-y-2">
              {lines.map((l) => (
                <Card key={l.variantId} className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {l.productName}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        <span className="font-mono">{l.sku}</span>
                        {[l.sizeName, l.colorName].filter(Boolean).map((x) => ` · ${x}`).join("")}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLine(l.variantId)}
                      aria-label={`Remove ${l.sku}`}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <LineField label="Quantity" htmlFor={`q-${l.variantId}`}>
                      <Input
                        id={`q-${l.variantId}`}
                        value={String(l.quantity)}
                        onChange={(e) =>
                          patchLine(l.variantId, {
                            quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                          })
                        }
                        inputMode="numeric"
                        className="text-right tabular-nums"
                      />
                    </LineField>

                    <LineField label="Unit cost" htmlFor={`c-${l.variantId}`}>
                      <Input
                        id={`c-${l.variantId}`}
                        value={String(l.lineCost)}
                        onChange={(e) =>
                          patchLine(l.variantId, {
                            lineCost: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        inputMode="decimal"
                        className="text-right tabular-nums"
                      />
                    </LineField>

                    <LineField label="Planned selling" htmlFor={`s-${l.variantId}`}>
                      <Input
                        id={`s-${l.variantId}`}
                        value={String(l.lineSelling)}
                        onChange={(e) =>
                          patchLine(l.variantId, {
                            lineSelling: Math.max(0, Number(e.target.value) || 0),
                          })
                        }
                        inputMode="decimal"
                        className="text-right tabular-nums"
                      />
                    </LineField>

                    <div className="flex flex-col justify-end">
                      <span className="text-xs text-muted-foreground">Line total</span>
                      <span className="text-sm font-semibold tabular-nums text-foreground">
                        {formatCurrencyExact(l.quantity * l.lineCost)}
                      </span>
                    </div>
                  </div>
                </Card>
              ))}
            </section>
          )}

          {/* ── Totals ────────────────────────────────────────────────────── */}
          <section className="space-y-3 rounded-lg border border-border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="po-discount" className="text-sm font-medium text-foreground">
                  Discount
                </label>
                <Input
                  id="po-discount"
                  value={discount}
                  onChange={(e) => setDiscount(e.target.value)}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="po-tax" className="text-sm font-medium text-foreground">
                  Tax
                </label>
                <Input
                  id="po-tax"
                  value={tax}
                  onChange={(e) => setTax(e.target.value)}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                />
              </div>
            </div>

            <dl className="space-y-1 border-t border-border pt-3 text-sm">
              <Row label="Subtotal" value={formatCurrencyExact(subtotal)} />
              <Row label="Discount" value={`− ${formatCurrencyExact(discountNum)}`} muted />
              <Row label="Tax" value={`+ ${formatCurrencyExact(taxNum)}`} muted />
              <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
                <dt>Total</dt>
                <dd className="tabular-nums">{formatCurrencyExact(total)}</dd>
              </div>
            </dl>
          </section>

          <div className="space-y-1.5">
            <label htmlFor="po-notes" className="text-sm font-medium text-foreground">
              Notes
            </label>
            <textarea
              id="po-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-2 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            loading={busy}
            disabled={lines.length === 0 || !supplierId}
            className="flex-1"
          >
            Create purchase · {formatCurrencyExact(total)}
          </Button>
        </div>
      </form>
    </Drawer>
  );
}

function LineField({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? "text-muted-foreground" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
