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
    testTimeout: 10000,
    sequence: {
      concurrent: false,
    }
  }
});
