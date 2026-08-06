// Vitest config for PURE unit tests (no database).
//
// The default vitest.config.ts registers a global setupFile that calls
// cleanDatabase() before EVERY test — which points at the live Neon database
// and, besides being destructive, makes pure logic tests fail for reasons
// unrelated to the code under test.
//
// Engine/util tests are pure functions and need no database at all, so this
// config runs them without that setup. Use:  npm run test:unit
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Loads .env only. Deliberately does NOT include ./src/__tests__/setup.ts,
    // whose beforeEach wipes the database. Some of these suites transitively
    // import the prisma singleton (which reads DATABASE_URL at module scope)
    // without ever issuing a query, so the env still has to be present.
    setupFiles: ["dotenv/config"],
    include: [
      "src/engines/__tests__/**/*.test.ts",
      "src/utils/__tests__/**/*.test.ts",
      // Observability primitives (request context, error reporter). Pure
      // in-process logic with no database, so they belong on the fast path.
      "src/config/__tests__/**/*.test.ts",
      // Request-contract schemas. Zod parsing is pure, so these need no
      // database either.
      "src/validation/__tests__/**/*.test.ts",
      // Offline sync: policy classification/ordering, signature canonicalization
      // and raw-body capture. All pure logic over the generated manifest and
      // node:crypto — no database, despite living under src/offline.
      "src/offline/__tests__/policy.test.ts",
      "src/offline/__tests__/requestSignature.test.ts",
      "src/offline/__tests__/rawBodyCapture.test.ts",
      "src/offline/__tests__/conflicts.test.ts",
      "src/offline/__tests__/scalarListBridge.test.ts",
      // Rollback safety: the disabled path must never reach SQLite. Pure
      // config/controller logic — the local client is mocked to throw, which
      // is precisely what makes the assertion meaningful without a database.
      "src/offline/__tests__/rollback.test.ts",
      "src/offline/__tests__/defaultDisabled.test.ts",
      // Till provisioning. Uses REAL SQLite (a pushed mirror template that each
      // case copies) but never touches Neon — the cloud download is stubbed per
      // case. So it needs no DATABASE_URL and belongs on the fast path, despite
      // being an integration suite by every other measure.
      "src/offline/__tests__/provisioning.integration.test.ts",
    ],
    // The provisioning suite pushes a mirror template once at module scope,
    // which is a ~30s Prisma subprocess. The 10s default kills it mid-push and
    // the whole suite then reports as skipped.
    testTimeout: 120000,
    hookTimeout: 120000,
  },
});
