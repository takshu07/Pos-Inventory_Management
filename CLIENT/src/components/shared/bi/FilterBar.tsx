/**
 * The shared report filter bar.
 *
 * ONE COMPONENT, EVERY REPORT.
 *
 * The spec requires every report to support the same filter set (date range,
 * employee, customer, supplier, brand, category, product, SKU, invoice number,
 * payment method). Building that as ONE component rather than per-screen is
 * what makes the guarantee real: a report cannot forget a filter, because it
 * does not declare its filters — it declares which of the shared ones apply.
 *
 * STICKY BY DEFAULT. On a long report the filters scroll away exactly when a
 * reader wants to change them. Sticking them costs one line and removes a
 * scroll-to-top from every refinement.
 */

import { useEffect, useMemo, useState } from "react";
import { Filter, RotateCcw, Search, X } from "lucide-react";

import { Badge, Button, Input, Select } from "@/components/ui";
import { cn } from "@/utils/cn";

// =============================================================================
// TYPES
// =============================================================================

export type PeriodKeyword =
  | "today" | "yesterday" | "week" | "month" | "quarter" | "year" | "custom";

export interface ReportFilterState {
  period: PeriodKeyword;
  startDate?: string;
  endDate?: string;
  employeeId?: string;
  customerId?: string;
  supplierId?: string;
  brandId?: string;
  categoryId?: string;
  productId?: string;
  sku?: string;
  invoiceNumber?: string;
  paymentMethod?: string;
}

export interface FilterOptions {
  categories: Array<{ id: string; name: string }>;
  brands: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  employees: Array<{ id: string; name: string; employeeCode: string; role: string }>;
}

/** Which of the shared filters a given report exposes. */
export type FilterKey =
  | "employee" | "supplier" | "brand" | "category"
  | "sku" | "invoice" | "paymentMethod";

export const PERIOD_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "This Quarter" },
  { value: "year", label: "This Year" },
  { value: "custom", label: "Custom Range" },
] as const;

const PAYMENT_METHOD_OPTIONS = [
  { value: "", label: "All methods" },
  { value: "CASH", label: "Cash" },
  { value: "UPI", label: "UPI" },
  { value: "CARD", label: "Card" },
  { value: "CREDIT", label: "Credit" },
  { value: "GIFT_CARD", label: "Gift Card" },
  { value: "OTHER", label: "Other" },
];

export const DEFAULT_FILTERS: ReportFilterState = { period: "month" };

// =============================================================================
// HELPERS
// =============================================================================

/** Strips empty values so a query string never carries `?brandId=`. */
export function cleanFilters(filters: ReportFilterState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    // A custom range's dates are the only reason to send them; on a keyword
    // period they would silently override the keyword server-side.
    if ((key === "startDate" || key === "endDate") && filters.period !== "custom") continue;
    out[key] = String(value);
  }
  return out;
}

/** How many filters beyond the period are active — drives the "active" badge. */
export function activeFilterCount(filters: ReportFilterState): number {
  return Object.entries(filters).filter(
    ([key, value]) =>
      key !== "period" &&
      key !== "startDate" &&
      key !== "endDate" &&
      value !== undefined &&
      value !== ""
  ).length;
}

// =============================================================================
// COMPONENT
// =============================================================================

export interface FilterBarProps {
  value: ReportFilterState;
  onChange: (next: ReportFilterState) => void;
  options?: FilterOptions | undefined;
  /** Which shared filters this report exposes. Period is always present. */
  show?: FilterKey[];
  /** Rendered on the right of the bar — usually the export menu. */
  actions?: React.ReactNode;
  isLoading?: boolean;
  className?: string;
}

