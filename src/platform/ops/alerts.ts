import "server-only";

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { log } from "@/lib";
import { operationsAlertEmail, sendEmail } from "@/platform/email";

import { afterNotice, alertChanges } from "./alert-rules";
import { checkHealth, heartbeatFile, type Health } from "./health";

/**
 * Operations alerts (PIL-04, ADR 0025). The worker runs a round every
 * minute: what fails is checkHealth here (database, queue, backup, the
 * worker's own errors) plus the web application's /api/salud (its errors;
 * «web» when it does not answer). Changes go by email to ALERT_EMAIL.
 * When the worker or the whole server is down nothing here can speak: that
 * is the external monitor's job (UptimeRobot on /api/salud).
 */
export const ALERT_EVERY_MS = 60_000;

type AlertCheck = keyof Health["checks"] | "web";

const LABELS: Record<AlertCheck, string> = {
  web: "La aplicación web no responde.",
  database: "La base de datos no responde.",
  worker: "El worker de la cola no da señales de vida.",
  queue:
    "La cola de trabajos está detenida: hay trabajos esperando más de 10 minutos.",
  backup: "El respaldo falló o el último correcto tiene más de 26 horas.",
  errors: "Hay muchos errores en el servidor (20 o más en 15 minutos).",
};

function stateFile(): string {
  return path.join(path.dirname(heartbeatFile()), "alertas.json");
}

function failing(health: Health): AlertCheck[] {
  return (Object.keys(health.checks) as (keyof Health["checks"])[]).filter(
    (check) => health.checks[check] === "falla",
  );
}

async function currentFailures(healthUrl: string): Promise<AlertCheck[]> {
  const found = new Set(failing(await checkHealth()));
  try {
    const response = await fetch(healthUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await response.json()) as Health;
    if (!body?.checks) throw new Error("respuesta sin estados");
    for (const check of failing(body)) found.add(check);
  } catch {
    found.add("web");
  }
  return [...found];
}

async function readNotified(): Promise<string[]> {
  try {
    const saved = JSON.parse(await readFile(stateFile(), "utf8")) as unknown;
    return Array.isArray(saved) ? saved.filter((c) => c in LABELS) : [];
  } catch {
    return [];
  }
}

/**
 * One round. Takes the failures seen in the previous round and returns the
 * ones seen now, for the next. What was already reported lives in a file
 * next to the heartbeat, so a restart (each deploy) does not repeat it.
 */
export async function runAlertRound(
  previous: readonly string[],
  healthUrl = process.env.HEALTH_URL ?? "http://127.0.0.1:3000/api/salud",
): Promise<string[]> {
  const current = await currentFailures(healthUrl);
  const notified = await readNotified();
  const changes = alertChanges(current, previous, notified);
  if (changes.failed.length === 0 && changes.recovered.length === 0) {
    return current;
  }
  // Saved before sending: an email that cannot go out stays in the log,
  // instead of being retried (and logged as an error) every minute.
  await writeFile(stateFile(), JSON.stringify(afterNotice(notified, changes)));

  const label = (check: string) => LABELS[check as AlertCheck];
  const to = process.env.ALERT_EMAIL?.trim();
  log.warn("ops_alert", { ...changes, failing: current, emailed: Boolean(to) });
  if (!to) return current;
  try {
    await sendEmail(
      operationsAlertEmail({
        to,
        server: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost").host,
        failed: changes.failed.map(label),
        recovered: changes.recovered.map(label),
        stillFailing: notified
          .filter((c) => !changes.recovered.includes(c))
          .map(label),
      }),
    );
  } catch (error) {
    log.error("ops_alert_email_failed", error);
  }
  return current;
}
