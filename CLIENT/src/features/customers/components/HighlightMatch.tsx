import { useMemo } from "react";

/** Escapes regex metacharacters so an arbitrary query is a literal match. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Renders `text` with every case-insensitive occurrence of `query` wrapped in a
 * highlighted <mark>. Used in the search dropdown so the matched characters
 * ("[Ta]nishk") stand out. Purely presentational; memoized on text+query.
 */
export function HighlightMatch({
  text,
  query,
  className,
}: {
  text: string;
  query: string;
  className?: string;
}) {
  const parts = useMemo(() => {
    const q = query.trim();
    if (!q) return [{ value: text, match: false }];

    const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
    return text
      .split(re)
      .filter((chunk) => chunk !== "")
      .map((chunk) => ({ value: chunk, match: chunk.toLowerCase() === q.toLowerCase() }));
  }, [text, query]);

  return (
    <span className={className}>
      {parts.map((part, i) =>
        part.match ? (
          <mark
            key={i}
            className="bg-primary/20 text-primary rounded-sm px-0.5 font-semibold"
          >
            {part.value}
          </mark>
        ) : (
          <span key={i}>{part.value}</span>
        )
      )}
    </span>
  );
}
