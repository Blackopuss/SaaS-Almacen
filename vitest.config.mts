import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Every test process (including global setup) targets the test database,
// never development. tests/setup/test-db.ts double-checks the name.
process.env.DATABASE_NAME = process.env.DATABASE_TEST_NAME ?? "almacen_test";

const src = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": src("./src"),
      // `server-only` throws outside React Server Components; tests are server code.
      "server-only": src("./tests/setup/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["src/**/*.int.test.ts", "tests/**/*.int.test.ts"],
          globalSetup: ["./tests/setup/global-db.ts"],
          // Tests share one database: run files one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
