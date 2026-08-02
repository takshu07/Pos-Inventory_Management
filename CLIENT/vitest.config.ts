/**
 * Client test config — PURE unit tests only.
 *
 * Scope is deliberately narrow, mirroring the server's `vitest.unit.config.ts`
 * philosophy: these suites cover logic that is pure and worth locking down —
 * RBAC guards, validation schemas, filter/param derivation, formatters. They
 * need no DOM, no network and no rendering, so they run in `node` with no
 * setup file and no browser environment to install.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * TESTING POLICY (decided 2026-08-03) — read before adding a suite
 * ───────────────────────────────────────────────────────────────────────────
 *
 * 1. LOGIC TESTS ARE MANDATORY. Any feature shipping RBAC/permission rules,
 *    validation schemas, money or date maths, filter/param derivation, or
 *    transport-layer routing decisions must land with unit tests covering
 *    them. These are the regressions that are silent: nothing crashes, the
 *    types still check, and the damage (a permission that stopped being
 *    enforced, a payload key that stopped being sent) is invisible until
 *    someone is harmed by it.
 *
 * 2. COMPONENT / UI TESTS ARE A SEPARATE INFRASTRUCTURE MILESTONE. They need
 *    jsdom, @testing-library/react, a setup file, and a house style for
 *    queries and async assertions. That is a deliberate piece of work with
 *    its own maintenance cost — it must NOT be bolted on midway through a
 *    feature build, because a half-adopted testing library is worse than
 *    none: it sets a precedent nobody follows consistently.
 *
 *    When that milestone happens: add an `environment: "jsdom"` project (or a
 *    second config) rather than flipping this one, so the pure-logic suites
 *    keep running with no DOM and no setup cost.
 *
 * 3. RATIONALE FOR THE SPLIT. A button that moves is caught by looking at the
 *    screen. A guard that stopped refusing self-demotion is not. Effort goes
 *    where the failure is invisible.
 *
 * The `@` alias is duplicated from vite.config.ts rather than imported from it,
 * because that config pulls in the Tailwind and lucide plugins which have no
 * business loading during a unit test run.
 */

import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    testTimeout: 10000,
  },
});