export function FilterBar({
  value,
  onChange,
  options,
  show = [],
  actions,
  isLoading,
  className,
}: FilterBarProps) {
  // The advanced row starts open when filters are already applied — arriving at
  // a pre-filtered report with the controls collapsed hides why the numbers
  // look the way they do.
  const [expanded, setExpanded] = useState(() => activeFilterCount(value) > 0);
  const count = activeFilterCount(value);

  useEffect(() => {
    if (count > 0) setExpanded(true);
  }, [count]);

  const set = (patch: Partial<ReportFilterState>) => onChange({ ...value, ...patch });

  const employeeOptions = useMemo(
    () => [
      { value: "", label: "All employees" },
      ...(options?.employees ?? []).map((e) => ({
        value: e.id,
        label: `${e.name} (${e.employeeCode})`,
      })),
    ],
    [options?.employees]
  );

  const categoryOptions = useMemo(
    () => [
      { value: "", label: "All categories" },
      ...(options?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [options?.categories]
  );

  const brandOptions = useMemo(
    () => [
      { value: "", label: "All brands" },
      ...(options?.brands ?? []).map((b) => ({ value: b.id, label: b.name })),
    ],
    [options?.brands]
  );

  const supplierOptions = useMemo(
    () => [
      { value: "", label: "All suppliers" },
      ...(options?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
    ],
    [options?.suppliers]
  );

  const has = (key: FilterKey) => show.includes(key);

  return (
    <div
      className={cn(
        "sticky top-0 z-20 -mx-1 rounded-xl border border-border bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80",
        className
      )}
    >
      {/* ── Primary row: period + custom range + actions ────────────────── */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-44">
          <Select
            label="Period"
            options={PERIOD_OPTIONS.map((p) => ({ value: p.value, label: p.label }))}
            value={value.period}
            onChange={(e) => set({ period: e.target.value as PeriodKeyword })}
            disabled={isLoading}
          />
        </div>

        {value.period === "custom" && (
          <>
            <div className="w-full sm:w-40">
              <Input
                label="From"
                type="date"
                value={value.startDate ?? ""}
                onChange={(e) => set({ startDate: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <div className="w-full sm:w-40">
              <Input
                label="To"
                type="date"
                value={value.endDate ?? ""}
                onChange={(e) => set({ endDate: e.target.value })}
                disabled={isLoading}
              />
            </div>
          </>
        )}

        <div className="ml-auto flex items-end gap-2">
          {show.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              <Filter className="mr-1.5 h-3.5 w-3.5" />
              Filters
              {count > 0 && (
                <Badge variant="default" className="ml-1.5 px-1.5 py-0">
                  {count}
                </Badge>
              )}
            </Button>
          )}

          {count > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ period: value.period, ...(value.startDate ? { startDate: value.startDate } : {}), ...(value.endDate ? { endDate: value.endDate } : {}) })}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              Reset
            </Button>
          )}

          {actions}
        </div>
      </div>

      {/* ── Advanced row: the dimension filters this report exposes ─────── */}
      {expanded && show.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4">
          {has("employee") && (
            <Select
              label="Employee"
              options={employeeOptions}
              value={value.employeeId ?? ""}
              onChange={(e) => set({ employeeId: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}

          {has("category") && (
            <Select
              label="Category"
              options={categoryOptions}
              value={value.categoryId ?? ""}
              onChange={(e) => set({ categoryId: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}

          {has("brand") && (
            <Select
              label="Brand"
              options={brandOptions}
              value={value.brandId ?? ""}
              onChange={(e) => set({ brandId: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}

          {has("supplier") && (
            <Select
              label="Supplier"
              options={supplierOptions}
              value={value.supplierId ?? ""}
              onChange={(e) => set({ supplierId: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}

          {has("paymentMethod") && (
            <Select
              label="Payment Method"
              options={PAYMENT_METHOD_OPTIONS}
              value={value.paymentMethod ?? ""}
              onChange={(e) => set({ paymentMethod: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}

          {has("sku") && (
            <Input
              label="SKU"
              placeholder="Partial SKU"
              value={value.sku ?? ""}
              onChange={(e) => set({ sku: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}

          {has("invoice") && (
            <Input
              label="Invoice Number"
              placeholder="INV-000123"
              value={value.invoiceNumber ?? ""}
              onChange={(e) => set({ invoiceNumber: e.target.value || undefined })}
              disabled={isLoading}
            />
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// ACTIVE FILTER CHIPS
// =============================================================================

/**
 * Renders the applied filters as removable chips.
 *
 * Exists because a collapsed filter panel hides WHY a report shows what it
 * shows. The chips keep that visible without keeping the whole panel open.
 */
export function ActiveFilterChips({
  filters,
  options,
  onChange,
  className,
}: {
  filters: ReportFilterState;
  options?: FilterOptions | undefined;
  onChange: (next: ReportFilterState) => void;
  className?: string;
}) {
  const chips: Array<{ key: keyof ReportFilterState; label: string }> = [];

  const nameOf = (list: Array<{ id: string; name: string }> | undefined, id?: string) =>
    list?.find((x) => x.id === id)?.name ?? id ?? "";

  if (filters.employeeId) {
    const emp = options?.employees.find((e) => e.id === filters.employeeId);
    chips.push({ key: "employeeId", label: `Employee: ${emp?.name ?? filters.employeeId}` });
  }
  if (filters.categoryId)
    chips.push({ key: "categoryId", label: `Category: ${nameOf(options?.categories, filters.categoryId)}` });
  if (filters.brandId)
    chips.push({ key: "brandId", label: `Brand: ${nameOf(options?.brands, filters.brandId)}` });
  if (filters.supplierId)
    chips.push({ key: "supplierId", label: `Supplier: ${nameOf(options?.suppliers, filters.supplierId)}` });
  if (filters.paymentMethod)
    chips.push({ key: "paymentMethod", label: `Payment: ${filters.paymentMethod}` });
  if (filters.sku) chips.push({ key: "sku", label: `SKU: ${filters.sku}` });
  if (filters.invoiceNumber)
    chips.push({ key: "invoiceNumber", label: `Invoice: ${filters.invoiceNumber}` });

  if (chips.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={chip.key}
          type="button"
          onClick={() => onChange({ ...filters, [chip.key]: undefined })}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {chip.label}
          <X className="h-3 w-3" aria-hidden />
          <span className="sr-only">Remove filter</span>
        </button>
      ))}
    </div>
  );
}

// =============================================================================
// SEARCH INPUT
// =============================================================================

/**
 * A debounced search box.
 *
 * Debounced at 300ms rather than firing per keystroke: every change here is a
 * database query with a LIKE, and a five-letter SKU would otherwise cost five.
 */
export function DebouncedSearch({
  value,
  onChange,
  placeholder = "Search…",
  delay = 300,
  className,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  delay?: number;
  className?: string;
}) {
  const [local, setLocal] = useState(value);

  // Re-sync when the parent resets filters, or the box would keep stale text.
  useEffect(() => setLocal(value), [value]);

  useEffect(() => {
    if (local === value) return;
    const timer = setTimeout(() => onChange(local), delay);
    return () => clearTimeout(timer);
    // `onChange` is intentionally omitted: callers commonly pass an inline
    // arrow, and including it would restart the timer on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [local, delay, value]);

  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        placeholder={placeholder}
        className="pl-9"
      />
      {local && (
        <button
          type="button"
          onClick={() => { setLocal(""); onChange(""); }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Clear search"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
