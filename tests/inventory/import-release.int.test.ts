import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  IMPORT_JOB_TYPE,
  applyImport,
  cancelImport,
  confirmImport,
  getImport,
  releaseFailedImport,
  saveImportMapping,
  startImport,
  type ImportColumnKey,
  type InventoryActor,
} from "@/modules/inventory";
import { jobHandlers } from "@/modules/registry/jobs";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import {
  runNextJob,
  settleFailedJobs,
  type JobHandlers,
} from "@/platform/jobs";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-08B: cancelling, a failure or an abandoned worker give back only
// the places that were not used, without competing with work in progress.

const KEYS = IMPORT_COLUMNS.map((column) => column.key);
const HEADERS = IMPORT_COLUMNS.map((column) => column.header);
const MAPPING = Object.fromEntries(KEYS.map((key, index) => [key, index]));
type Row = Partial<Record<ImportColumnKey, string>>;
type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `liberarimp.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(productLimit = 50): Promise<InventoryActor> {
  const owner = await newUser();
  const created = await createOrganization(owner, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  if (!staff) {
    staff = await newUser();
    await db.platformStaff.create({ data: { userId: staff } });
  }
  const result = await provisionCompany(
    moduleRegistry,
    staff,
    created.organizationId,
    {
      productLimit,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de liberar reservas",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function member(organizationId: string, role: Role) {
  const userId = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId };
}

const fresh = (count: number, prefix = "N"): Row[] =>
  Array.from({ length: count }, (_, i) => ({
    sku: `${prefix}-${String(i + 1).padStart(2, "0")}`,
    name: `Producto ${prefix} ${i + 1}`,
    unit: "pieza",
  }));

/** An import of the given rows with its columns set, not confirmed. */
async function ready(owner: InventoryActor, rows: Row[]) {
  const started = await startImport(owner, {
    name: "productos.csv",
    bytes: buildCsv(
      [HEADERS, ...rows.map((line) => KEYS.map((key) => line[key] ?? ""))],
      { neutralize: false },
    ),
  });
  if (!started.ok) throw new Error(started.error);
  const saved = await saveImportMapping(owner, {
    importId: started.importId,
    mapping: MAPPING,
    decimalSeparator: ".",
  });
  if (!saved.ok) throw new Error("mapping not saved");
  return started.importId;
}

/** The same, confirmed: its places held and its job queued. */
async function confirmed(owner: InventoryActor, rows: Row[]) {
  const importId = await ready(owner, rows);
  const result = await confirmImport(owner, importId);
  if (!result.ok) throw new Error(result.error);
  return importId;
}

const productCount = (owner: InventoryActor) =>
  db.product.count({ where: { organizationId: owner.organizationId } });

const usage = (owner: InventoryActor) =>
  getQuotaUsage(owner.organizationId, "active_products");

/** What the counter says against what really exists and is held. */
async function expectConsistent(owner: InventoryActor) {
  const [counted, active, held] = await Promise.all([
    usage(owner),
    db.product.count({
      where: { organizationId: owner.organizationId, status: "ACTIVE" },
    }),
    db.productImport.aggregate({
      where: { organizationId: owner.organizationId },
      _sum: { reservedPlaces: true },
    }),
  ]);
  expect(counted.used).toBe(active);
  expect(counted.reserved).toBe(held._sum.reservedPlaces ?? 0);
}

const audits = (importId: string, action: string) =>
  db.auditEvent.findMany({ where: { action, targetId: importId } });

/** Applies `batches` batches of `size` and then the worker disappears. */
async function dieAfter(
  owner: InventoryActor,
  importId: string,
  batches: number,
  size: number,
) {
  let done = 0;
  await expect(
    applyImport(owner.organizationId, importId, {
      batchSize: size,
      onBatch: () => {
        if (++done === batches) throw new Error("the worker died");
      },
    }),
  ).rejects.toThrow("the worker died");
}

/** The queued job of an import, left as failed for good. */
async function failJob(importId: string) {
  const job = await db.job.findFirstOrThrow({
    where: { payload: { path: "$.importId", equals: importId } },
  });
  await db.job.update({
    where: { id: job.id },
    data: {
      status: "FAILED",
      attempts: job.maxAttempts,
      finishedAt: new Date(),
      lastError: "falló",
    },
  });
  return job.id;
}

beforeEach(async () => {
  // Jobs are shared by every worker: each test starts with an empty queue.
  await db.job.deleteMany({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  invalidateEntitlements();
});
afterAll(() => db.$disconnect());

describe("cancelImport", () => {
  it("before the worker starts: every held place goes back and nothing is imported", async () => {
    const actor = await company(10);
    const manual = await createProduct(actor, { sku: "YA-1", name: "Ya está" });
    expect(manual.ok).toBe(true);
    const importId = await confirmed(actor, fresh(4));
    expect(await usage(actor)).toMatchObject({ used: 1, reserved: 4 });

    expect(await cancelImport(actor, importId)).toEqual({
      ok: true,
      released: 4,
      applied: 0,
      pending: 4,
    });
    // Only what the import held went back: the manual product keeps its place.
    expect(await usage(actor)).toEqual({
      limit: 10,
      used: 1,
      reserved: 0,
      available: 9,
    });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "CANCELLED",
      reservedPlaces: 0,
      processedItems: 0,
    });
    const [event] = await audits(importId, "inventory.import_cancelled");
    expect(event).toMatchObject({ actorUserId: actor.userId });
    expect(event!.metadata).toMatchObject({
      lugaresDevueltos: 4,
      sinImportar: 4,
    });

    // The job that was waiting finds it cancelled and applies nothing.
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    expect(await productCount(actor)).toBe(1);
    expect(await usage(actor)).toMatchObject({ used: 1, reserved: 0 });
    await expectConsistent(actor);
  });

  it("while it is being applied: what was imported stays, only the rest goes back", async () => {
    const actor = await company(40);
    const importId = await confirmed(actor, fresh(23));
    await dieAfter(actor, importId, 2, 5);
    expect(await usage(actor)).toMatchObject({ used: 10, reserved: 13 });

    expect(await cancelImport(actor, importId)).toEqual({
      ok: true,
      released: 13,
      applied: 10,
      pending: 13,
    });
    expect(await productCount(actor)).toBe(10);
    expect(await usage(actor)).toEqual({
      limit: 40,
      used: 10,
      reserved: 0,
      available: 30,
    });

    // Cancelling again gives nothing back a second time.
    expect(await cancelImport(actor, importId)).toEqual({
      ok: true,
      released: 0,
      applied: 10,
      pending: 13,
      repeated: true,
    });
    expect(await usage(actor)).toMatchObject({ used: 10, reserved: 0 });
    expect(await audits(importId, "inventory.import_cancelled")).toHaveLength(
      1,
    );

    // A worker that comes back applies nothing more.
    expect(await applyImport(actor.organizationId, importId)).toEqual({
      ok: false,
      reason: "stopped",
    });
    expect(await productCount(actor)).toBe(10);
    expect(await getImport(actor, importId)).toMatchObject({
      status: "CANCELLED",
      processedItems: 10,
    });
    await expectConsistent(actor);
  }, 60_000);

  it("at the same time as the worker: the counter always matches what exists", async () => {
    for (let round = 0; round < 3; round++) {
      const actor = await company(40);
      const importId = await confirmed(actor, fresh(18));
      const [applied, cancelled] = await Promise.all([
        applyImport(actor.organizationId, importId, { batchSize: 2 }),
        cancelImport(actor, importId),
      ]);
      const detail = await getImport(actor, importId);
      if (cancelled.ok) {
        expect(applied).toEqual({ ok: false, reason: "stopped" });
        expect(detail!.status).toBe("CANCELLED");
        expect(cancelled.applied + cancelled.pending).toBe(18);
        expect(cancelled.released).toBe(cancelled.pending);
        expect(await productCount(actor)).toBe(cancelled.applied);
      } else {
        // The worker finished first: there was nothing left to cancel.
        expect(cancelled.reason).toBe("finished");
        expect(detail!.status).toBe("DONE");
        expect(await productCount(actor)).toBe(18);
      }
      expect(detail!.reservedPlaces).toBe(0);
      expect((await usage(actor)).reserved).toBe(0);
      await expectConsistent(actor);
    }
  }, 120_000);

  it("the places given back can be used right away, and no more than those", async () => {
    const actor = await company(6);
    const importId = await confirmed(actor, fresh(6));
    await dieAfter(actor, importId, 1, 2);
    // Full while the import holds its places.
    const refused = await createProduct(actor, { sku: "M-0", name: "Manual" });
    expect(refused.ok).toBe(false);
    await cancelImport(actor, importId);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createProduct(actor, { sku: `M-${i + 1}`, name: `Manual ${i + 1}` }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(4);
    expect(await usage(actor)).toEqual({
      limit: 6,
      used: 6,
      reserved: 0,
      available: 0,
    });
    await expectConsistent(actor);
  }, 60_000);

  it("an import that was not confirmed is cancelled without touching the plan", async () => {
    const actor = await company(10);
    const importId = await ready(actor, fresh(3));
    expect(await cancelImport(actor, importId)).toEqual({
      ok: true,
      released: 0,
      applied: 0,
      pending: 0,
    });
    expect(await usage(actor)).toMatchObject({ used: 0, reserved: 0 });
    expect((await getImport(actor, importId))!.status).toBe("CANCELLED");
    // And it can no longer be confirmed.
    expect(await confirmImport(actor, importId)).toMatchObject({
      ok: false,
      reason: "not_ready",
    });
    expect(await db.job.count()).toBe(0);
    expect(await usage(actor)).toMatchObject({ used: 0, reserved: 0 });
  });

  it("an import that already ended is not cancelled", async () => {
    const actor = await company(10);
    const importId = await confirmed(actor, fresh(3));
    await applyImport(actor.organizationId, importId);
    expect(await cancelImport(actor, importId)).toMatchObject({
      ok: false,
      reason: "finished",
    });
    expect((await getImport(actor, importId))!.status).toBe("DONE");
    expect(await usage(actor)).toMatchObject({ used: 3, reserved: 0 });
    expect(await audits(importId, "inventory.import_cancelled")).toEqual([]);
  });

  it("only who may cancel, and only imports of their own company", async () => {
    const actor = await company(10);
    const importId = await confirmed(actor, fresh(2));
    for (const role of ["viewer", "buyer"] as const) {
      await expect(
        cancelImport(await member(actor.organizationId, role), importId),
      ).rejects.toMatchObject({ kind: "forbidden" });
    }
    const theirs = await company(10);
    expect(await cancelImport(theirs, importId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "CONFIRMED",
      reservedPlaces: 2,
    });
    expect(await usage(actor)).toMatchObject({ used: 0, reserved: 2 });
    expect(await usage(theirs)).toMatchObject({ used: 0, reserved: 0 });

    const warehouse = await member(actor.organizationId, "warehouse");
    expect(await cancelImport(warehouse, importId)).toMatchObject({
      ok: true,
      released: 2,
    });
  });
});

describe("a job that failed for good", () => {
  /** Applies one batch of three and fails, every time. */
  const broken = (importId: string): JobHandlers => ({
    [IMPORT_JOB_TYPE]: {
      ...jobHandlers[IMPORT_JOB_TYPE]!,
      retryDelayMs: () => 0,
      handle: async (context) =>
        applyImport(context.organizationId, importId, {
          batchSize: 3,
          onBatch: () => {
            throw new Error("se cayó la conexión");
          },
        }),
    },
  });

  it("gives back what was not used once it runs out of attempts, not before", async () => {
    const actor = await company(20);
    const importId = await confirmed(actor, fresh(10));
    await db.job.updateMany({ data: { maxAttempts: 2 } });
    const handlers = broken(importId);

    expect(await runNextJob(handlers, { workerId: "test" })).toMatchObject({
      kind: "retry",
    });
    // It will be tried again: its places are still its own.
    expect(await settleFailedJobs(handlers)).toEqual({
      settled: 0,
      pending: 0,
    });
    expect(await usage(actor)).toMatchObject({ used: 3, reserved: 7 });

    expect(await runNextJob(handlers, { workerId: "test" })).toMatchObject({
      kind: "failed",
    });
    expect(await usage(actor)).toMatchObject({ used: 6, reserved: 4 });
    expect(await settleFailedJobs(handlers)).toEqual({
      settled: 1,
      pending: 0,
    });
    expect(await usage(actor)).toEqual({
      limit: 20,
      used: 6,
      reserved: 0,
      available: 14,
    });
    const detail = await getImport(actor, importId);
    expect(detail).toMatchObject({
      status: "FAILED",
      reservedPlaces: 0,
      processedItems: 6,
    });
    expect(detail!.lastError).toContain("Faltan 4 productos por importar");
    expect(detail!.finishedAt).not.toBeNull();
    const [event] = await audits(importId, "inventory.import_failed");
    expect(event).toMatchObject({ actorUserId: null });
    expect(event!.metadata).toMatchObject({
      lugaresDevueltos: 4,
      productosImportados: 6,
    });

    // Settling again finds nothing; a worker that comes back applies nothing.
    expect(await settleFailedJobs(handlers)).toEqual({
      settled: 0,
      pending: 0,
    });
    expect(await applyImport(actor.organizationId, importId)).toEqual({
      ok: false,
      reason: "stopped",
    });
    expect(await productCount(actor)).toBe(6);
    expect(await audits(importId, "inventory.import_failed")).toHaveLength(1);
    await expectConsistent(actor);
  }, 60_000);

  it("an abandoned worker with attempts left is taken again and nothing is given back", async () => {
    const actor = await company(20);
    const importId = await confirmed(actor, fresh(8));
    await dieAfter(actor, importId, 1, 3);
    // Its worker took it an hour ago and was never heard of again.
    await db.job.updateMany({
      data: {
        status: "RUNNING",
        attempts: 1,
        lockedAt: new Date(Date.now() - 60 * 60 * 1000),
        lockedBy: "worker-gone",
      },
    });
    expect(await settleFailedJobs(jobHandlers)).toEqual({
      settled: 0,
      pending: 0,
    });
    expect(await usage(actor)).toMatchObject({ used: 3, reserved: 5 });

    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    expect(await productCount(actor)).toBe(8);
    expect(await getImport(actor, importId)).toMatchObject({ status: "DONE" });
    expect(await usage(actor)).toMatchObject({ used: 8, reserved: 0 });
    await expectConsistent(actor);
  }, 60_000);

  it("an abandoned worker with no attempts left frees what it held", async () => {
    const actor = await company(20);
    const importId = await confirmed(actor, fresh(8));
    await dieAfter(actor, importId, 1, 3);
    const job = await db.job.findFirstOrThrow({});
    await db.job.update({
      where: { id: job.id },
      data: {
        status: "RUNNING",
        attempts: job.maxAttempts,
        lockedAt: new Date(Date.now() - 60 * 60 * 1000),
        lockedBy: "worker-gone",
      },
    });
    // While nobody notices it is gone, nothing is given back.
    expect(await settleFailedJobs(jobHandlers)).toEqual({
      settled: 0,
      pending: 0,
    });
    expect(await usage(actor)).toMatchObject({ used: 3, reserved: 5 });

    // The queue finds it abandoned and closes it; then it is settled.
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toEqual({
      kind: "idle",
    });
    expect((await db.job.findFirstOrThrow({})).status).toBe("FAILED");
    expect(await settleFailedJobs(jobHandlers)).toEqual({
      settled: 1,
      pending: 0,
    });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "FAILED",
      reservedPlaces: 0,
      processedItems: 3,
    });
    expect(await usage(actor)).toMatchObject({ used: 3, reserved: 0 });
    await expectConsistent(actor);
  }, 60_000);

  it("the worker thought gone finishes its batch first and then stops", async () => {
    const actor = await company(20);
    const importId = await confirmed(actor, fresh(12));
    const jobId = await failJob(importId);
    // It is still alive, applying; the release arrives in the middle.
    const [applied, released] = await Promise.all([
      applyImport(actor.organizationId, importId, { batchSize: 2 }),
      releaseFailedImport(actor.organizationId, importId, jobId),
    ]);
    expect(applied).toEqual({ ok: false, reason: "stopped" });
    const detail = await getImport(actor, importId);
    expect(detail).toMatchObject({ status: "FAILED", reservedPlaces: 0 });
    expect(released).toEqual({ released: 12 - detail!.processedItems });
    expect(await productCount(actor)).toBe(detail!.processedItems);
    await expectConsistent(actor);
  }, 60_000);

  it("does not take the places of an import another job is still working on", async () => {
    const actor = await company(20);
    const importId = await confirmed(actor, fresh(5));
    const failed = await failJob(importId);
    // Someone queued it again: that work is alive.
    await db.job.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        type: IMPORT_JOB_TYPE,
        payload: { importId },
      },
    });
    expect(
      await releaseFailedImport(actor.organizationId, importId, failed),
    ).toEqual({ released: null, reason: "active_job" });
    expect(await settleFailedJobs(jobHandlers)).toEqual({
      settled: 1,
      pending: 0,
    });
    expect(await getImport(actor, importId)).toMatchObject({
      status: "CONFIRMED",
      reservedPlaces: 5,
    });
    expect(await usage(actor)).toMatchObject({ used: 0, reserved: 5 });

    // The live job uses the places that were kept for it.
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    expect(await usage(actor)).toMatchObject({ used: 5, reserved: 0 });
    await expectConsistent(actor);
  }, 60_000);

  it("releases only in the company of the job, and only an import still held", async () => {
    const ours = await company(10);
    const theirs = await company(10);
    const importId = await confirmed(ours, fresh(3));
    // Its job is waiting: naming it gives nothing back.
    const waiting = await db.job.findFirstOrThrow({});
    expect(
      await releaseFailedImport(ours.organizationId, importId, waiting.id),
    ).toEqual({ released: null, reason: "job_not_failed" });
    expect(
      await releaseFailedImport(ours.organizationId, importId, newId()),
    ).toEqual({ released: null, reason: "job_not_failed" });
    expect(await usage(ours)).toMatchObject({ reserved: 3 });

    const jobId = await failJob(importId);
    expect(
      await releaseFailedImport(theirs.organizationId, importId, jobId),
    ).toEqual({ released: null, reason: "not_found" });
    expect(await usage(ours)).toMatchObject({ reserved: 3 });

    // Cancelled by a person first: the failure finds nothing to give back.
    await cancelImport(ours, importId);
    expect(
      await releaseFailedImport(ours.organizationId, importId, jobId),
    ).toEqual({ released: null, reason: "ended" });
    expect((await getImport(ours, importId))!.status).toBe("CANCELLED");
    expect(await usage(ours)).toMatchObject({ used: 0, reserved: 0 });
    expect(await audits(importId, "inventory.import_failed")).toEqual([]);

    // A job of another company naming our import settles without effect.
    const other = await confirmed(ours, fresh(2, "O"));
    await db.job.deleteMany({});
    await db.job.create({
      data: {
        id: newId(),
        organizationId: theirs.organizationId,
        type: IMPORT_JOB_TYPE,
        payload: { importId: other, organizationId: ours.organizationId },
        status: "FAILED",
        attempts: 1,
        maxAttempts: 1,
        finishedAt: new Date(),
      },
    });
    expect(await settleFailedJobs(jobHandlers)).toEqual({
      settled: 1,
      pending: 0,
    });
    expect(await getImport(ours, other)).toMatchObject({
      status: "CONFIRMED",
      reservedPlaces: 2,
    });
    await expectConsistent(ours);
    await expectConsistent(theirs);
  });
});

describe("whoever confirmed can no longer import (NEG-20)", () => {
  it("what is pending is not applied; the partial result stays and the rest of the places go back", async () => {
    const owner = await company(20);
    const warehouse = await member(owner.organizationId, "warehouse");
    const importId = await confirmed(warehouse, fresh(9));
    await dieAfter(owner, importId, 1, 3);
    expect(await usage(owner)).toMatchObject({ used: 3, reserved: 6 });

    // Their role is taken away while the import is half way.
    await db.membershipRole.deleteMany({
      where: { membership: { userId: warehouse.userId } },
    });
    expect(await runNextJob(jobHandlers, { workerId: "test" })).toMatchObject({
      kind: "done",
    });
    expect(await productCount(owner)).toBe(3);
    const detail = await getImport(owner, importId);
    expect(detail).toMatchObject({
      status: "FAILED",
      reservedPlaces: 0,
      processedItems: 3,
      totalItems: 9,
    });
    expect(detail!.lastError).toContain("ya no puede importar");
    expect(detail!.lastError).toContain("Faltan 6 productos por importar");
    expect(await usage(owner)).toEqual({
      limit: 20,
      used: 3,
      reserved: 0,
      available: 17,
    });
    const [event] = await audits(importId, "inventory.import_failed");
    expect(event).toMatchObject({ actorUserId: null });
    expect(event!.metadata).toMatchObject({
      motivo: "sin_permiso",
      lugaresDevueltos: 6,
    });

    // Giving the role back does not revive it: the file is uploaded again.
    const membership = await db.membership.findFirstOrThrow({
      where: { userId: warehouse.userId },
    });
    await db.membershipRole.create({
      data: {
        id: newId(),
        organizationId: owner.organizationId,
        membershipId: membership.id,
        role: "warehouse",
      },
    });
    expect(await applyImport(owner.organizationId, importId)).toEqual({
      ok: false,
      reason: "stopped",
    });
    expect(await productCount(owner)).toBe(3);
    await expectConsistent(owner);
  }, 60_000);

  it("nothing is applied when the access was lost before the worker started", async () => {
    const owner = await company(20);
    const admin = await member(owner.organizationId, "administrator");
    const importId = await confirmed(admin, fresh(4));
    await db.membershipRole.deleteMany({
      where: { membership: { userId: admin.userId } },
    });
    expect(await applyImport(owner.organizationId, importId)).toEqual({
      ok: false,
      reason: "stopped",
    });
    expect(await productCount(owner)).toBe(0);
    expect(await getImport(owner, importId)).toMatchObject({
      status: "FAILED",
      reservedPlaces: 0,
      processedItems: 0,
    });
    expect(await usage(owner)).toMatchObject({ used: 0, reserved: 0 });
    await expectConsistent(owner);
  });
});
