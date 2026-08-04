// =============================================================================
// HTTP METRICS REGISTRY
//
// What this is for
// ----------------
// The access log already records a `durationMs` per request, but answering
// "is the POS slow right now?" from raw log lines requires a log aggregator and
// a query. This keeps a small in-process rollup so the question can be answered
// directly from `GET /health/metrics` — which matters most in exactly the
// situation where the aggregator is the thing that's broken.
//
// Percentiles, not averages
// -------------------------
// A mean response time hides the failure mode that actually hurts a POS: most
// requests fast, a few catastrophically slow. A cashier who waits 4 seconds at
// checkout does not care that the average was 120ms. p95/p99 surface that tail.
//
// Bounded memory — the reason for the reservoir
// ---------------------------------------------
// Exact percentiles need every sample retained, which is an unbounded array in
// a process that runs for weeks. Instead each route keeps a fixed-size reservoir
// (`MAX_SAMPLES`) of recent durations. Memory is therefore capped at
// routes x MAX_SAMPLES x 8 bytes regardless of uptime or traffic.
//
// Scope: this is per-PROCESS. Behind multiple instances each reports its own
// slice, which is the correct behavior for a liveness/diagnostics endpoint —
// cross-instance aggregation is the log platform's job, not ours.
// =============================================================================

/** Recent durations retained per route. 500 x ~40 routes ≈ 160KB worst case. */
const MAX_SAMPLES = 500;

interface RouteMetrics {
  count: number;
  errorCount: number;
  totalMs: number;
  maxMs: number;
  /** Ring buffer of recent durations; ordering is irrelevant to percentiles. */
  samples: number[];
  /** Next write position once the reservoir is full. */
  cursor: number;
}

const routes = new Map<string, RouteMetrics>();

let startedAt = Date.now();
let totalRequests = 0;
let totalErrors = 0;

/**
 * Collapses a concrete URL into a route TEMPLATE.
 *
 * Without this, `/sales/abc-123` and `/sales/def-456` are two different keys and
 * the map grows without bound — a memory leak driven by traffic, and the exact
 * bug that makes naive per-path metrics unusable. Ids are replaced with `:id`
 * so all reads of one endpoint aggregate into one row.
 */
export function normalizeRoute(path: string): string {
  return (
    path
      // Strip the query string — it is unbounded cardinality by definition.
      .split("?")[0]!
      .split("/")
      .map((segment) => {
        if (segment.length === 0) return segment;
        // UUIDs / cuids / numeric ids → :id
        if (/^[0-9]+$/.test(segment)) return ":id";
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(segment)) return ":id";
        if (/^c[a-z0-9]{20,}$/i.test(segment)) return ":id";
        // Long opaque tokens (barcodes, SKUs, invoice numbers).
        if (segment.length > 24) return ":id";
        return segment;
      })
      .join("/")
  );
}

/** Records one completed request. Called from the access-log middleware. */
export function recordRequest(
  method: string,
  path: string,
  statusCode: number,
  durationMs: number
): void {
  const key = `${method} ${normalizeRoute(path)}`;

  let metrics = routes.get(key);
  if (!metrics) {
    metrics = {
      count: 0,
      errorCount: 0,
      totalMs: 0,
      maxMs: 0,
      samples: [],
      cursor: 0,
    };
    routes.set(key, metrics);
  }

  metrics.count += 1;
  metrics.totalMs += durationMs;
  if (durationMs > metrics.maxMs) metrics.maxMs = durationMs;

  // Only 5xx counts as a server error. A 401 or a 409 is the API working
  // correctly — folding those in would make a busy login screen look like an
  // outage and make the error rate useless as an alerting signal.
  if (statusCode >= 500) {
    metrics.errorCount += 1;
    totalErrors += 1;
  }

  if (metrics.samples.length < MAX_SAMPLES) {
    metrics.samples.push(durationMs);
  } else {
    metrics.samples[metrics.cursor] = durationMs;
    metrics.cursor = (metrics.cursor + 1) % MAX_SAMPLES;
  }

  totalRequests += 1;
}

/**
 * Nearest-rank percentile over a copy of the reservoir.
 * Returns 0 for an empty sample set rather than NaN, so the JSON stays numeric.
 */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;

  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(Math.max(rank, 0), sorted.length - 1);
  return Math.round(sorted[index]!);
}

export interface RouteMetricsSnapshot {
  route: string;
  count: number;
  errorCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface MetricsSnapshot {
  uptimeSeconds: number;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  sampledSince: string;
  routes: RouteMetricsSnapshot[];
}

/**
 * Point-in-time view of everything recorded so far.
 * Routes are returned slowest-p95 first — the order you actually want when
 * something is wrong and you are reading this at 2am.
 */
export function getMetricsSnapshot(): MetricsSnapshot {
  const snapshots: RouteMetricsSnapshot[] = [];

  for (const [route, metrics] of routes) {
    const sorted = [...metrics.samples].sort((a, b) => a - b);

    snapshots.push({
      route,
      count: metrics.count,
      errorCount: metrics.errorCount,
      avgMs: Math.round(metrics.totalMs / metrics.count),
      p50Ms: percentile(sorted, 50),
      p95Ms: percentile(sorted, 95),
      p99Ms: percentile(sorted, 99),
      maxMs: Math.round(metrics.maxMs),
    });
  }

  snapshots.sort((a, b) => b.p95Ms - a.p95Ms);

  return {
    uptimeSeconds: Math.round(process.uptime()),
    totalRequests,
    totalErrors,
    errorRate:
      totalRequests === 0
        ? 0
        : Number((totalErrors / totalRequests).toFixed(4)),
    sampledSince: new Date(startedAt).toISOString(),
    routes: snapshots,
  };
}

/** Clears all collected metrics. Exists for tests and manual diagnostics. */
export function resetMetrics(): void {
  routes.clear();
  totalRequests = 0;
  totalErrors = 0;
  startedAt = Date.now();
}
