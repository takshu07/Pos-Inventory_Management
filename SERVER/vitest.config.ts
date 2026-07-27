import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["dotenv/config", "./src/__tests__/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/generated/**",
        "src/server.ts",
        "src/config/**",
        "**/*.d.ts",
        "**/*.validation.ts", // Optional: schemas are tested implicitly via integrations
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      }
    },
    // These suites hit a REMOTE Neon database, so every query pays network
    // latency. The default 10s hook budget is not enough for cleanDatabase()'s
    // 25-table transaction, which timed out before a single test could run.
    testTimeout: 60000,
    hookTimeout: 120000,
    // These are integration suites sharing ONE database, and every test wipes it
    // in beforeEach. Running test FILES in parallel therefore has them truncate
    // each other's fixtures mid-test — which surfaced as foreign-key violations
    // on rows the failing test had just created. `sequence.concurrent` only
    // orders tests *within* a file, so file-level parallelism must be off too.
    fileParallelism: false,
    sequence: {
      concurrent: false,
    }
  }
});
