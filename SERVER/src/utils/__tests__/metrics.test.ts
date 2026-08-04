// =============================================================================
// HTTP METRICS — regression suite
//
// Two classes of bug are pinned here:
//
//   1. UNBOUNDED CARDINALITY. Keying metrics on the raw path makes every
//      `/sales/<uuid>` its own row, so the map grows with traffic forever — a
//      memory leak that only appears in production, under load, days in. The
//      normalizer is the guard, so it is tested hard.
//   2. ERROR-RATE MEANING. Only 5xx counts. Folding 4xx in would make a busy
//      login screen (401s) or a duplicate-SKU attempt (409) look like an
//      outage, destroying the signal's value for alerting.
// =============================================================================

import { beforeEach, describe, expect, it } from "vitest";

import {
  getMetricsSnapshot,
  normalizeRoute,
  recordRequest,
  resetMetrics,
} from "../metrics";

describe("metrics", () => {
  beforeEach(() => {
    resetMetrics();
  });

  describe("normalizeRoute — cardinality guard", () => {
    it("collapses numeric ids", () => {
      expect(normalizeRoute("/api/v1/sales/12345")).toBe("/api/v1/sales/:id");
    });

    it("collapses UUIDs", () => {
      expect(
        normalizeRoute("/api/v1/sales/bc8299cc-c30f-4276-8dda-a2c4c1bc68de")
      ).toBe("/api/v1/sales/:id");
    });

    it("collapses cuids", () => {
      expect(normalizeRoute("/api/v1/products/clh3k2j1x0000qw8g5h2n9d4f")).toBe(
        "/api/v1/products/:id"
      );
    });

    it("collapses long opaque tokens such as barcodes", () => {
      expect(
        normalizeRoute("/api/v1/products/barcode/8901234567890123456789012345")
      ).toBe("/api/v1/products/barcode/:id");
    });

    it("strips the query string, which is unbounded by definition", () => {
      expect(normalizeRoute("/api/v1/sales?page=3&search=shirt")).toBe(
        "/api/v1/sales"
      );
    });

    it("leaves ordinary path segments intact", () => {
      expect(normalizeRoute("/api/v1/owner/inventory/valuation")).toBe(
        "/api/v1/owner/inventory/valuation"
      );
    });

    it("keeps distinct endpoints distinct after normalization", () => {
      expect(normalizeRoute("/api/v1/sales/1")).not.toBe(
        normalizeRoute("/api/v1/customers/1")
      );
    });

    it("maps many concrete ids onto ONE metrics key", () => {
      for (let i = 0; i < 500; i += 1) {
        recordRequest("GET", `/api/v1/sales/${i}`, 200, 5);
      }

      // The leak guard: 500 distinct URLs, one row.
      expect(getMetricsSnapshot().routes).toHaveLength(1);
    });
  });

  describe("error rate", () => {
    it("counts 5xx as errors", () => {
      recordRequest("GET", "/api/v1/sales", 500, 10);
      recordRequest("GET", "/api/v1/sales", 200, 10);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.totalErrors).toBe(1);
      expect(snapshot.errorRate).toBe(0.5);
    });

    it("does NOT count 4xx as errors", () => {
      // A 401 on login and a 409 on a duplicate SKU are the API working
      // correctly. Counting them would make the error rate useless.
      recordRequest("POST", "/api/v1/auth/login", 401, 10);
      recordRequest("POST", "/api/v1/products", 409, 10);
      recordRequest("GET", "/api/v1/sales", 404, 10);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.totalErrors).toBe(0);
      expect(snapshot.errorRate).toBe(0);
      expect(snapshot.totalRequests).toBe(3);
    });

    it("reports a zero error rate rather than NaN when nothing was recorded", () => {
      expect(getMetricsSnapshot().errorRate).toBe(0);
    });
  });

  describe("percentiles", () => {
    it("computes nearest-rank percentiles over the recorded durations", () => {
      for (let i = 1; i <= 100; i += 1) {
        recordRequest("GET", "/api/v1/sales", 200, i);
      }

      const route = getMetricsSnapshot().routes[0]!;
      expect(route.count).toBe(100);
      expect(route.p50Ms).toBe(50);
      expect(route.p95Ms).toBe(95);
      expect(route.p99Ms).toBe(99);
      expect(route.maxMs).toBe(100);
      expect(route.avgMs).toBe(51); // (1+…+100)/100 = 50.5, rounded
    });

    it("surfaces a slow tail that an average would hide", () => {
      // 2% of requests stall for 4 seconds. The mean stays under 100ms and
      // looks healthy; p99 is what exposes the requests cashiers actually
      // waited on. This is the reason percentiles are reported at all.
      for (let i = 0; i < 196; i += 1) {
        recordRequest("POST", "/api/v1/sales", 200, 20);
      }
      for (let i = 0; i < 4; i += 1) {
        recordRequest("POST", "/api/v1/sales", 200, 4000);
      }

      const route = getMetricsSnapshot().routes[0]!;
      // The average sits an order of magnitude below the tail — which is
      // exactly how a mean conceals a stall.
      expect(route.avgMs).toBeLessThan(route.p99Ms / 10);
      expect(route.p50Ms).toBe(20);
      expect(route.p99Ms).toBe(4000);
      expect(route.maxMs).toBe(4000);
    });

    it("keeps a single outlier above p99, where nearest-rank puts it", () => {
      // Documents the boundary rather than hiding it: with 100 samples, one
      // outlier is the 100th value, so p99 (the 99th) stays fast and `maxMs`
      // is the field that reports it. Reading p99 as "the worst request" is a
      // misreading this test exists to prevent.
      for (let i = 0; i < 99; i += 1) {
        recordRequest("POST", "/api/v1/sales", 200, 20);
      }
      recordRequest("POST", "/api/v1/sales", 200, 4000);

      const route = getMetricsSnapshot().routes[0]!;
      expect(route.p99Ms).toBe(20);
      expect(route.maxMs).toBe(4000);
    });

    it("handles a single sample without going out of bounds", () => {
      recordRequest("GET", "/api/v1/sales", 200, 42);

      const route = getMetricsSnapshot().routes[0]!;
      expect(route.p50Ms).toBe(42);
      expect(route.p99Ms).toBe(42);
    });
  });

  describe("memory bound", () => {
    it("caps retained samples per route regardless of traffic", () => {
      // 5000 requests through a 500-sample reservoir. The count keeps rising
      // (it is a counter, not a sample), but memory does not.
      for (let i = 0; i < 5000; i += 1) {
        recordRequest("GET", "/api/v1/sales", 200, 10);
      }

      const route = getMetricsSnapshot().routes[0]!;
      expect(route.count).toBe(5000);
      // Percentiles still resolve from the bounded reservoir.
      expect(route.p95Ms).toBe(10);
    });

    it("keeps counting totals accurately after the reservoir wraps", () => {
      for (let i = 0; i < 600; i += 1) {
        recordRequest("GET", "/api/v1/sales", 200, 10);
      }
      recordRequest("GET", "/api/v1/sales", 500, 10);

      const snapshot = getMetricsSnapshot();
      expect(snapshot.totalRequests).toBe(601);
      expect(snapshot.routes[0]!.errorCount).toBe(1);
    });
  });

  describe("snapshot", () => {
    it("separates routes by method", () => {
      recordRequest("GET", "/api/v1/sales", 200, 5);
      recordRequest("POST", "/api/v1/sales", 200, 5);

      const routes = getMetricsSnapshot().routes.map((r) => r.route);
      expect(routes).toContain("GET /api/v1/sales");
      expect(routes).toContain("POST /api/v1/sales");
    });

    it("orders routes slowest-p95 first", () => {
      recordRequest("GET", "/api/v1/fast", 200, 5);
      recordRequest("GET", "/api/v1/slow", 200, 900);
      recordRequest("GET", "/api/v1/medium", 200, 100);

      const routes = getMetricsSnapshot().routes.map((r) => r.route);
      expect(routes).toEqual([
        "GET /api/v1/slow",
        "GET /api/v1/medium",
        "GET /api/v1/fast",
      ]);
    });

    it("resets cleanly", () => {
      recordRequest("GET", "/api/v1/sales", 500, 5);
      resetMetrics();

      const snapshot = getMetricsSnapshot();
      expect(snapshot.routes).toHaveLength(0);
      expect(snapshot.totalRequests).toBe(0);
      expect(snapshot.totalErrors).toBe(0);
    });
  });
});
