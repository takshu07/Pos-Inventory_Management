/**
 * @file app/router/prefetch.ts
 *
 * Route chunk prefetching — warms a screen's JavaScript before the user clicks.
 *
 * WHY: every route in ./index.tsx is code-split behind `lazy()`. The chunk only
 * starts downloading on click, so the first visit to any screen costs a full
 * round-trip of dead time. But a user's pointer lands on a nav item ~200-400ms
 * before the click fires — ample time to fetch a 20-40KB chunk. Prefetching on
 * hover/focus turns most first-visits into instant navigations.
 *
 * WHY IT MAPS TO FEATURE BARRELS, NOT ROUTES: the router imports whole feature
 * barrels (`@/features/inventory` exports all 13 inventory pages), so those
 * pages already share ONE chunk. Prefetching the barrel warms every screen in
 * that feature. That keeps this map at ~12 entries covering ~40 routes instead
 * of a brittle 1:1 mirror of the route table.
 *
 * ⚠ KEEP IN SYNC: the import specifiers below must match those in ./index.tsx.
 * A drift here is harmless at runtime — a wrong/missing entry only means the
 * chunk isn't pre-warmed, never a broken route — but it silently loses the
 * benefit. Routes rendering an inline PlaceholderPage are deliberately absent:
 * they have no chunk to fetch.
 */

type ChunkThunk = () => Promise<unknown>;

/**
 * Longest-prefix-first. `/admin/categories` must be tested before `/admin`
 * would ever match, and `/admin/inventory/...` before `/admin/inventory`.
 */
const PREFIX_CHUNKS: ReadonlyArray<readonly [string, ChunkThunk]> = [
  ["/admin/inventory", () => import("@/features/inventory")],
  ["/admin/categories", () => import("@/features/owner/categories")],
  ["/admin/discounts", () => import("@/features/owner/discounts")],
  ["/admin/products", () => import("@/features/owner/products")],
  ["/admin/labels", () => import("@/features/labels/pages/LabelSettingsPage")],
  // The whole workforce module is one barrel: activity, managers, staff,
  // attendance, performance and login history all ride the same chunk.
  ["/admin/employees", () => import("@/features/workforce")],
  ["/admin/managers", () => import("@/features/workforce")],
  ["/admin/staff", () => import("@/features/workforce")],
  ["/admin/attendance", () => import("@/features/workforce")],
  ["/admin/performance", () => import("@/features/workforce")],
  ["/admin/login-history", () => import("@/features/workforce")],
  ["/cashier/pos", () => import("@/features/pos")],
  ["/customers", () => import("@/features/customers")],
  ["/categories", () => import("@/features/manager/categories")],
  ["/products", () => import("@/features/manager/products")],
  ["/labels", () => import("@/features/labels/pages/LabelPrintingPage")],
  ["/sales", () => import("@/features/sales")],
  ["/login", () => import("@/features/auth/views/LoginView")],
  ["/pos", () => import("@/features/pos")],
];

/** Exact matches — paths that must not be treated as prefixes of everything. */
const EXACT_CHUNKS: Readonly<Record<string, ChunkThunk>> = {
  "/": () => import("@/features/dashboard"),
  "/cashier": () => import("@/features/pos"),
};

/**
 * Chunks already requested this session. `import()` is itself memoized by the
 * module registry, so this is not about correctness — it avoids re-entering
 * promise machinery on every single mousemove-driven hover event.
 */
const warmed = new Set<string>();

/**
 * Skip prefetching when the user is paying for bytes or is on a slow link.
 * Prefetching is a bet that spare bandwidth is free; on 2G or with Data Saver
 * on, that bet is wrong and speculative chunks compete with the fetch the user
 * actually asked for. `connection` is not in the DOM lib types and is absent in
 * Safari/Firefox — absent means "no signal", which we treat as fine to prefetch.
 */
function shouldPrefetch(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; effectiveType?: string };
    }
  ).connection;

  if (!connection) return true;
  if (connection.saveData) return false;
  return connection.effectiveType !== "slow-2g" && connection.effectiveType !== "2g";
}

/**
 * Begin downloading the JS chunk that renders `path`. Safe to call on every
 * hover: it de-dupes, it never throws (a failed speculative fetch must not
 * surface to the user — the real navigation will retry and report properly),
 * and it is a no-op for paths with no dedicated chunk.
 */
export function prefetchRoute(path: string): void {
  if (!shouldPrefetch()) return;

  const exact = EXACT_CHUNKS[path];
  if (exact) {
    if (warmed.has(path)) return;
    warmed.add(path);
    void exact().catch(() => warmed.delete(path));
    return;
  }

  const match = PREFIX_CHUNKS.find(([prefix]) => path.startsWith(prefix));
  if (!match) return;

  const [key, load] = match;
  if (warmed.has(key)) return;
  warmed.add(key);
  // On failure, forget it so a later hover (or the real click) can try again.
  void load().catch(() => warmed.delete(key));
}

/**
 * Props to spread onto a nav <Link>/<NavLink>. Covers pointer users (hover),
 * keyboard users (focus) and touch users (touchstart fires ~100ms before the
 * click on tap). Deliberately NOT onMouseDown-only: by then the click is
 * already in flight and there is nothing left to win.
 */
export function prefetchHandlers(path: string) {
  const warm = () => prefetchRoute(path);
  return {
    onMouseEnter: warm,
    onFocus: warm,
    onTouchStart: warm,
  };
}
