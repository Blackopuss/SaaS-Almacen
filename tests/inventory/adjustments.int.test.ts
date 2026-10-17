import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  listRecentMovements,
  reconcileStock,
  registerAdjustment,
  registerEntry,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { listAuditTrail } from "@/platform/audit";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation, getDefaultLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-24: adjustment with a reason. The reason is mandatory and audited.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Doña Esperanza",
      email: `ajuste.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<InventoryActor> {
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
      productLimit: 60,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de ajustes",
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

/** A product with `quantity` in General. */
async function stocked(owner: InventoryActor, quantity = "100", unit?: string) {
  const result = await createProduct(owner, {
    sku: `A-${++counter}`,
    name: "Tornillo",
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  if (quantity !== "0") {
    await registerEntry(owner, { productId: result.productId, quantity });
  }
  return result.productId;
}

const REASON = "Conteo físico: faltaban piezas";

let actor: InventoryActor;
let general = "";

beforeAll(async () => {
  actor = await company();
  general = (await getDefaultLocation(actor))?.id ?? "";
});

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

const inGeneral = async (productId: string) =>
  (await getStockByLocation(actor, productId))[general] ?? "0";

describe("registerAdjustment", () => {
  it("sets the stock to what was counted and writes the difference as a movement", async () => {
    const tornillo = await stocked(actor, "100");
    const result = await registerAdjustment(actor, {
      productId: tornillo,
      quantity: "95",
      reason: REASON,
    });
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.summary).toBe(
      "Ajuste de Tornillo en General: había 100 piezas y ahora hay 95 piezas (−5 piezas).",
    );
    expect(await inGeneral(tornillo)).toBe("95");

    const movement = await db.stockMovement.findUniqueOrThrow({
      where: { id: result.movementId },
      include: { lines: true },
    });
    expect(movement).toMatchObject({ type: "ADJUSTMENT", reason: REASON });
    expect(movement.lines).toHaveLength(1);
    expect(movement.lines[0]).toMatchObject({ direction: "OUT" });
    expect(movement.lines[0]!.baseQuantity.toString()).toBe("5");
    const [listed] = await listRecentMovements(actor, {
      movementId: result.movementId,
    });
    expect(listed).toMatchObject({ typeLabel: "Ajuste", reason: REASON });
  });

  it("adjusts upwards too", async () => {
    const tornillo = await stocked(actor, "100");
    const result = await registerAdjustment(actor, {
      productId: tornillo,
      quantity: "112",
      reason: "Aparecieron cajas sin registrar",
    });
    expect(result).toMatchObject({
      ok: true,
      summary: expect.stringContaining("(+12 piezas)"),
    });
    expect(await inGeneral(tornillo)).toBe("112");
  });

  it("can count zero, and can give stock to a product that had none", async () => {
    const lost = await stocked(actor, "7");
    expect(
      await registerAdjustment(actor, {
        productId: lost,
        quantity: "0",
        reason: "Se extravió todo el lote",
      }),
    ).toMatchObject({
      ok: true,
      summary: expect.stringContaining("había 7 piezas y ahora hay 0 piezas"),
    });
    expect(await getStockByLocation(actor, lost)).toEqual({});

    const found = await stocked(actor, "0");
    await registerAdjustment(actor, {
      productId: found,
      quantity: "30",
      reason: "Existencia encontrada en bodega",
    });
    expect(await inGeneral(found)).toBe("30");
  });

  it("counts in presentations and other units, and keeps decimals exact", async () => {
    const tornillo = await stocked(actor, "100");
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "50",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    expect(
      await registerAdjustment(actor, {
        productId: tornillo,
        quantity: "3",
        presentationId: caja.presentationId,
        reason: "Conteo por cajas cerradas",
      }),
    ).toMatchObject({
      ok: true,
      summary: expect.stringContaining(
        "ahora hay 150 piezas (3 cajas × 50 = 150 piezas) (+50 piezas)",
      ),
    });

    const cable = await stocked(actor, "200", "m");
    await registerAdjustment(actor, {
      productId: cable,
      quantity: "197.25",
      reason: "Medición del rollo abierto",
    });
    expect(await inGeneral(cable)).toBe("197.25");
  });

  it("adjusts one location without touching the others", async () => {
    const tornillo = await stocked(actor, "100");
    const shelf = await createLocation(actor, {
      kind: "SHELF",
      name: `Estante ${++counter}`,
    });
    if (!shelf.ok) throw new Error("location setup failed");
    await registerEntry(actor, {
      productId: tornillo,
      locationId: shelf.locationId,
      quantity: "40",
    });
    await registerAdjustment(actor, {
      productId: tornillo,
      locationId: shelf.locationId,
      quantity: "38",
      reason: "Dos piezas dañadas",
    });
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [general]: "100",
      [shelf.locationId]: "38",
    });
  });
});

describe("the reason is mandatory", () => {
  it.each(["", "   ", "ok", "1234"])(
    "refuses the reason %j and changes nothing",
    async (reason) => {
      const tornillo = await stocked(actor, "100");
      expect(
        await registerAdjustment(actor, {
          productId: tornillo,
          quantity: "90",
          reason,
        }),
      ).toMatchObject({
        ok: false,
        reason: "invalid",
        fieldErrors: {
          reason: expect.stringContaining("Escribe el motivo del ajuste"),
        },
      });
      expect(await inGeneral(tornillo)).toBe("100");
    },
  );

  it("the database refuses an adjustment without a reason, even with SQL", async () => {
    for (const reason of [null, "", "abc"]) {
      await expect(
        db.$executeRaw`INSERT INTO stock_movement (id, organizationId, type, reason, createdByUserId) VALUES (${newId()}, ${actor.organizationId}, 'ADJUSTMENT', ${reason}, ${actor.userId})`,
      ).rejects.toThrow(/stock_movement_adjustment_reason_check/);
    }
  });
});

describe("the adjustment is audited", () => {
  it("records who, why, and the quantity before and counted", async () => {
    const owner = await company();
    const tornillo = await stocked(owner, "100");
    const result = await registerAdjustment(owner, {
      productId: tornillo,
      quantity: "95",
      reason: "  Merma por humedad  ",
    });
    if (!result.ok) throw new Error("expected ok");

    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: owner.organizationId,
        action: "inventory.adjusted",
      },
    });
    expect(event).toMatchObject({
      actorUserId: owner.userId,
      targetType: "product",
      targetId: tornillo,
      reason: "Merma por humedad",
      metadata: {
        producto: "Tornillo",
        ubicacion: "General",
        antes: "100 piezas",
        contado: "95 piezas",
        diferencia: "−5 piezas",
        movementId: result.movementId,
      },
    });
    const [entry] = await listAuditTrail(owner.organizationId);
    expect(entry).toMatchObject({
      label: "Ajustó existencias",
      actorName: "Doña Esperanza",
      reason: "Merma por humedad",
    });
  });

  it("a refused adjustment leaves no record", async () => {
    const owner = await company();
    const tornillo = await stocked(owner, "100");
    await registerAdjustment(owner, {
      productId: tornillo,
      quantity: "100",
      reason: REASON,
    });
    await registerAdjustment(owner, {
      productId: tornillo,
      quantity: "90",
      reason: "",
    });
    expect(
      await db.auditEvent.count({
        where: {
          organizationId: owner.organizationId,
          action: "inventory.adjusted",
        },
      }),
    ).toBe(0);
  });
});

describe("what an adjustment refuses", () => {
  it("the same quantity the system already has", async () => {
    const tornillo = await stocked(actor, "100");
    expect(
      await registerAdjustment(actor, {
        productId: tornillo,
        quantity: "100",
        reason: REASON,
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        quantity:
          "El sistema ya tiene 100 piezas en General: no hay nada que ajustar.",
      },
    });
  });

  it("negative counts, fractions of a piece and text", async () => {
    const tornillo = await stocked(actor, "100");
    for (const quantity of ["-5", "99.5", "noventa", ""]) {
      expect(
        await registerAdjustment(actor, {
          productId: tornillo,
          quantity,
          reason: REASON,
        }),
        quantity,
      ).toMatchObject({
        ok: false,
        fieldErrors: { quantity: expect.any(String) },
      });
    }
    expect(await inGeneral(tornillo)).toBe("100");
  });

  it("an archived product, and products of another company", async () => {
    const empty = await stocked(actor, "0");
    await archiveProduct(actor, empty);
    expect(
      await registerAdjustment(actor, {
        productId: empty,
        quantity: "5",
        reason: REASON,
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });

    const theirs = await company();
    const tornillo = await stocked(actor, "100");
    expect(
      await registerAdjustment(theirs, {
        productId: tornillo,
        quantity: "1",
        reason: REASON,
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await inGeneral(tornillo)).toBe("100");
  });

  it("people without the permission", async () => {
    const tornillo = await stocked(actor, "100");
    for (const role of ["buyer", "viewer"] as const) {
      const other = await member(actor.organizationId, role);
      await expect(
        registerAdjustment(other, {
          productId: tornillo,
          quantity: "1",
          reason: REASON,
        }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
    }
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      await registerAdjustment(warehouse, {
        productId: tornillo,
        quantity: "99",
        reason: REASON,
      }),
    ).toMatchObject({ ok: true });
  });
});

describe("adjustments at the same time", () => {
  it("several people counting at once end with the last count, never a mix", async () => {
    const tornillo = await stocked(actor, "100");
    const results = await Promise.all(
      ["90", "95", "80", "85"].map((quantity) =>
        registerAdjustment(actor, {
          productId: tornillo,
          quantity,
          reason: REASON,
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(["90", "95", "80", "85"]).toContain(await inGeneral(tornillo));
  });

  it("a retried adjustment with its key is applied once", async () => {
    const tornillo = await stocked(actor, "100");
    const request = {
      productId: tornillo,
      quantity: "95",
      reason: REASON,
      idempotencyKey: newId(),
    };
    const first = await registerAdjustment(actor, request);
    // Without the key the retry would be refused: «nothing to adjust».
    const retry = await registerAdjustment(actor, request);
    expect(first).toMatchObject({ ok: true });
    expect(retry).toMatchObject({ ok: true, repeated: true });
    expect(await inGeneral(tornillo)).toBe("95");
    expect(
      await db.auditEvent.count({
        where: { action: "inventory.adjusted", targetId: tornillo },
      }),
    ).toBe(1);
  });
});

describe("after all of it", () => {
  it("balances still match the history", async () => {
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
