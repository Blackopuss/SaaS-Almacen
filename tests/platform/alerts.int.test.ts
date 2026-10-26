import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { memoryOutboxFor } from "@/platform/email";
import { runAlertRound, writeWorkerHeartbeat } from "@/platform/ops";
import { db } from "@/server";

// PIL-04: errors, a stopped queue and a failed backup become one email when
// they start failing and one when they recover; nothing in between.

const to = `alertas.${Date.now()}@example.test`;
let dir: string;
let server: Server;
let url: string;
let webChecks: Record<string, string> = {};
const saved = {
  heartbeat: process.env.WORKER_HEARTBEAT_FILE,
  backup: process.env.BACKUP_STATUS_FILE,
  alert: process.env.ALERT_EMAIL,
};

const healthy = {
  database: "ok",
  worker: "ok",
  queue: "ok",
  backup: "sin_configurar",
  errors: "ok",
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "almacen-alertas-"));
  process.env.WORKER_HEARTBEAT_FILE = path.join(dir, "worker.json");
  delete process.env.BACKUP_STATUS_FILE;
  process.env.ALERT_EMAIL = to;
  await writeWorkerHeartbeat("worker-test");
  // Stands in for the web application's /api/salud.
  server = createServer((_request, response) => {
    const ok = Object.values(webChecks).every((state) => state !== "falla");
    response.writeHead(ok ? 200 : 503, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok, checks: webChecks }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/salud`;
});

afterAll(async () => {
  server.close();
  for (const [key, value] of [
    ["WORKER_HEARTBEAT_FILE", saved.heartbeat],
    ["BACKUP_STATUS_FILE", saved.backup],
    ["ALERT_EMAIL", saved.alert],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
  await db.$disconnect();
});

/** Two rounds in a row, as the worker does a minute apart. */
async function twoRounds(): Promise<string[]> {
  return runAlertRound(await runAlertRound([], url), url);
}

describe("runAlertRound", () => {
  it("stays quiet while everything works", async () => {
    webChecks = healthy;
    expect(await twoRounds()).toEqual([]);
    expect(memoryOutboxFor(to)).toHaveLength(0);
  });

  it("alerts once when the web application reports errors", async () => {
    webChecks = { ...healthy, errors: "falla" };
    // A single failing round is a blip: no email yet.
    expect(await runAlertRound([], url)).toEqual(["errors"]);
    expect(memoryOutboxFor(to)).toHaveLength(0);

    expect(await runAlertRound(["errors"], url)).toEqual(["errors"]);
    const [alert] = memoryOutboxFor(to);
    expect(alert?.subject).toMatch(/falla en el servidor/);
    expect(alert?.text).toContain("Empezó a fallar:\n- Hay muchos errores");

    await runAlertRound(["errors"], url);
    expect(memoryOutboxFor(to)).toHaveLength(1);
  });

  it("says when it recovered", async () => {
    webChecks = healthy;
    await twoRounds();
    const mail = memoryOutboxFor(to);
    expect(mail).toHaveLength(2);
    expect(mail[1]?.subject).toMatch(/se recuperó/);
    expect(mail[1]?.text).toContain(
      "Ya funciona otra vez:\n- Hay muchos errores",
    );
  });

  it("alerts on a failed backup and on a stopped queue", async () => {
    const status = path.join(dir, "ultimo-respaldo");
    await writeFile(status, "");
    await writeFile(`${status}.fallido`, "");
    process.env.BACKUP_STATUS_FILE = status;
    webChecks = { ...healthy, queue: "falla" };
    try {
      expect((await twoRounds()).sort()).toEqual(["backup", "queue"]);
      const alert = memoryOutboxFor(to)[2];
      expect(alert?.text).toContain("El respaldo falló");
      expect(alert?.text).toContain("La cola de trabajos está detenida");
    } finally {
      delete process.env.BACKUP_STATUS_FILE;
      webChecks = healthy;
    }
    await twoRounds();
    expect(memoryOutboxFor(to)).toHaveLength(4);
  });

  it("alerts when the web application does not answer", async () => {
    const down = "http://127.0.0.1:9/api/salud";
    await runAlertRound(await runAlertRound([], down), down);
    const alert = memoryOutboxFor(to)[4];
    expect(alert?.text).toContain("La aplicación web no responde.");
  });
});
