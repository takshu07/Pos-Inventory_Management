import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useId,
  memo,
} from "react";
import { Search, X, User, Phone, Users as UsersIcon } from "lucide-react";
import { cn } from "@/utils/cn";
import { useDebounce } from "@/hooks/useDebounce";
import { useCustomerSearch } from "../hooks/useCustomers";
import type { CustomerSearchResult } from "../types";
import { HighlightMatch } from "./HighlightMatch";

/**
 * CustomerSearchCombobox — live, ranked customer typeahead.
 *
 * Feels like Spotlight / VS Code Quick Open:
 *  - Filters on every keystroke (onChange), never on submit/blur/button.
 *  - 250ms debounce on the *network* term only; the input itself is instant,
 *    so cursor position and focus never jump.
 *  - Server-side ranked substring search (name / phone / code), prefix first.
 *  - Empty query → "Recent customers" instead of "no results".
 *  - Keyboard nav: ↑ ↓ move, Enter selects, Esc closes.
 *  - Click-outside closes; typing / focus reopens.
 *  - Spinner inside the box while fetching; results update in place (no flash).
 *
 * Presentational only — the parent decides what "select" means (view a
 * customer, attach to a POS session, …) via `onSelect`.
 */

interface CustomerSearchComboboxProps {
  onSelect: (customer: CustomerSearchResult) => void;
  placeholder?: string;
  /** Max results in the dropdown. */
  limit?: number;
  autoFocus?: boolean;
  className?: string;
  /** Empty-state hint shown before any typing (defaults to a sensible copy). */
  emptyHint?: string;
}

function CustomerSearchComboboxImpl({
  onSelect,
  placeholder = "Search mobile number, name, or code…",
  limit = 8,
  autoFocus = false,
  className,
  emptyHint = "Start typing a mobile number, name, or customer code.",
}: CustomerSearchComboboxProps) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const debounced = useDebounce(value.trim(), 250);

  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  // Only hit the network once the dropdown is open (focused/typing). The empty
  // term is intentionally allowed — it returns recent customers.
  const { data, isFetching, isError } = useCustomerSearch(debounced, limit, open);
  const results = useMemo(() => data ?? [], [data]);
  const showingRecent = debounced.length === 0;

  // Keep the highlighted row in range whenever the result set changes.
  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results]);

  // Scroll the active row into view during keyboard navigation.
  useEffect(() => {
    if (!open || results.length === 0) return;
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, results.length]);

  // Close on outside click — but not when clicking the scrollbar or inside root.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const choose = useCallback(
    (customer: CustomerSearchResult | undefined) => {
      if (!customer) return;
      onSelect(customer);
      setOpen(false);
    },
    [onSelect]
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        if (!open) setOpen(true);
        setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        choose(results[activeIndex]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (open) setOpen(false);
        else if (value) setValue("");
      }
    },
    [open, results, activeIndex, choose, value]
  );

  const clear = useCallback(() => {
    setValue("");
    setActiveIndex(0);
    inputRef.current?.focus();
  }, []);

  const showDropdown = open;

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      <div className="relative flex items-center">
        <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            showDropdown && results[activeIndex]
              ? `${listboxId}-opt-${activeIndex}`
              : undefined
          }
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            setValue(e.target.value);
            setActiveIndex(0);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className={cn(
            "h-11 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm shadow-sm",
            "placeholder:text-muted-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
            "transition-colors duration-150"
          )}
        />
        {isFetching ? (
          <Spinner className="absolute right-3" />
        ) : (
          value && (
            <button
              type="button"
              onClick={clear}
              className="absolute right-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )
        )}
      </div>

      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          ref={listRef}
          className={cn(
            "absolute z-50 mt-2 w-full max-h-80 overflow-y-auto",
            "rounded-lg border border-border bg-popover shadow-lg",
            "animate-in fade-in-0 zoom-in-95"
          )}
        >
          {showingRecent && (
            <div className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              Recent customers
            </div>
          )}

          {isError ? (
            <EmptyRow icon={UsersIcon} title="Couldn’t search right now." subtitle="Check your connection and try again." />
          ) : results.length === 0 ? (
            isFetching ? (
              <div className="px-4 py-6 text-sm text-muted-foreground text-center">Searching…</div>
            ) : showingRecent ? (
              <EmptyRow icon={UsersIcon} title="No customers yet." subtitle={emptyHint} />
            ) : (
              <EmptyRow
                icon={UsersIcon}
                title="No customer found."
                subtitle="New customers are added at POS checkout when their mobile number is entered."
              />
            )
          ) : (
            <div className="py-1">
              {results.map((c, i) => (
                <ResultRow
                  key={c.id}
                  id={`${listboxId}-opt-${i}`}
                  index={i}
                  customer={c}
                  query={debounced}
                  active={i === activeIndex}
                  onHover={() => setActiveIndex(i)}
                  onClick={() => choose(c)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** A single dropdown row. Memoized so unrelated rows don't re-render on nav. */
const ResultRow = memo(function ResultRow({
  id,
  index,
  customer,
  query,
  active,
  onHover,
  onClick,
}: {
  id: string;
  index: number;
  customer: CustomerSearchResult;
  query: string;
  active: boolean;
  onHover: () => void;
  onClick: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      data-index={index}
      onMouseEnter={onHover}
      // onMouseDown (not onClick) so selection fires before the input blurs.
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className={cn(
        "flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer",
        active ? "bg-accent" : "hover:bg-accent/60"
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <User className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-medium truncate">
            <HighlightMatch text={customer.name} query={query} />
          </div>
          <div className="text-xs text-muted-foreground flex items-center gap-1 truncate">
            <Phone className="h-3 w-3 shrink-0" />
            <HighlightMatch text={customer.phone} query={query} />
            <span className="mx-1 opacity-40">·</span>
            <HighlightMatch text={customer.customerCode} query={query} />
          </div>
        </div>
      </div>
    </div>
  );
});

function EmptyRow({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: React.ElementType;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-1.5 px-6 py-8">
      <Icon className="h-7 w-7 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn("h-4 w-4 animate-spin text-muted-foreground", className)}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export const CustomerSearchCombobox = memo(CustomerSearchComboboxImpl);
