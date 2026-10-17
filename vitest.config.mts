import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// Every test process (including global setup) targets the test database,
// never development. tests/setup/test-db.ts double-checks the name.
process.env.DATABASE_NAME = process.env.DATABASE_TEST_NAME ?? "almacen_test";
// Emails are captured in memory so tests can read them (PLT-03).
process.env.MAIL_DRIVER = "memory";
// Private files of tests go to a throwaway folder, never to ./storage.
process.env.FILE_STORAGE_DIR = path.join(tmpdir(), "almacen-test-storage");

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
          // Worker threads instead of child processes: on Windows a forked
          // worker sometimes died at start (exit 0xC0000409) with no test
          // failing. Nothing here needs a separate process.
          pool: "threads",
          // Loops of 20–30 real database calls take a few seconds under load.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
