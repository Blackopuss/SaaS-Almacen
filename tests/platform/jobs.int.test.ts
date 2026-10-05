import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib";
import {
  enqueueJob,
  getJob,
  runNextJob,
  runWorker,
  type JobContext,
  type JobHandlers,
} from "@/platform/jobs";
import { db, forOrganization } from "@/server";
import { createTestOrganization } from "../setup/organization";

// IMP-01: durable queue in MySQL. A failed job retries up to its limit
// and every job runs in the company it belongs to.

const stamp = Date.now();
let counter = 0;

async function company() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `cola.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const organization = await createTestOrganization({
    data: { id: newId(), name: `Ferretería ${counter}`, ownerUserId: user.id },
  });
  const organizationId = organization.id;
  return { organizationId, userId: user.id };
}

/** No waiting between attempts, so tests do not sleep. */
const at = (handle: (context: JobContext) => Promise<unknown>) => ({
  handle,
  retryDelayMs: () => 0,
});

const add = (
  organizationId: string,
  type: string,
  extra: Partial<Parameters<typeof enqueueJob>[2]> = {},
) =>
  enqueueJob(forOrganization(organizationId), organizationId, {
    type,
    ...extra,
  });

/** Runs until the queue has nothing due. */
async function drain(handlers: JobHandlers, limit = 50) {
  const outcomes = [];
  for (let i = 0; i < limit; i++) {
    const outcome = await runNextJob(handlers, { workerId: "test" });
    if (outcome.kind === "idle") break;
    outcomes.push(outcome);
  }
  return outcomes;
}

beforeEach(async () => {
  // Each test starts with an empty queue: jobs are shared by every worker.
  await db.job.deleteMany({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterAll(() => db.$disconnect());

describe("enqueueJob and runNextJob", () => {
  it("runs a job with its payload and keeps the result", async () => {
    const { organizationId, userId } = await company();
    const seen: JobContext[] = [];
    const { jobId } = await add(organizationId, "test.sum", {
      payload: { a: 2, b: 3 },
      createdByUserId: userId,
    });
    expect(await getJob(organizationId, jobId)).toMatchObject({
      status: "PENDING",
      attempts: 0,
      maxAttempts: 5,
    });
    const outcome = await runNextJob(
      {
        "test.sum": at(async (context) => {
          seen.push(context);
          const { a, b } = context.payload as { a: number; b: number };
          return { total: a + b };
        }),
      },
      { workerId: "test" },
    );
    expect(outcome).toEqual({ kind: "done", jobId, organizationId });
    expect(seen).toEqual([
      {
        jobId,
        organizationId,
        createdByUserId: userId,
        payload: { a: 2, b: 3 },
        attempt: 1,
        maxAttempts: 5,
      },
    ]);
    const job = await getJob(organizationId, jobId);
    expect(job).toMatchObject({
      status: "DONE",
      attempts: 1,
      lastError: null,
      result: { total: 5 },
    });
    expect(job!.finishedAt).toBeInstanceOf(Date);
    expect(await runNextJob({}, { workerId: "test" })).toEqual({
      kind: "idle",
    });
  });

  it("a failed job retries, and succeeds when the problem goes away", async () => {
    const { organizationId } = await company();
    const { jobId } = await add(organizationId, "test.flaky");
    let calls = 0;
    const handlers = {
      "test.flaky": at(async () => {
        if (++calls < 3) throw new Error("El servicio no respondió");
        return "listo";
      }),
    };
    const first = await runNextJob(handlers, { workerId: "test" });
    expect(first).toMatchObject({
      kind: "retry",
      jobId,
      attempt: 1,
      error: "El servicio no respondió",
    });
    expect(await getJob(organizationId, jobId)).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastError: "El servicio no respondió",
      finishedAt: null,
    });
    expect((await drain(handlers)).map((o) => o.kind)).toEqual([
      "retry",
      "done",
    ]);
    expect(calls).toBe(3);
    expect(await getJob(organizationId, jobId)).toMatchObject({
      status: "DONE",
      attempts: 3,
      lastError: null,
      result: "listo",
    });
  });

  it("stops at its limit and stays failed", async () => {
    const { organizationId } = await company();
    const { jobId } = await add(organizationId, "test.broken", {
      maxAttempts: 3,
    });
    let calls = 0;
    const handlers = {
      "test.broken": at(async () => {
        calls++;
        throw new Error("Archivo ilegible\n  at línea 1");
      }),
    };
    expect((await drain(handlers)).map((o) => o.kind)).toEqual([
      "retry",
      "retry",
      "failed",
    ]);
    expect(calls).toBe(3);
    const job = await getJob(organizationId, jobId);
    expect(job).toMatchObject({
      status: "FAILED",
      attempts: 3,
      maxAttempts: 3,
      // One line, for people.
      lastError: "Archivo ilegible at línea 1",
    });
    expect(job!.finishedAt).toBeInstanceOf(Date);
    // Nothing takes it again.
    expect(await drain(handlers)).toEqual([]);
    expect(calls).toBe(3);
  });

  it("waits before the next attempt", async () => {
    const { organizationId } = await company();
    const { jobId } = await add(organizationId, "test.slow");
    let calls = 0;
    const handlers: JobHandlers = {
      "test.slow": {
        handle: async () => {
          calls++;
          throw new Error("Todavía no");
        },
        retryDelayMs: (attempt) => attempt * 60_000,
      },
    };
    const start = new Date();
    const first = await runNextJob(handlers, {
      workerId: "test",
      now: () => start,
    });
    expect(first).toMatchObject({ kind: "retry", attempt: 1 });
    if (first.kind !== "retry") return;
    expect(first.runAt.getTime()).toBe(start.getTime() + 60_000);
    // Not due yet…
    expect(
      await runNextJob(handlers, {
        workerId: "test",
        now: () => new Date(start.getTime() + 59_000),
      }),
    ).toEqual({ kind: "idle" });
    // …and due a minute later.
    expect(
      await runNextJob(handlers, {
        workerId: "test",
        now: () => new Date(start.getTime() + 61_000),
      }),
    ).toMatchObject({ kind: "retry", jobId, attempt: 2 });
    expect(calls).toBe(2);
  });

  it("a job nobody knows how to run fails at once, without retrying", async () => {
    const { organizationId } = await company();
    const { jobId } = await add(organizationId, "test.unknown");
    expect(await runNextJob({}, { workerId: "test" })).toMatchObject({
      kind: "failed",
      jobId,
    });
    expect(await getJob(organizationId, jobId)).toMatchObject({
      status: "FAILED",
      attempts: 1,
    });
  });

  it("respects runAt and runs in order", async () => {
    const { organizationId } = await company();
    const order: string[] = [];
    const handlers = {
      "test.order": at(async (context) => {
        order.push((context.payload as { name: string }).name);
      }),
    };
    const base = Date.now();
    await add(organizationId, "test.order", {
      payload: { name: "después" },
      runAt: new Date(base - 1_000),
    });
    await add(organizationId, "test.order", {
      payload: { name: "primero" },
      runAt: new Date(base - 5_000),
    });
    await add(organizationId, "test.order", {
      payload: { name: "mañana" },
      runAt: new Date(base + 86_400_000),
    });
    await drain(handlers);
    expect(order).toEqual(["primero", "después"]);
  });

  it("refuses malformed jobs", async () => {
    const { organizationId } = await company();
    await expect(add(organizationId, "Sin Formato")).rejects.toThrow();
    await expect(add(organizationId, "suelto")).rejects.toThrow();
    await expect(
      add(organizationId, "test.big", { payload: "x".repeat(70_000) }),
    ).rejects.toThrow();
    await expect(
      add(organizationId, "test.many", { maxAttempts: 0 }),
    ).rejects.toThrow();
    await expect(
      add(organizationId, "test.many", { maxAttempts: 21 }),
    ).rejects.toThrow();
    expect(await db.job.count()).toBe(0);
  });
});

describe("company context", () => {
  it("each job runs in its own company, also after failing", async () => {
    const a = await company();
    const b = await company();
    const seen: [string, string, number][] = [];
    const handlers = {
      "test.context": at(async (context) => {
        // The handler works with the company client of the job.
        const client = forOrganization(context.organizationId);
        const rows = await client.job.findMany({ select: { id: true } });
        seen.push([
          (context.payload as { name: string }).name,
          context.organizationId,
          rows.length,
        ]);
        if (context.attempt === 1) throw new Error("Primer intento");
      }),
    };
    await add(a.organizationId, "test.context", { payload: { name: "A" } });
    await add(b.organizationId, "test.context", { payload: { name: "B1" } });
    await add(b.organizationId, "test.context", { payload: { name: "B2" } });
    const outcomes = await drain(handlers);
    expect(outcomes.filter((o) => o.kind === "done")).toHaveLength(3);
    expect(seen).toHaveLength(6);
    for (const [name, organizationId, visible] of seen) {
      // First and second attempt alike: its company, and only its jobs.
      expect(organizationId).toBe(
        name === "A" ? a.organizationId : b.organizationId,
      );
      expect(visible).toBe(name === "A" ? 1 : 2);
    }
  });

  it("a company only sees and adds its own jobs", async () => {
    const a = await company();
    const b = await company();
    const { jobId } = await add(a.organizationId, "test.private");
    expect(await getJob(b.organizationId, jobId)).toBeNull();
    expect((await getJob(a.organizationId, jobId))!.id).toBe(jobId);
    // The company of a job cannot be chosen by whoever enqueues it.
    await expect(
      enqueueJob(forOrganization(a.organizationId), b.organizationId, {
        type: "test.private",
      }),
    ).rejects.toThrow();
    // A payload that names another company changes nothing.
    await add(a.organizationId, "test.spoof", {
      payload: { organizationId: b.organizationId },
    });
    let ran = "";
    await drain({
      "test.private": at(async () => {}),
      "test.spoof": at(async (context) => {
        ran = context.organizationId;
      }),
    });
    expect(ran).toBe(a.organizationId);
  });

  it("is enqueued with the change it follows, or not at all", async () => {
    const { organizationId } = await company();
    await expect(
      forOrganization(organizationId).$transaction(async (tx) => {
        await enqueueJob(tx, organizationId, { type: "test.rolled_back" });
        throw new Error("the business change failed");
      }),
    ).rejects.toThrow("the business change failed");
    expect(await db.job.count()).toBe(0);
  });
});

describe("workers", () => {
  it("two workers never run the same job", async () => {
    const { organizationId } = await company();
    const runs = new Map<string, number>();
    const handlers = {
      "test.once": at(async (context) => {
        runs.set(context.jobId, (runs.get(context.jobId) ?? 0) + 1);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }),
    };
    for (let i = 0; i < 12; i++) await add(organizationId, "test.once");
    const worker = async (workerId: string) => {
      for (;;) {
        const outcome = await runNextJob(handlers, { workerId });
        if (outcome.kind === "idle") return;
      }
    };
    await Promise.all([worker("w1"), worker("w2"), worker("w3")]);
    expect(runs.size).toBe(12);
    expect([...runs.values()].every((count) => count === 1)).toBe(true);
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(12);
  }, 60_000);

  it("a job whose worker died is taken again, within its limit", async () => {
    const { organizationId } = await company();
    const { jobId } = await add(organizationId, "test.abandoned", {
      maxAttempts: 2,
    });
    const start = new Date();
    let calls = 0;
    // The first worker takes it and never comes back.
    const hang = runNextJob(
      {
        "test.abandoned": at(
          () =>
            new Promise((resolve) => {
              calls++;
              setTimeout(resolve, 600);
            }),
        ),
      },
      { workerId: "dead", now: () => start },
    );
    await vi.waitFor(async () => {
      expect((await getJob(organizationId, jobId))!.status).toBe("RUNNING");
    });
    // Nobody takes it while it may still be running…
    expect(
      await runNextJob({}, { workerId: "other", now: () => start }),
    ).toEqual({ kind: "idle" });
    // …but after the time limit another worker does.
    const later = () => new Date(start.getTime() + 31 * 60_000);
    const second = await runNextJob(
      {
        "test.abandoned": at(async () => {
          calls++;
          return "rescatado";
        }),
      },
      { workerId: "other", now: later },
    );
    expect(second).toMatchObject({ kind: "done", jobId });
    // The late answer of the first worker does not overwrite the result.
    await hang;
    expect(calls).toBe(2);
    expect(await getJob(organizationId, jobId)).toMatchObject({
      status: "DONE",
      attempts: 2,
      result: "rescatado",
    });
  }, 30_000);

  it("an abandoned job without attempts left ends as failed", async () => {
    const { organizationId } = await company();
    const { jobId } = await add(organizationId, "test.lost", {
      maxAttempts: 1,
    });
    const start = new Date();
    await db.job.update({
      where: { id: jobId },
      data: {
        status: "RUNNING",
        attempts: 1,
        lockedAt: start,
        lockedBy: "dead",
      },
    });
    let ran = false;
    expect(
      await runNextJob(
        {
          "test.lost": at(async () => {
            ran = true;
          }),
        },
        {
          workerId: "other",
          now: () => new Date(start.getTime() + 31 * 60_000),
        },
      ),
    ).toEqual({ kind: "idle" });
    expect(ran).toBe(false);
    expect(await getJob(organizationId, jobId)).toMatchObject({
      status: "FAILED",
      attempts: 1,
    });
  });

  it("the loop runs what arrives and stops when asked", async () => {
    const { organizationId } = await company();
    const stop = new AbortController();
    const done: string[] = [];
    const handlers = {
      "test.loop": at(async (context) => {
        done.push(context.jobId);
        if (done.length === 3) stop.abort();
      }),
    };
    const first = await add(organizationId, "test.loop");
    const loop = runWorker(handlers, {
      workerId: "loop",
      signal: stop.signal,
      idleMs: 20,
    });
    await vi.waitFor(() => expect(done).toEqual([first.jobId]));
    await add(organizationId, "test.loop");
    await add(organizationId, "test.loop");
    await loop;
    expect(done).toHaveLength(3);
    expect(await db.job.count({ where: { status: "DONE" } })).toBe(3);
  }, 30_000);
});
