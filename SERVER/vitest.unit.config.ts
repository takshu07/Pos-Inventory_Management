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
    ],
    testTimeout: 10000,
  },
});
