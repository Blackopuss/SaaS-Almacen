// Development server reachable from other devices (a phone on the same
// network). /correos shows links that open accounts, so it is turned off
// here: the Host header that decides "this machine" is written by the
// client and proves nothing (security audit 2).
// Usage: npm run dev:red
import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3000";
const child = spawn("npx", ["next", "dev", "-H", "0.0.0.0", "-p", port], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, DEV_OUTBOX_DISABLED: "1" },
});
child.on("exit", (code) => process.exit(code ?? 0));
