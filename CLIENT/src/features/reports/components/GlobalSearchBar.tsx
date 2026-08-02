/**
 * Global search — invoices, products, customers, suppliers, employees.
 *
 * ONE INPUT, FIVE ENTITIES, GROUPED RESULTS.
 *
 * Grouping by entity rather than interleaving by relevance is the right call
 * for a POS: a user searching "9876" almost always knows whether they want a
 * customer or an invoice, and a mixed list makes them scan for the type they
 * meant. Groups let them jump straight to the right section.
 *
 * Keyboard: ↑/↓ move through the flattened result list, Enter opens, Escape
 * closes. The flattening happens once via useMemo so arrow navigation crosses
 * group boundaries naturally.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import {
  Building2,
  Loader2,
  Package,
  Receipt,
  Search,
  UserCog,
  Users,
  X,
} from "lucide-react";

import { Input } from "@/components/ui";
import { cn } from "@/utils/cn";
import { formatCurrency, formatDate } from "@/components/shared/bi";

import { useGlobalSearch } from "../hooks/useReports";
import type { SearchHit } from "../api/reportsApi";

const GROUPS = [
  { key: "invoices" as const, label: "Invoices", icon: Receipt },
  { key: "products" as const, label: "Products", icon: Package },
  { key: "customers" as const, label: "Customers", icon: Users },
  { key: "suppliers" as const, label: "Suppliers", icon: Building2 },
  { key: "employees" as const, label: "Employees", icon: UserCog },
];

export function GlobalSearchBar({ className }: { className?: string }) {
  const navigate = useNavigate();
  const [term, setTerm] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounced: every keystroke here is five LIKE queries server-side.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(term), 280);
    return () => clearTimeout(timer);
  }, [term]);

  const { data, isFetching } = useGlobalSearch(debounced, open);

  // Flattened for keyboard navigation — arrow keys must cross group boundaries.
  const flat = useMemo(() => {
    if (!data) return [] as Array<SearchHit & { group: string }>;
    return GROUPS.flatMap((g) =>
      (data[g.key] ?? []).map((hit) => ({ ...hit, group: g.key }))
    );
  }, [data]);

  useEffect(() => setCursor(0), [flat.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const go = (hit: SearchHit) => {
    setOpen(false);
    setTerm("");
    navigate(hit.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (flat.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % flat.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + flat.length) % flat.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = flat[cursor];
      if (hit) go(hit);
    }
  };

  const hasResults = flat.length > 0;
  const showEmpty = open && debounced.trim().length >= 2 && !isFetching && !hasResults;

  return (
    <div ref={containerRef} className={cn("relative w-full sm:w-80", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search invoices, products, customers…"
          className="pl-9 pr-8"
          aria-label="Global search"
          aria-expanded={open}
          role="combobox"
          aria-controls="global-search-results"
        />
        {isFetching ? (
          <Loader2 className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : term ? (
          <button
            type="button"
            onClick={() => {
              setTerm("");
              setOpen(false);
            }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && (hasResults || showEmpty) && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute right-0 z-40 mt-1.5 max-h-96 w-full min-w-[22rem] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 shadow-lg"
        >
          {showEmpty && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Nothing matched “{debounced}”.
            </p>
          )}

          {GROUPS.map((group) => {
            const hits = data?.[group.key] ?? [];
            if (hits.length === 0) return null;
            const Icon = group.icon;

            return (
              <div key={group.key} className="mb-1 last:mb-0">
                <p className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Icon className="h-3 w-3" aria-hidden />
                  {group.label}
                </p>

                {hits.map((hit) => {
                  const index = flat.findIndex(
                    (f) => f.group === group.key && f.id === hit.id
                  );
                  const active = index === cursor;

                  return (
                    <button
                      key={`${group.key}-${hit.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(hit)}
                      className={cn(
                        "flex w-full items-start justify-between gap-3 rounded-md px-2.5 py-1.5 text-left transition-colors",
                        active ? "bg-muted" : "hover:bg-muted/60"
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{hit.label}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {hit.sublabel}
                        </span>
                      </span>

                      <span className="shrink-0 text-right text-xs">
                        {hit.amount !== undefined && (
                          <span className="block font-medium tabular-nums">
                            {formatCurrency(hit.amount)}
                          </span>
                        )}
                        {hit.date && (
                          <span className="block text-muted-foreground">
                            {formatDate(hit.date)}
                          </span>
                        )}
                        {hit.stock !== undefined && (
                          <span className="block text-muted-foreground">{hit.stock} in stock</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
