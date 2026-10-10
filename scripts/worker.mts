// Worker of the job queue (IMP-01): a process apart from the web
// application that runs background work — imports, exports — one job at a
// time. Several can run at once; they never take the same job.
//
// Usage:
//   npm run worker                              (database of .env.local)
//   DATABASE_NAME=almacen_test npm run worker
// Stop with Ctrl+C: it finishes the job in hand first.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

// The worker runs the same server code as the web application, outside
// Next.js. `server-only` exists to stop that code from reaching a browser
// bundle and throws anywhere else; here — a server process — it resolves
// to an empty module, as it does in the tests.
const serverOnly = pathToFileURL("scripts/server-only-stub.mjs").href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnly, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { db } = await import("@/server/db");
const { runWorker } = await import("@/platform/jobs/queue");
const { jobHandlers } = await import("@/modules/registry/jobs");

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("[jobs] deteniendo al terminar el trabajo en curso…");
    stop.abort();
  });
}

const workerId = `worker-${process.pid}`;
console.log(
  `[jobs] ${workerId} en marcha. Tipos: ${Object.keys(jobHandlers).join(", ") || "(ninguno todavía)"}`,
);
await runWorker(jobHandlers, {
  workerId,
  signal: stop.signal,
  onOutcome: (outcome) => {
    if (outcome.kind === "idle") return;
    console.log(
      `[jobs] ${outcome.kind} ${outcome.jobId} (empresa ${outcome.organizationId})` +
        ("error" in outcome ? `: ${outcome.error}` : ""),
    );
  },
});
await db.$disconnect();
console.log("[jobs] detenido.");
