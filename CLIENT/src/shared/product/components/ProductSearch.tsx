import { useEffect, useState } from "react";
import { SearchBox } from "@/components/ui/SearchBox";
import { useDebounce } from "@/hooks/useDebounce";

/**
 * ProductSearch — a debounced search input. The visible input updates instantly
 * (local state) while the debounced value is what the caller queries with, so
 * keystrokes never fire a request each. Server-side search + partial + case-
 * insensitive matching is handled by the API; this is purely the input.
 *
 * Both modules use this exact component; only the query hook they feed the
 * debounced term into differs (owner vs. manager endpoint).
 */
export function ProductSearch({
  value,
  onDebouncedChange,
  placeholder = "Search by name, SKU, barcode, category, brand…",
  delay = 300,
  loading = false,
  className,
}: {
  value: string;
  onDebouncedChange: (v: string) => void;
  placeholder?: string;
  delay?: number;
  loading?: boolean;
  className?: string;
}) {
  const [local, setLocal] = useState(value);
  const debounced = useDebounce(local, delay);

  // Keep local input in sync if the parent resets the term (e.g. clear filters).
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => {
    if (debounced !== value) onDebouncedChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <SearchBox
      value={local}
      onChange={setLocal}
      placeholder={placeholder}
      loading={loading}
      className={className ?? "w-full max-w-md"}
    />
  );
}
