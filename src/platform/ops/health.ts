import "server-only";

import { existsSync } from "node:fs";
import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { recentErrorCount } from "@/lib";
import { db } from "@/server";

/**
 * Health of the installation (BAS-11, PIL-04), for an uptime monitor that
 * polls /api/salud: database, worker, queue, last backup and errors. It
 * answers with states only (never data of a company) and reads across
 * companies on purpose: it is operations, not business data.
 */

export type CheckState = "ok" | "falla" | "sin_configurar";
export type Health = {
  ok: boolean;
  checks: {
    database: CheckState;
    worker: CheckState;
    queue: CheckState;
    backup: CheckState;
    errors: CheckState;
  };
};

/** The worker writes its heartbeat this often; older than this is down. */
export const HEARTBEAT_EVERY_MS = 15_000;
export const WORKER_DOWN_AFTER_MS = 2 * 60 * 1000;
/** A job ready to run that nobody took in this long: the queue is stuck. */
export const QUEUE_STUCK_AFTER_MS = 10 * 60 * 1000;
/** Backups run daily; a missed one shows after this. */
export const BACKUP_STALE_AFTER_MS = 26 * 60 * 60 * 1000;
/** Errors in 15 minutes from which the server counts as failing. */
export const ERROR_ALERT_THRESHOLD = 20;

export function heartbeatFile(): string {
  return (
    process.env.WORKER_HEARTBEAT_FILE ??
    path.join(process.cwd(), ".local", "worker-heartbeat.json")
  );
}

/** Called by the worker on a timer: «I am alive». */
export async function writeWorkerHeartbeat(workerId: string): Promise<void> {
  const file = heartbeatFile();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({ workerId, at: new Date().toISOString() }),
  );
}

async function lastHeartbeat(): Promise<number | null> {
  try {
    const { at } = JSON.parse(await readFile(heartbeatFile(), "utf8")) as {
      at?: string;
    };
    const time = Date.parse(at ?? "");
    return Number.isNaN(time) ? null : time;
  } catch {
    return null;
  }
}

/** Mark left by a backup that failed, next to the status file. */
function backupFailedFile(statusFile: string): string {
  return `${statusFile}.fallido`;
}

async function lastBackup(): Promise<number | null | undefined> {
  const file = process.env.BACKUP_STATUS_FILE;
  if (!file) return undefined;
  try {
    // `respaldo` leaves this mark when it fails (PIL-04): alert now, not
    // when the last good one gets old. The next good backup removes it.
    if (existsSync(backupFailedFile(file))) return null;
    return (await stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

export async function checkHealth(now = Date.now()): Promise<Health> {
  let database: CheckState = "ok";
  let queue: CheckState = "ok";
  try {
    await db.$queryRaw`SELECT 1`;
    const waiting = await db.job.findFirst({
      where: {
        status: "PENDING",
        runAt: { lte: new Date(now - QUEUE_STUCK_AFTER_MS) },
      },
      select: { id: true },
    });
    queue = waiting ? "falla" : "ok";
  } catch {
    database = "falla";
    queue = "falla";
  }

  const beat = await lastHeartbeat();
  const worker: CheckState =
    beat !== null && now - beat < WORKER_DOWN_AFTER_MS ? "ok" : "falla";

  const backupAt = await lastBackup();
  const backup: CheckState =
    backupAt === undefined
      ? "sin_configurar"
      : backupAt !== null && now - backupAt < BACKUP_STALE_AFTER_MS
        ? "ok"
        : "falla";

  const errors: CheckState =
    recentErrorCount(now) >= ERROR_ALERT_THRESHOLD ? "falla" : "ok";

  const checks = { database, worker, queue, backup, errors };
  return {
    ok: Object.values(checks).every((state) => state !== "falla"),
    checks,
  };
}
