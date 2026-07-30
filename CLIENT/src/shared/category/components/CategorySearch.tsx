import { Search, X } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * CategorySearch — the module's search input.
 *
 * Controlled by the caller's LOCAL search state (not the debounced URL value),
 * so every keystroke renders immediately while the network request is debounced
 * upstream in useCategoryFilters. Searches name, description and keywords.
 */
export function CategorySearch({
  value,
  onChange,
  placeholder = "Search categories by name, description or keywords…",
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative flex-1 min-w-[220px]", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label="Search categories"
        className={cn(
          "h-10 w-full rounded-md border border-border bg-background pl-9 pr-9 text-sm",
          "placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary",
          "transition-colors",
          // Chrome renders its own clear affordance for type=search; we supply
          // our own so the control looks identical across browsers.
          "[&::-webkit-search-cancel-button]:appearance-none"
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
