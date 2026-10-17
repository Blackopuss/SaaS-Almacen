import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { enqueueJob } from "@/platform/jobs";
import {
  checkHealth,
  writeWorkerHeartbeat,
  WORKER_DOWN_AFTER_MS,
} from "@/platform/ops";
import { db, forOrganization } from "@/server";
import { createTestOrganization } from "../setup/organization";
import { GET } from "@/app/api/salud/route";

// BAS-11 / PIL-04: /api/salud says what an uptime monitor must alert on.

let dir: string;
const saved = {
  heartbeat: process.env.WORKER_HEARTBEAT_FILE,
  backup: process.env.BACKUP_STATUS_FILE,
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "almacen-salud-"));
  process.env.WORKER_HEARTBEAT_FILE = path.join(dir, "worker.json");
  delete process.env.BACKUP_STATUS_FILE;
});

afterAll(async () => {
  for (const [key, value] of [
    ["WORKER_HEARTBEAT_FILE", saved.heartbeat],
    ["BACKUP_STATUS_FILE", saved.backup],
  ] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
  await db.$disconnect();
});

describe("checkHealth", () => {
  it("fails while no worker has written its heartbeat", async () => {
    const health = await checkHealth();
    expect(health.checks.database).toBe("ok");
    expect(health.checks.worker).toBe("falla");
    expect(health.ok).toBe(false);
  });

  it("is ok with a recent heartbeat and no backup configured", async () => {
    await writeWorkerHeartbeat("worker-test");
    const health = await checkHealth();
    expect(health.checks).toMatchObject({
      database: "ok",
      worker: "ok",
      backup: "sin_configurar",
      errors: "ok",
    });
    expect(
      (await checkHealth(Date.now() + WORKER_DOWN_AFTER_MS + 1000)).checks
        .worker,
    ).toBe("falla");
  });

  it("fails when the last backup is older than a day", async () => {
    const status = path.join(dir, "ultimo-respaldo");
    await writeFile(status, "ok");
    process.env.BACKUP_STATUS_FILE = status;
    try {
      expect((await checkHealth()).checks.backup).toBe("ok");
      const old = new Date(Date.now() - 27 * 60 * 60 * 1000);
      await utimes(status, old, old);
      expect((await checkHealth()).checks.backup).toBe("falla");
      process.env.BACKUP_STATUS_FILE = path.join(dir, "no-existe");
      expect((await checkHealth()).checks.backup).toBe("falla");
    } finally {
      delete process.env.BACKUP_STATUS_FILE;
    }
  });

  it("fails when a job waits too long for a worker", async () => {
    const user = await db.user.create({
      data: {
        id: newId(),
        name: "Salud",
        email: `salud.${Date.now()}@example.test`,
        emailVerified: true,
      },
    });
    const organization = await createTestOrganization({
      data: { id: newId(), name: "Ferretería Salud", ownerUserId: user.id },
    });
    const job = await enqueueJob(
      forOrganization(organization.id),
      organization.id,
      { type: "test.health" },
    );
    await db.job.update({
      where: { id: job.jobId },
      data: { runAt: new Date(Date.now() - 11 * 60 * 1000) },
    });
    try {
      const health = await checkHealth();
      expect(health.checks.queue).toBe("falla");
      expect(health.ok).toBe(false);
    } finally {
      await db.job.update({
        where: { id: job.jobId },
        data: { status: "DONE", finishedAt: new Date() },
      });
    }
  });
});

describe("GET /api/salud", () => {
  it("answers 200 with states only, and is never cached", async () => {
    await writeWorkerHeartbeat("worker-test");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      ok: true,
      checks: {
        database: "ok",
        worker: "ok",
        queue: "ok",
        backup: "sin_configurar",
        errors: "ok",
      },
    });
  });
});
