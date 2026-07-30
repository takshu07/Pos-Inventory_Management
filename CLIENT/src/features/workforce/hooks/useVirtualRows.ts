/**
 * Minimal fixed-height row virtualizer.
 *
 * WHY NOT A LIBRARY: the stack is fixed and no virtualization package is
 * installed. Adding one for a single table would be a dependency (and a bundle
 * cost) out of proportion to the need — this table's rows are a uniform height,
 * which is the one case where windowing is ~40 lines rather than a library.
 *
 * WHY VIRTUALIZE AT ALL: the roster is server-paginated, so the common case is
 * 20–50 rows and this hook stays inert (see `enabled`). It exists for the
 * multi-store / large-workforce case where a page size of several hundred is
 * legitimate and rendering every row would drop frames while scrolling.
 *
 * Contract: rows must be a FIXED pixel height, and the scroll container must be
 * the element the returned ref is attached to.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  /** Total number of rows in the dataset. */
  count: number;
  /** Fixed row height in pixels. Must match the rendered row exactly. */
  rowHeight: number;
  /**
   * Rows rendered beyond each edge of the viewport. Without overscan, a fast
   * scroll shows blank space before the next batch mounts.
   */
  overscan?: number;
  /**
   * Below this many rows, windowing costs more than it saves — the hook returns
   * the full range and the table renders normally.
   */
  threshold?: number;
}

export function useVirtualRows({
  count,
  rowHeight,
  overscan = 8,
  threshold = 100,
}: Options) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const enabled = count > threshold;

  // Track the container's height. ResizeObserver rather than a window resize
  // listener, because the container can change size without the window doing so
  // (a sidebar collapsing, a filter bar wrapping to two lines).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !enabled) return;

    setViewportHeight(el.clientHeight);

    const observer = new ResizeObserver(() => setViewportHeight(el.clientHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled]);

  const onScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      if (!enabled) return;
      setScrollTop(e.currentTarget.scrollTop);
    },
    [enabled]
  );

  if (!enabled) {
    return {
      scrollRef,
      onScroll,
      enabled: false as const,
      startIndex: 0,
      endIndex: count,
      paddingTop: 0,
      paddingBottom: 0,
    };
  }

  const visibleCount = Math.ceil(viewportHeight / rowHeight) || 20;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex = Math.min(count, startIndex + visibleCount + overscan * 2);

  // Spacer heights preserve the scrollbar's true length, so the scroll position
  // stays honest even though most rows are not in the DOM.
  return {
    scrollRef,
    onScroll,
    enabled: true as const,
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: Math.max(0, (count - endIndex) * rowHeight),
  };
}
