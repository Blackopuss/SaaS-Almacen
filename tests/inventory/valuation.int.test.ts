import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { readSpreadsheet } from "@/platform/files";
import {
  applyCount,
  buildExport,
  getInventoryValue,
  getProductCost,
  captureCount,
  openCount,
  reconcileStock,
  reconcileValue,
  registerAdjustment,
  registerEntry,
  registerExit,
  registerInitialBalance,
  registerQuickExit,
  registerTransfer,
  reverseMovement,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// VAL-03 (ADR 0031): a cost typed in an entry or an initial balance moves
// the average cost, only for who may record costs; exits leave at the
// average.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `costos.${++counter}.${stamp}@example.test`,
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
      productLimit: 20,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de costos",
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

let skus = 0;
async function product(actor: InventoryActor) {
  const created = await createProduct(actor, {
    sku: `C-${++skus}`,
    name: `Martillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  return created.productId;
}

const costOf = async (productId: string) => {
  const row = await db.productCost.findFirst({ where: { productId } });
  return row
    ? `${row.averageCost.toFixed(2)} / ${row.stockValue.toFixed(2)}`
    : null;
};

const lineCosts = async (productId: string) =>
  (
    await db.stockMovementLine.findMany({
      where: { productId },
      // Ids (UUIDv7) are made in order; two lines can share a millisecond.
      orderBy: { id: "asc" },
      select: { direction: true, unitCost: true },
    })
  ).map((line) => `${line.direction} ${line.unitCost?.toFixed(2) ?? "-"}`);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("costs typed in entries", () => {
  it("move the average; entries without one and exits use it", async () => {
    const actor = await company();
    const martillo = await product(actor);
    expect(
      await registerInitialBalance(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "$85",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "95.00",
      }),
    ).toMatchObject({ ok: true });
    expect(await costOf(martillo)).toBe("90.00 / 1800.00");

    await registerEntry(actor, { productId: martillo, quantity: "5" });
    await registerExit(actor, { productId: martillo, quantity: "15" });
    expect(await costOf(martillo)).toBe("90.00 / 900.00");
    expect(await lineCosts(martillo)).toEqual([
      "IN 85.00",
      "IN 95.00",
      "IN 90.00",
      "OUT 90.00",
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("a cost per box is divided by its content", async () => {
    const actor = await company();
    const tornillo = await product(actor);
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "500",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "2",
      presentationId: caja.presentationId,
      unitCost: "450",
    });
    expect(await costOf(tornillo)).toBe("0.90 / 900.00");
  });

  it("only who may record costs types one; Almacén enters at the average", async () => {
    const actor = await company();
    const martillo = await product(actor);
    await registerEntry(actor, {
      productId: martillo,
      quantity: "2",
      unitCost: "50",
    });
    const almacen = await member(actor.organizationId, "warehouse");
    await expect(
      registerEntry(almacen, {
        productId: martillo,
        quantity: "1",
        unitCost: "1",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      await registerEntry(almacen, { productId: martillo, quantity: "2" }),
    ).toMatchObject({ ok: true });
    expect(await costOf(martillo)).toBe("50.00 / 200.00");

    const comprador = await member(actor.organizationId, "buyer");
    // The buyer may record costs but not register entries.
    await expect(
      registerEntry(comprador, {
        productId: martillo,
        quantity: "1",
        unitCost: "10",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses unreadable costs and costs on exits, writing nothing", async () => {
    const actor = await company();
    const martillo = await product(actor);
    expect(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "1",
        unitCost: "doce",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { unitCost: expect.any(String) },
    });
    expect(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "1",
        unitCost: "1.12345",
      }),
    ).toMatchObject({ ok: false });
    await registerEntry(actor, { productId: martillo, quantity: "3" });
    expect(
      await registerExit(actor, {
        productId: martillo,
        quantity: "1",
        unitCost: "5",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { unitCost: expect.any(String) },
    });
    expect(await lineCosts(martillo)).toEqual(["IN -"]);
    expect(await costOf(martillo)).toBeNull();
  });
});

// VAL-04: every movement keeps the value; the reconciliation checks it.
describe("every movement is valued", () => {
  const REASON = "Revisión de valor";
  const ok = <T extends { ok: boolean }>(result: T) => {
    if (!result.ok) throw new Error(JSON.stringify(result));
    return result as Extract<T, { ok: true }>;
  };

  it("relocations, adjustments, quick exits and counts", async () => {
    const actor = await company();
    const martillo = await product(actor);
    const clavo = await product(actor);
    const estante = await createLocation(actor, {
      kind: "SHELF",
      name: "Estante 1",
    });
    if (!estante.ok) throw new Error("location setup failed");
    ok(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "80",
      }),
    );
    ok(
      await registerEntry(actor, {
        productId: clavo,
        quantity: "100",
        unitCost: "0.5",
      }),
    );
    const general = await db.location.findFirstOrThrow({
      where: { organizationId: actor.organizationId, isDefault: true },
    });
    // Moving it to another place keeps its value.
    ok(
      await registerTransfer(actor, {
        productId: martillo,
        quantity: "4",
        locationId: general.id,
        toLocationId: estante.locationId,
      }),
    );
    expect(await costOf(martillo)).toBe("80.00 / 800.00");
    // Two missing in General: they go at the average.
    ok(
      await registerAdjustment(actor, {
        productId: martillo,
        quantity: "4",
        reason: REASON,
      }),
    );
    expect(await costOf(martillo)).toBe("80.00 / 640.00");
    ok(
      await registerQuickExit(actor, {
        lines: [
          { productId: martillo, quantity: "1" },
          { productId: clavo, quantity: "30" },
        ],
        reason: "Venta",
      }),
    );
    expect(await costOf(martillo)).toBe("80.00 / 560.00");
    expect(await costOf(clavo)).toBe("0.50 / 35.00");
    // A count finds 3 more nails in General: they come in at the average.
    const opened = await openCount(actor, { locationId: general.id });
    if (!opened.ok) throw new Error("count setup failed");
    ok(
      await captureCount(actor, {
        countId: opened.countId,
        productId: clavo,
        quantity: "73",
      }),
    );
    ok(await applyCount(actor, { countId: opened.countId, reason: REASON }));
    expect(await costOf(clavo)).toBe("0.50 / 36.50");
    expect(await lineCosts(martillo)).toEqual([
      "IN 80.00",
      "OUT 80.00",
      "IN 80.00",
      "OUT 80.00",
      "OUT 80.00",
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
    expect(await reconcileValue(actor.organizationId)).toEqual([]);
  });

  it("a reversal undoes at the cost it was done with", async () => {
    const actor = await company();
    const martillo = await product(actor);
    ok(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "85",
      }),
    );
    const second = ok(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "95",
      }),
    );
    expect(await costOf(martillo)).toBe("90.00 / 1800.00");
    ok(
      await reverseMovement(actor, {
        movementId: second.movementId,
        reason: REASON,
      }),
    );
    // The ten at $95 leave: back to $85.
    expect(await costOf(martillo)).toBe("85.00 / 850.00");
    const exit = ok(
      await registerExit(actor, { productId: martillo, quantity: "5" }),
    );
    ok(
      await reverseMovement(actor, {
        movementId: exit.movementId,
        reason: REASON,
      }),
    );
    expect(await costOf(martillo)).toBe("85.00 / 850.00");
    expect(await reconcileValue(actor.organizationId)).toEqual([]);
  });

  it("the reconciliation names a value that was changed by hand", async () => {
    const actor = await company();
    const martillo = await product(actor);
    ok(
      await registerEntry(actor, {
        productId: martillo,
        quantity: "10",
        unitCost: "10",
      }),
    );
    await db.productCost.updateMany({
      where: { productId: martillo },
      data: { stockValue: "120" },
    });
    expect(await reconcileValue(actor.organizationId)).toEqual([
      {
        productId: martillo,
        quantity: "10",
        averageCost: "10",
        stockValue: "120",
        expected: "100",
      },
    ]);
  });
});

// VAL-05 (NEG-04): the value exists only for who may see costs.
describe("who sees what the inventory is worth", () => {
  it("titular sees cost and value; Almacén and Consulta get nothing", async () => {
    const actor = await company();
    const martillo = await product(actor);
    const clavo = await product(actor);
    await registerEntry(actor, {
      productId: martillo,
      quantity: "10",
      unitCost: "85.5",
    });
    await registerEntry(actor, { productId: clavo, quantity: "3" });

    expect(await getProductCost(actor, martillo)).toEqual({
      averageCost: "$85.50",
      stockValue: "$855.00",
    });
    expect(await getProductCost(actor, clavo)).toBeNull();
    expect(await getInventoryValue(actor)).toEqual({
      total: "$855.00",
      withoutCost: 1,
    });

    for (const role of ["warehouse", "viewer"] as const) {
      const person = await member(actor.organizationId, role);
      await expect(getProductCost(person, martillo)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(getInventoryValue(person)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      // Its export of stock has no cost columns at all.
      const file = await buildExport(person, {
        kind: "existencias",
        format: "csv",
      });
      if (!file.ok) throw new Error("export failed");
      const sheet = readSpreadsheet("existencias.csv", file.bytes);
      if (!sheet.ok) throw new Error("export not readable");
      expect(sheet.rows[0]).toEqual([
        "Clave (SKU)",
        "Producto",
        "Ubicación",
        "Cantidad",
        "Unidad",
      ]);
    }

    const file = await buildExport(actor, {
      kind: "existencias",
      format: "csv",
    });
    if (!file.ok) throw new Error("export failed");
    const sheet = readSpreadsheet("existencias.csv", file.bytes);
    if (!sheet.ok) throw new Error("export not readable");
    expect(sheet.rows[0]).toEqual([
      "Clave (SKU)",
      "Producto",
      "Ubicación",
      "Cantidad",
      "Unidad",
      "Costo promedio",
      "Valor",
    ]);
    expect(
      sheet.rows
        .slice(1)
        .map((row) => row.slice(3))
        .sort((a, b) => b[0]!.localeCompare(a[0]!)),
    ).toEqual([
      // The reader drops empty cells at the end of a row.
      ["3", "pieza"],
      ["10", "pieza", "85.5", "855.00"],
    ]);
  });
});
