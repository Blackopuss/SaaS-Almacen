// Development server against the TEST database, for manual browser checks
// that must not leave rows in development (several tables are append-only).
// Usage: npm run dev:test   →  http://localhost:3100
// Create an account to sign in with: npm run test:company -- "<contraseña>"
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const port = process.env.TEST_PORT ?? "3100";
const child = spawn("npx", ["next", "dev", "-p", port], {
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    DATABASE_NAME: process.env.DATABASE_TEST_NAME ?? "almacen_test",
    BETTER_AUTH_URL: `http://localhost:${port}`,
    MAIL_DRIVER: "memory",
    // Same throwaway folder the tests use; never ./storage.
    FILE_STORAGE_DIR: path.join(tmpdir(), "almacen-test-storage"),
  },
});
child.on("exit", (code) => process.exit(code ?? 0));
