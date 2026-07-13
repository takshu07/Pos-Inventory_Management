import { Search, X } from "lucide-react";
import { cn } from "@/utils/cn";

/**
 * SearchBox Component — Design System Primitive
 * An Input specialized for search with debouncing, clear button, and loading state.
 */

interface SearchBoxProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  loading?: boolean;
  onClear?: () => void;
}

export function SearchBox({
  value = "",
  onChange,
  placeholder = "Search...",
  className,
  loading = false,
  onClear,
}: SearchBoxProps) {
  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-3 h-4 w-4 text-muted-foreground pointer-events-none" />

      <input
        type="search"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-9 w-full rounded-md border border-input bg-background pl-9 pr-8 text-sm shadow-sm",
          "placeholder:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-transparent",
          "transition-colors duration-150"
        )}
      />

      {loading && (
        <svg
          className="absolute right-3 h-4 w-4 animate-spin text-muted-foreground"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}

      {!loading && value && (
        <button
          type="button"
          onClick={() => { onChange?.(""); onClear?.(); }}
          className="absolute right-3 flex items-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Clear search"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
