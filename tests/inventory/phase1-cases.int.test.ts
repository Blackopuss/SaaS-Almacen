import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getProductStock,
  getStockByLocation,
  getStockTotals,
  listMovements,
  reconcileCompany,
  reconcileStock,
  registerEntry,
  registerExit,
  registerTransfer,
  reverseMovement,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-34: the acceptance cases of phase 1 (docs/FASE_01_DEFINICION.md),
// end to end, each one leaving balances that agree with their history;
// and the reconciliation that would tell if they did not.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function company(): Promise<InventoryActor> {
  const newUser = async () => {
    const user = await db.user.create({
      data: {
        id: newId(),
        name: "Persona",
        email: `fase1.${++counter}.${stamp}@example.test`,
        emailVerified: true,
      },
    });
    return user.id;
  };
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
      reason: "Casos de la fase 1",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function product(owner: InventoryActor, sku: string, unit?: string) {
  const result = await createProduct(owner, {
    sku,
    name: `Producto ${sku}`,
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function shelf(owner: InventoryActor, name: string) {
  const result = await createLocation(owner, { kind: "SHELF", name });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

async function done<T extends { ok: boolean }>(promise: Promise<T>) {
  const result = await promise;
  if (!result.ok) throw new Error(`step failed: ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

const total = async (owner: InventoryActor, productId: string) =>
  (await getStockTotals(owner, [productId]))[productId] ?? "0";

/** Balances agree with the history, by both ways of asking. */
async function expectReconciled(owner: InventoryActor) {
  expect(await reconcileStock(owner.organizationId)).toEqual([]);
  expect((await reconcileCompany(owner.organizationId)).drift).toEqual([]);
}

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
}, 60_000);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("INV: stock by location", () => {
  let tornillo = "";
  let a = "";
  let b = "";

  it("INV-01: 120 in A and 80 in B make 200, with the breakdown", async () => {
    tornillo = await product(actor, "TOR-001");
    a = await shelf(actor, "Estante A");
    b = await shelf(actor, "Estante B");
    await done(
      registerEntry(actor, {
        productId: tornillo,
        locationId: a,
        quantity: "120",
      }),
    );
    await done(
      registerEntry(actor, {
        productId: tornillo,
        locationId: b,
        quantity: "80",
      }),
    );
    const stock = await getProductStock(actor, tornillo);
    expect(stock).toMatchObject({ total: "200", totalLabel: "200 piezas" });
    expect(
      stock!.locations.map((location) => [location.path, location.quantity]),
    ).toEqual([
      ["Estante A", "120"],
      ["Estante B", "80"],
    ]);
    await expectReconciled(actor);
  });

  it("INV-02: moving 20 from A to B leaves 100 and 100; still 200", async () => {
    await done(
      registerTransfer(actor, {
        productId: tornillo,
        locationId: a,
        toLocationId: b,
        quantity: "20",
      }),
    );
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "100",
      [b]: "100",
    });
    expect(await total(actor, tornillo)).toBe("200");
    await expectReconciled(actor);
  });

  it("INV-03: taking 15 from A afterwards leaves 85 and 100; 185", async () => {
    await done(
      registerExit(actor, {
        productId: tornillo,
        locationId: a,
        quantity: "15",
      }),
    );
    expect(await getStockByLocation(actor, tornillo)).toEqual({
      [a]: "85",
      [b]: "100",
    });
    expect(await total(actor, tornillo)).toBe("185");
    await expectReconciled(actor);
  });
});

describe("UNI: units and presentations", () => {
  let tornillo = "";
  let caja = "";
  let firstEntry = "";

  it("UNI-01: 3 boxes of 100 into a product without stock are 300 pieces", async () => {
    tornillo = await product(actor, "TOR-002");
    const created = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!created.ok) throw new Error("presentation setup failed");
    caja = created.presentationId;
    expect(await total(actor, tornillo)).toBe("0");
    const entry = await done(
      registerEntry(actor, {
        productId: tornillo,
        quantity: "3",
        presentationId: caja,
      }),
    );
    firstEntry = entry.movementId;
    expect(await total(actor, tornillo)).toBe("300");
    // What was captured and the factor are kept as they were.
    const line = await db.stockMovementLine.findFirstOrThrow({
      where: { movementId: firstEntry },
    });
    expect(line.capturedQuantity.toString()).toBe("3");
    expect(line.factor.toString()).toBe("100");
    expect(line.baseQuantity.toString()).toBe("300");
    expect(line.presentationId).toBe(caja);
    expect(line.presentationVersionId).toBeTruthy();
    await expectReconciled(actor);
  });

  it("UNI-02: take 25, change the box to 120, enter one box: 395; the first entry is still 300", async () => {
    await done(registerExit(actor, { productId: tornillo, quantity: "25" }));
    expect(await total(actor, tornillo)).toBe("275");
    const changed = await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "El proveedor cambió el empaque",
    });
    expect(changed.ok).toBe(true);
    await done(
      registerEntry(actor, {
        productId: tornillo,
        quantity: "1",
        presentationId: caja,
      }),
    );
    expect(await total(actor, tornillo)).toBe("395");
    const original = await db.stockMovementLine.findFirstOrThrow({
      where: { movementId: firstEntry },
    });
    expect(original.factor.toString()).toBe("100");
    expect(original.baseQuantity.toString()).toBe("300");
    await expectReconciled(actor);
  });

  it("UNI-03: 200 m of cable minus 2.75 m are exactly 197.25 m", async () => {
    const cable = await product(actor, "CAB-001", "m");
    await done(registerEntry(actor, { productId: cable, quantity: "200" }));
    await done(registerExit(actor, { productId: cable, quantity: "2.75" }));
    expect(await total(actor, cable)).toBe("197.25");
    expect((await getProductStock(actor, cable))!.totalLabel).toBe(
      "197.25 metros",
    );
    await expectReconciled(actor);
  });

  it("UNI-04: 0.5 pieces, or a factor of zero or less, are refused and change nothing", async () => {
    const tuerca = await product(actor, "TUE-001");
    await done(registerEntry(actor, { productId: tuerca, quantity: "10" }));
    const movements = (await listMovements(actor)).total;
    for (const quantity of ["0.5", "0", "-1"]) {
      expect(
        (await registerEntry(actor, { productId: tuerca, quantity })).ok,
      ).toBe(false);
      expect(
        (await registerExit(actor, { productId: tuerca, quantity })).ok,
      ).toBe(false);
    }
    for (const factor of ["0", "-5", "0.0"]) {
      expect(
        (
          await createPresentation(actor, tuerca, {
            name: `Bolsa ${factor}`,
            factor,
          })
        ).ok,
      ).toBe(false);
    }
    expect(await total(actor, tuerca)).toBe("10");
    expect((await listMovements(actor)).total).toBe(movements);
    expect(
      await db.productPresentation.count({ where: { productId: tuerca } }),
    ).toBe(0);
    await expectReconciled(actor);
  });
});

describe("MOV: movements", () => {
  it("MOV-01: an exit larger than the location's balance is refused even with stock on another shelf", async () => {
    const martillo = await product(actor, "MAR-001");
    const a = await shelf(actor, "Estante C");
    const b = await shelf(actor, "Estante D");
    await done(
      registerEntry(actor, {
        productId: martillo,
        locationId: a,
        quantity: "5",
      }),
    );
    await done(
      registerEntry(actor, {
        productId: martillo,
        locationId: b,
        quantity: "50",
      }),
    );
    const refused = await registerExit(actor, {
      productId: martillo,
      locationId: a,
      quantity: "6",
    });
    expect(refused).toMatchObject({ ok: false, reason: "invalid" });
    expect(await getStockByLocation(actor, martillo)).toEqual({
      [a]: "5",
      [b]: "50",
    });
    await expectReconciled(actor);
  });

  it("MOV-02: retrying the same confirmation gives one movement and one change", async () => {
    const pinza = await product(actor, "PIN-001");
    await done(registerEntry(actor, { productId: pinza, quantity: "20" }));
    const confirmation = {
      productId: pinza,
      quantity: "4",
      idempotencyKey: newId(),
    };
    const before = (await listMovements(actor, { productId: pinza })).total;
    const results = await Promise.all([
      registerExit(actor, confirmation),
      registerExit(actor, confirmation),
      registerExit(actor, confirmation),
    ]);
    const again = await registerExit(actor, confirmation);
    const ids = [...results, again].map((result) =>
      result.ok ? result.movementId : null,
    );
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBeTruthy();
    expect((await listMovements(actor, { productId: pinza })).total).toBe(
      before + 1,
    );
    expect(await total(actor, pinza)).toBe("16");
    await expectReconciled(actor);
  }, 60_000);

  it("MOV-03: a confirmed movement is corrected with a traceable reversal; history is not edited", async () => {
    const taladro = await product(actor, "TAL-001");
    const created = await createPresentation(actor, taladro, {
      name: "Caja",
      factor: "10",
    });
    if (!created.ok) throw new Error("presentation setup failed");
    const entry = await done(
      registerEntry(actor, {
        productId: taladro,
        quantity: "2",
        presentationId: created.presentationId,
      }),
    );
    // The box changes afterwards: the reversal must not use the new content.
    await changePresentationFactor(actor, created.presentationId, {
      factor: "12",
      reason: "Empaque nuevo",
    });
    const reversal = await done(
      reverseMovement(actor, {
        movementId: entry.movementId,
        reason: "Se capturó en el producto equivocado",
      }),
    );
    expect(await total(actor, taladro)).toBe("0");

    const [original, undone] = await Promise.all(
      [entry.movementId, reversal.movementId].map((id) =>
        db.stockMovement.findUniqueOrThrow({
          where: { id },
          include: { lines: true },
        }),
      ),
    );
    // Both stay in the history, linked, with the original equivalence.
    expect(undone).toMatchObject({
      type: "REVERSAL",
      reversesMovementId: original!.id,
      reason: "Se capturó en el producto equivocado",
    });
    expect(original!.lines[0]!.baseQuantity.toString()).toBe("20");
    expect(undone!.lines[0]).toMatchObject({ direction: "OUT" });
    expect(undone!.lines[0]!.factor.toString()).toBe("10");
    expect(undone!.lines[0]!.baseQuantity.toString()).toBe("20");
    // The application cannot rewrite what happened.
    await expect(
      db.stockMovementLine.updateMany({
        where: { movementId: original!.id },
        data: { baseQuantity: "1" },
      }),
    ).rejects.toThrow();
    await expect(
      db.stockMovement.deleteMany({ where: { id: original!.id } }),
    ).rejects.toThrow();
    await expectReconciled(actor);
  });
});

describe("the reconciliation task", () => {
  it("names the product and location whose balance left its history", async () => {
    const owner = await company();
    const sano = await product(owner, "SAN-001");
    const roto = await product(owner, "ROT-001");
    await done(registerEntry(owner, { productId: sano, quantity: "10" }));
    await done(registerEntry(owner, { productId: roto, quantity: "10" }));
    expect(await reconcileCompany(owner.organizationId)).toEqual({
      organizationId: owner.organizationId,
      pairs: 2,
      drift: [],
    });

    // A balance changed without a movement: the defect this task exists for.
    await db.stockBalance.updateMany({
      where: { productId: roto },
      data: { quantity: "13" },
    });
    const report = await reconcileCompany(owner.organizationId);
    expect(report.pairs).toBe(2);
    expect(report.drift).toEqual([
      expect.objectContaining({
        productId: roto,
        sku: "ROT-001",
        productName: "Producto ROT-001",
        locationName: "General",
        balance: "13",
        fromMovements: "10",
        difference: "3",
      }),
    ]);
    // It only reads: the difference is still there to be investigated.
    expect((await reconcileCompany(owner.organizationId)).drift).toHaveLength(
      1,
    );

    // Another company is not touched by this one's defect.
    expect((await reconcileCompany(actor.organizationId)).drift).toEqual([]);

    await db.stockBalance.updateMany({
      where: { productId: roto },
      data: { quantity: "10" },
    });
    expect((await reconcileCompany(owner.organizationId)).drift).toEqual([]);
  });
});
