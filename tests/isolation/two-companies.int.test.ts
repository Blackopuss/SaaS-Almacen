import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { listAuditEvents } from "@/platform/audit";
import { listActiveSessions, revokeSession } from "@/platform/auth";
import {
  createOrganization,
  resolveActiveOrganization,
  switchOrganization,
} from "@/platform/tenancy";
import { TENANT_MODELS, db, forOrganization } from "@/server";

// PLT-15: two companies, and every way a person of company A could reach
// company B by changing an identifier, a request body or stored state.

const stamp = Date.now();
const ids = { ana: "", beto: "", worker: "" };
let orgA = "";
let orgB = "";
let workerSession = "";
let betoSession = "";

async function newUser(label: string) {
  return (
    await db.user.create({
      data: {
        id: newId(),
        name: label,
        email: `${label}.iso.${stamp}@example.test`,
        emailVerified: true,
      },
    })
  ).id;
}

async function newSession(userId: string) {
  return (
    await db.session.create({
      data: {
        id: newId(),
        userId,
        token: randomBytes(24).toString("hex"),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    })
  ).id;
}

beforeAll(async () => {
  ids.ana = await newUser("ana");
  ids.beto = await newUser("beto");
  ids.worker = await newUser("trabajador");
  const a = await createOrganization(ids.ana, {
    name: "Empresa A",
    timeZone: "",
  });
  const b = await createOrganization(ids.beto, {
    name: "Empresa B",
    timeZone: "",
  });
  if (!a.ok || !b.ok) throw new Error("setup failed");
  orgA = a.organizationId;
  orgB = b.organizationId;
  const membership = await db.membership.create({
    data: { id: newId(), organizationId: orgA, userId: ids.worker },
  });
  // Some data in every company table of both companies.
  const betoMembership = await db.membership.findFirstOrThrow({
    where: { organizationId: orgB },
  });
  await db.membershipRole.createMany({
    data: [
      {
        id: newId(),
        organizationId: orgA,
        membershipId: membership.id,
        role: "viewer",
      },
      {
        id: newId(),
        organizationId: orgB,
        membershipId: betoMembership.id,
        role: "viewer",
      },
    ],
  });
  await db.ownershipTransfer.createMany({
    data: [
      {
        id: newId(),
        organizationId: orgA,
        fromUserId: ids.ana,
        toMembershipId: membership.id,
        previousOwnerRoles: ["viewer"],
        expiresAt: new Date(Date.now() + 3_600_000),
      },
      {
        id: newId(),
        organizationId: orgB,
        fromUserId: ids.beto,
        toMembershipId: betoMembership.id,
        previousOwnerRoles: ["viewer"],
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    ],
  });
  await db.invitation.createMany({
    data: [orgA, orgB].map((organizationId, index) => ({
      id: newId(),
      organizationId,
      email: `invitado.${index}.iso.${stamp}@example.test`,
      tokenHash: randomBytes(32).toString("hex"),
      roles: ["viewer"],
      invitedByUserId: index === 0 ? ids.ana : ids.beto,
      expiresAt: new Date(Date.now() + 3_600_000),
    })),
  });
  // Commercial rows (MOD-03) in both companies.
  const plan = await db.planVersion.create({
    data: {
      id: newId(),
      tier: `iso${stamp % 100000}`,
      version: 1,
      name: "Aislamiento",
      productLimit: 100,
      includedUsers: 2,
      extraUserPrice: "49.00",
      effectiveFrom: new Date(),
    },
  });
  for (const organizationId of [orgA, orgB]) {
    const subscription = await db.subscription.create({
      data: {
        id: newId(),
        organizationId,
        planVersionId: plan.id,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    await db.subscriptionItem.create({
      data: {
        id: newId(),
        organizationId,
        subscriptionId: subscription.id,
        moduleId: "inventory",
        monthlyPrice: "149.00",
        activeFrom: new Date(),
      },
    });
    const category = await db.productCategory.create({
      data: { id: newId(), organizationId, name: "Tornillería" },
    });
    const brand = await db.productBrand.create({
      data: { id: newId(), organizationId, name: "Truper" },
    });
    const productId = newId();
    await db.product.create({
      data: {
        id: productId,
        organizationId,
        sku: "TOR-001",
        name: "Tornillo 1/4",
        categoryId: category.id,
        brandId: brand.id,
        barcode: "7501234567890",
      },
    });
    const presentation = await db.productPresentation.create({
      data: { id: newId(), organizationId, productId, name: "Caja" },
    });
    await db.presentationVersion.create({
      data: {
        id: newId(),
        organizationId,
        presentationId: presentation.id,
        version: 1,
        factor: "100",
        createdByUserId: organizationId === orgA ? ids.ana : ids.beto,
      },
    });
    await db.quotaUsage.create({
      data: { id: newId(), organizationId, key: "active_products", taken: 1 },
    });
    // Stock (INV-15): a movement with one line and its balance.
    const location = await db.location.findFirstOrThrow({
      where: { organizationId, isDefault: true },
    });
    const movementId = newId();
    await db.stockMovement.create({
      data: {
        id: movementId,
        organizationId,
        type: "ENTRY",
        createdByUserId: organizationId === orgA ? ids.ana : ids.beto,
      },
    });
    await db.stockMovementLine.create({
      data: {
        id: newId(),
        organizationId,
        movementId,
        lineNumber: 1,
        productId,
        locationId: location.id,
        direction: "IN",
        capturedQuantity: "5",
        factor: "1",
        baseQuantity: "5",
        unitCode: "piece",
      },
    });
    await db.stockBalance.create({
      data: {
        id: newId(),
        organizationId,
        productId,
        locationId: location.id,
        quantity: "5",
      },
    });
    await db.stockMinimum.create({
      data: {
        id: newId(),
        organizationId,
        productId,
        quantity: "2",
        updatedByUserId: organizationId === orgA ? ids.ana : ids.beto,
      },
    });
    await db.storedFile.create({
      data: {
        id: newId(),
        organizationId,
        purpose: "import_source",
        name: "productos.csv",
        contentType: "text/csv",
        size: 3,
        sha256: "0".repeat(64),
        storageKey: `${organizationId}/prueba`,
        createdByUserId: organizationId === orgA ? ids.ana : ids.beto,
      },
    });
    await db.job.create({
      data: {
        id: newId(),
        organizationId,
        type: "test.noop",
        payload: {},
      },
    });
    const countId = newId();
    await db.stockCount.create({
      data: {
        id: countId,
        organizationId,
        locationId: location.id,
        openLocationId: location.id,
        startedByUserId: organizationId === orgA ? ids.ana : ids.beto,
      },
    });
    const countLineId = newId();
    await db.stockCountLine.create({
      data: {
        id: countLineId,
        organizationId,
        countId,
        productId,
        countedAt: new Date(),
        systemQuantity: "5",
        unitCode: "piece",
      },
    });
    await db.stockCountCapture.create({
      data: {
        id: newId(),
        organizationId,
        lineId: countLineId,
        productId,
        capturedQuantity: "4",
        factor: "1",
        baseQuantity: "4",
        createdByUserId: organizationId === orgA ? ids.ana : ids.beto,
      },
    });
    await db.entitlement.create({
      data: {
        id: newId(),
        organizationId,
        kind: "MODULE",
        key: "inventory",
        validFrom: new Date(),
        subscriptionId: subscription.id,
      },
    });
  }
  workerSession = await newSession(ids.worker);
  betoSession = await newSession(ids.beto);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("company A never sees company B's data", () => {
  it.each(TENANT_MODELS)("%s through the company client", async (model) => {
    const delegate = forOrganization(orgA)[
      (model.charAt(0).toLowerCase() + model.slice(1)) as "membership"
    ] as unknown as {
      findMany(): Promise<{ organizationId: string }[]>;
    };
    const rows = await delegate.findMany();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.organizationId === orgA)).toBe(true);
    const fromB = await (
      db[
        (model.charAt(0).toLowerCase() + model.slice(1)) as "membership"
      ] as unknown as {
        count(args: unknown): Promise<number>;
      }
    ).count({ where: { organizationId: orgB } });
    expect(fromB).toBeGreaterThan(0); // B really has rows to leak
  });

  it("the audit log of A does not show B's events", async () => {
    const events = await listAuditEvents(forOrganization(orgA));
    const idsOfB = new Set(
      (await db.auditEvent.findMany({ where: { organizationId: orgB } })).map(
        (e) => e.id,
      ),
    );
    expect(idsOfB.size).toBeGreaterThan(0);
    expect(events.some((e) => idsOfB.has(e.id))).toBe(false);
  });
});

describe("changing identifiers", () => {
  it("switching to company B with its real id is refused", async () => {
    expect(
      await switchOrganization(ids.worker, workerSession, orgB),
    ).toMatchObject({ ok: false });
    expect(
      (await resolveActiveOrganization(ids.worker, workerSession))?.id,
    ).toBe(orgA);
  });

  it("using another person's session id changes nothing", async () => {
    expect(
      await switchOrganization(ids.worker, betoSession, orgA),
    ).toMatchObject({ ok: false });
    expect(await resolveActiveOrganization(ids.worker, betoSession)).toBeNull();
  });

  it("closing another person's session by id does nothing", async () => {
    expect(await revokeSession(ids.worker, betoSession, workerSession)).toBe(
      false,
    );
    expect(await db.session.count({ where: { id: betoSession } })).toBe(1);
  });

  it("the session list only shows the person's own sessions", async () => {
    const sessions = await listActiveSessions(ids.worker, workerSession);
    expect(sessions.map((s) => s.id)).toEqual([workerSession]);
  });
});

describe("tampered stored state", () => {
  it("a session pointing to company B is re-checked and sent back to A", async () => {
    await db.session.update({
      where: { id: workerSession },
      data: { activeOrganizationId: orgB },
    });
    const active = await resolveActiveOrganization(ids.worker, workerSession);
    expect(active?.id).toBe(orgA);
    const row = await db.session.findUniqueOrThrow({
      where: { id: workerSession },
    });
    expect(row.activeOrganizationId).toBe(orgA);
  });
});
