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
const {
  ALERT_EVERY_MS,
  HEARTBEAT_EVERY_MS,
  runAlertRound,
  writeWorkerHeartbeat,
} = await import("@/platform/ops");
const { log } = await import("@/lib");

const stop = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log.info("worker_stopping", { signal });
    stop.abort();
  });
}

const workerId = `worker-${process.pid}`;
log.info("worker_started", { workerId, types: Object.keys(jobHandlers) });

// Heartbeat for /api/salud (BAS-11): written on a timer, so a long job does
// not make a live worker look down.
const beat = () =>
  writeWorkerHeartbeat(workerId).catch((error: unknown) =>
    log.error("worker_heartbeat_failed", error),
  );
await beat();
const heartbeat = setInterval(beat, HEARTBEAT_EVERY_MS);

// Operations alerts (PIL-04): one round a minute, never two at once.
let seen: string[] = [];
let checking = false;
const alerts = setInterval(() => {
  if (checking) return;
  checking = true;
  runAlertRound(seen)
    .then((now) => (seen = now))
    .catch((error: unknown) => log.error("ops_alert_round_failed", error))
    .finally(() => (checking = false));
}, ALERT_EVERY_MS);

await runWorker(jobHandlers, {
  workerId,
  signal: stop.signal,
  onOutcome: (outcome) => {
    if (outcome.kind === "idle") return;
    const fields = {
      jobId: outcome.jobId,
      organizationId: outcome.organizationId,
      ...("error" in outcome ? { reason: outcome.error } : {}),
    };
    if (outcome.kind === "failed") log.warn(`job_${outcome.kind}`, fields);
    else log.info(`job_${outcome.kind}`, fields);
  },
});
clearInterval(heartbeat);
clearInterval(alerts);
await db.$disconnect();
log.info("worker_stopped", { workerId });
