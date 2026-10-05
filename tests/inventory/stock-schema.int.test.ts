import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { reconcileStock } from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  changePresentationFactor,
  createPresentation,
  createProduct,
  updateProduct,
  type CatalogActor,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation, getDefaultLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

import { migratorConnection } from "../setup/test-db";

// INV-15: movements, lines and balances. A line keeps what was captured,
// the factor, the presentation version and the quantity in the product's
// unit; history never changes and the balance is the sum of the lines.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `existencias.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<CatalogActor> {
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
      productLimit: 50,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba del esquema de existencias",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

type Fixture = {
  actor: CatalogActor;
  /** Kept in pieces, with «Caja» = 100 pieces. */
  screws: string;
  box: { id: string; versionId: string };
  /** Kept in meters, in hundredths. */
  cable: string;
  general: string;
  shelf: string;
};

async function fixture(): Promise<Fixture> {
  const actor = await company();
  const screws = await createProduct(actor, {
    sku: `TOR-${++counter}`,
    name: "Tornillo",
  });
  const cable = await createProduct(actor, {
    sku: `CAB-${++counter}`,
    name: "Cable",
    unit: "m",
    step: "0.01",
  });
  if (!screws.ok || !cable.ok) throw new Error("product setup failed");
  const box = await createPresentation(actor, screws.productId, {
    name: "Caja",
    factor: "100",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  const version = await db.presentationVersion.findFirstOrThrow({
    where: { presentationId: box.presentationId },
  });
  const general = await getDefaultLocation(actor);
  const shelf = await createLocation(actor, { kind: "SHELF", name: "Estante" });
  if (!general || !shelf.ok) throw new Error("location setup failed");
  return {
    actor,
    screws: screws.productId,
    box: { id: box.presentationId, versionId: version.id },
    cable: cable.productId,
    general: general.id,
    shelf: shelf.locationId,
  };
}

/** A movement written directly, as the services of later steps will. */
async function movement(
  f: Fixture,
  data: Partial<{
    type: "ENTRY" | "EXIT" | "TRANSFER" | "ADJUSTMENT" | "INITIAL" | "REVERSAL";
    idempotencyKey: string;
    reversesMovementId: string;
    reason: string;
  }> = {},
) {
  const id = newId();
  await db.stockMovement.create({
    data: {
      id,
      organizationId: f.actor.organizationId,
      type: "ENTRY",
      createdByUserId: f.actor.userId,
      ...data,
    },
  });
  return id;
}

type LineData = {
  productId: string;
  locationId: string;
  direction?: "IN" | "OUT";
  capturedQuantity: string;
  factor?: string;
  baseQuantity: string;
  unitCode?: string;
  capturedUnitCode?: string;
  presentationId?: string;
  presentationVersionId?: string;
  lineNumber?: number;
};

function line(f: Fixture, movementId: string, data: LineData) {
  return db.stockMovementLine.create({
    data: {
      id: newId(),
      organizationId: f.actor.organizationId,
      movementId,
      lineNumber: 1,
      direction: "IN",
      factor: "1",
      unitCode: "piece",
      ...data,
    },
  });
}

let f: Fixture;
beforeAll(async () => {
  f = await fixture();
}, 60_000);

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("a movement line", () => {
  it("keeps the captured quantity, the factor, the version and the base quantity", async () => {
    const id = await movement(f, { reason: "Compra de mostrador" });
    // 25 pieces as they are; 3 boxes of 100; 275 cm of a cable kept in meters.
    await line(f, id, {
      lineNumber: 1,
      productId: f.screws,
      locationId: f.general,
      capturedQuantity: "25",
      baseQuantity: "25",
    });
    await line(f, id, {
      lineNumber: 2,
      productId: f.screws,
      locationId: f.shelf,
      capturedQuantity: "3",
      presentationId: f.box.id,
      presentationVersionId: f.box.versionId,
      factor: "100",
      baseQuantity: "300",
    });
    await line(f, id, {
      lineNumber: 3,
      productId: f.cable,
      locationId: f.general,
      capturedQuantity: "275",
      capturedUnitCode: "cm",
      factor: "0.01",
      baseQuantity: "2.75",
      unitCode: "m",
    });

    const stored = await forOrganization(
      f.actor.organizationId,
    ).stockMovement.findFirstOrThrow({
      where: { id },
      include: {
        lines: {
          orderBy: { lineNumber: "asc" },
          include: { presentationVersion: true, presentation: true },
        },
      },
    });
    expect(stored).toMatchObject({
      type: "ENTRY",
      reason: "Compra de mostrador",
      createdByUserId: f.actor.userId,
    });
    expect(
      stored.lines.map((l) => ({
        captured: l.capturedQuantity.toString(),
        unit: l.capturedUnitCode,
        presentation: l.presentation?.name ?? null,
        version: l.presentationVersion?.version ?? null,
        factor: l.factor.toString(),
        base: l.baseQuantity.toString(),
        in: l.unitCode,
      })),
    ).toEqual([
      {
        captured: "25",
        unit: null,
        presentation: null,
        version: null,
        factor: "1",
        base: "25",
        in: "piece",
      },
      {
        captured: "3",
        unit: null,
        presentation: "Caja",
        version: 1,
        factor: "100",
        base: "300",
        in: "piece",
      },
      {
        captured: "275",
        unit: "cm",
        presentation: null,
        version: null,
        factor: "0.01",
        base: "2.75",
        in: "m",
      },
    ]);
  });

  it("keeps its numbers when the presentation changes afterwards", async () => {
    const id = await movement(f);
    const stored = await line(f, id, {
      productId: f.screws,
      locationId: f.general,
      capturedQuantity: "3",
      presentationId: f.box.id,
      presentationVersionId: f.box.versionId,
      factor: "100",
      baseQuantity: "300",
    });
    const changed = await changePresentationFactor(f.actor, f.box.id, {
      factor: "120",
      reason: "El proveedor cambió la caja",
    });
    expect(changed.ok).toBe(true);
    const after = await db.stockMovementLine.findUniqueOrThrow({
      where: { id: stored.id },
      include: { presentationVersion: true },
    });
    expect(after.factor.toString()).toBe("100");
    expect(after.baseQuantity.toString()).toBe("300");
    expect(after.presentationVersion).toMatchObject({ version: 1 });
    expect(after.presentationVersion?.factor.toString()).toBe("100");
  });

  it("must satisfy base = captured × factor, with positive quantities", async () => {
    const id = await movement(f);
    const base = { productId: f.screws, locationId: f.general };
    const wrong: Partial<LineData>[] = [
      { capturedQuantity: "3", baseQuantity: "301" },
      { capturedQuantity: "0", baseQuantity: "0" },
      { capturedQuantity: "-5", baseQuantity: "-5" },
      { capturedQuantity: "5", baseQuantity: "5", lineNumber: 0 },
    ];
    for (const data of wrong) {
      await expect(
        line(f, id, { ...base, ...data } as LineData),
        JSON.stringify(data),
      ).rejects.toThrow(/stock_movement_line_quantities_check/);
    }
    // The factor of a box with a wrong result.
    await expect(
      line(f, id, {
        ...base,
        capturedQuantity: "3",
        presentationId: f.box.id,
        presentationVersionId: f.box.versionId,
        factor: "100",
        baseQuantity: "299",
      }),
    ).rejects.toThrow(/stock_movement_line_quantities_check/);
    // Exact decimals: 2.755 is not 275 × 0.01.
    await expect(
      line(f, id, {
        productId: f.cable,
        locationId: f.general,
        capturedQuantity: "275",
        capturedUnitCode: "cm",
        factor: "0.01",
        baseQuantity: "2.755",
        unitCode: "m",
      }),
    ).rejects.toThrow(/stock_movement_line_quantities_check/);
  });

  it("is captured in the unit, in a presentation with its version, or in another unit", async () => {
    const id = await movement(f);
    const base = {
      productId: f.screws,
      locationId: f.general,
      capturedQuantity: "2",
      baseQuantity: "200",
      factor: "100",
    };
    const wrong: Partial<LineData>[] = [
      // A factor without saying where it comes from.
      {},
      // A presentation without the version used, and the opposite.
      { presentationId: f.box.id },
      { presentationVersionId: f.box.versionId },
      // A presentation and another unit at once.
      {
        presentationId: f.box.id,
        presentationVersionId: f.box.versionId,
        capturedUnitCode: "dozen",
      },
    ];
    for (const data of wrong) {
      await expect(
        line(f, id, { ...base, ...data }),
        JSON.stringify(data),
      ).rejects.toThrow(/stock_movement_line_capture_check|foreign key/i);
    }
  });

  it("only accepts a presentation of its product and a version of that presentation", async () => {
    const id = await movement(f);
    const roll = await createPresentation(f.actor, f.cable, {
      name: "Rollo",
      factor: "100",
    });
    if (!roll.ok) throw new Error("presentation setup failed");
    const rollVersion = await db.presentationVersion.findFirstOrThrow({
      where: { presentationId: roll.presentationId },
    });
    const base = {
      productId: f.screws,
      locationId: f.general,
      capturedQuantity: "1",
      factor: "100",
      baseQuantity: "100",
    };
    // The roll belongs to the cable, not to the screws.
    await expect(
      line(f, id, {
        ...base,
        presentationId: roll.presentationId,
        presentationVersionId: rollVersion.id,
      }),
    ).rejects.toThrow(/foreign key/i);
    // The box of the screws with the version of the roll.
    await expect(
      line(f, id, {
        ...base,
        presentationId: f.box.id,
        presentationVersionId: rollVersion.id,
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it("carries the unit of its product", async () => {
    const id = await movement(f);
    await expect(
      line(f, id, {
        productId: f.cable,
        locationId: f.general,
        capturedQuantity: "5",
        baseQuantity: "5",
        unitCode: "piece",
      }),
    ).rejects.toThrow(/unitCode is not the unit of the product/);
  });

  it("numbers its lines once per movement", async () => {
    const id = await movement(f);
    const data = {
      productId: f.screws,
      locationId: f.general,
      capturedQuantity: "1",
      baseQuantity: "1",
    };
    await line(f, id, data);
    await expect(line(f, id, data)).rejects.toThrow(/Unique constraint/);
    await expect(line(f, id, { ...data, lineNumber: 2 })).resolves.toBeTruthy();
  });
});

describe("confirmed movements never change", () => {
  it("cannot be edited or deleted, not even with direct SQL", async () => {
    const id = await movement(f, { reason: "Original" });
    const stored = await line(f, id, {
      productId: f.screws,
      locationId: f.general,
      capturedQuantity: "10",
      baseQuantity: "10",
    });
    const connection = await migratorConnection();
    try {
      for (const [statement, value] of [
        ["UPDATE stock_movement SET reason = 'Otro' WHERE id = ?", id],
        ["UPDATE stock_movement SET createdByUserId = ? WHERE id = ?", id],
        ["DELETE FROM stock_movement WHERE id = ?", id],
      ] as const) {
        await expect(
          connection.query(
            statement,
            statement.includes("createdByUserId") ? [newId(), value] : [value],
          ),
          statement,
        ).rejects.toThrow(/stock_movement is immutable/);
      }
      for (const statement of [
        "UPDATE stock_movement_line SET baseQuantity = 99, capturedQuantity = 99 WHERE id = ?",
        "UPDATE stock_movement_line SET direction = 'OUT' WHERE id = ?",
        "DELETE FROM stock_movement_line WHERE id = ?",
      ]) {
        await expect(
          connection.query(statement, [stored.id]),
          statement,
        ).rejects.toThrow(/stock_movement_line is immutable/);
      }
    } finally {
      await connection.end();
    }
    await expect(
      db.stockMovement.update({ where: { id }, data: { reason: "Otro" } }),
    ).rejects.toThrow(/immutable/);
    expect(
      await db.stockMovement.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({ reason: "Original" });
  });

  it("a reversal names the movement it undoes, once", async () => {
    const original = await movement(f);
    // Only a reversal points to another movement, and it must.
    await expect(
      movement(f, { type: "ENTRY", reversesMovementId: original }),
    ).rejects.toThrow(/stock_movement_reversal_check/);
    await expect(movement(f, { type: "REVERSAL" })).rejects.toThrow(
      /stock_movement_reversal_check/,
    );
    await movement(f, { type: "REVERSAL", reversesMovementId: original });
    await expect(
      movement(f, { type: "REVERSAL", reversesMovementId: original }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      movement(f, { type: "REVERSAL", reversesMovementId: newId() }),
    ).rejects.toThrow(/Foreign key/i);
  });

  it("a confirmation key identifies one movement in the company", async () => {
    const other = await fixture();
    const key = `clave-${newId()}`;
    await movement(f, { idempotencyKey: key });
    await expect(movement(f, { idempotencyKey: key })).rejects.toThrow(
      /Unique constraint/,
    );
    // Another company may use the same key; movements without key repeat.
    await expect(
      movement(other, { idempotencyKey: key }),
    ).resolves.toBeTruthy();
    await movement(f);
    await movement(f);
  });
});

describe("balances", () => {
  it("there is one per product and location, never negative", async () => {
    const own = await fixture();
    const data = {
      organizationId: own.actor.organizationId,
      productId: own.screws,
      locationId: own.general,
    };
    const balance = await db.stockBalance.create({
      data: { id: newId(), ...data, quantity: "275" },
    });
    await expect(
      db.stockBalance.create({ data: { id: newId(), ...data, quantity: "1" } }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      db.stockBalance.create({
        data: { id: newId(), ...data, locationId: own.shelf, quantity: "-1" },
      }),
    ).rejects.toThrow(/stock_balance_quantity_check/);
    // An update that would leave it below zero is refused by the database:
    // the last defense against two exits at once.
    await expect(
      db.stockBalance.update({
        where: { id: balance.id },
        data: { quantity: { decrement: "275.001" } },
      }),
    ).rejects.toThrow(/stock_balance_quantity_check/);
    await db.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: { decrement: "275" } },
    });
    expect(
      (
        await db.stockBalance.findUniqueOrThrow({ where: { id: balance.id } })
      ).quantity.toString(),
    ).toBe("0");
  });

  it("are the sum of the lines: the reconciliation finds any difference", async () => {
    const own = await fixture();
    const org = own.actor.organizationId;
    const entry = await movement(own);
    await line(own, entry, {
      productId: own.screws,
      locationId: own.general,
      capturedQuantity: "3",
      presentationId: own.box.id,
      presentationVersionId: own.box.versionId,
      factor: "100",
      baseQuantity: "300",
    });
    const exit = await movement(own, { type: "EXIT" });
    await line(own, exit, {
      productId: own.screws,
      locationId: own.general,
      direction: "OUT",
      capturedQuantity: "25",
      baseQuantity: "25",
    });
    // Lines without their balance: the difference shows.
    expect(await reconcileStock(org)).toEqual([
      {
        productId: own.screws,
        locationId: own.general,
        fromMovements: "275",
        balance: "0",
      },
    ]);
    const balance = await db.stockBalance.create({
      data: {
        id: newId(),
        organizationId: org,
        productId: own.screws,
        locationId: own.general,
        quantity: "275",
      },
    });
    expect(await reconcileStock(org)).toEqual([]);
    // A balance edited by hand is caught.
    await db.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: "270" },
    });
    expect(await reconcileStock(org)).toEqual([
      {
        productId: own.screws,
        locationId: own.general,
        fromMovements: "275",
        balance: "270",
      },
    ]);
    // A balance nobody moved is caught too.
    await db.stockBalance.update({
      where: { id: balance.id },
      data: { quantity: "275" },
    });
    await db.stockBalance.create({
      data: {
        id: newId(),
        organizationId: org,
        productId: own.cable,
        locationId: own.shelf,
        quantity: "1.5",
      },
    });
    expect(await reconcileStock(org)).toEqual([
      {
        productId: own.cable,
        locationId: own.shelf,
        fromMovements: "0",
        balance: "1.5",
      },
    ]);
    // Other companies are not part of this one's check.
    expect(await reconcileStock(f.actor.organizationId)).not.toContainEqual(
      expect.objectContaining({ productId: own.cable }),
    );
  });
});

describe("stock of one company", () => {
  it("cannot mix products, locations or movements of another company", async () => {
    const mine = await fixture();
    const theirs = await fixture();
    const id = await movement(mine);
    const data = {
      productId: mine.screws,
      locationId: mine.general,
      capturedQuantity: "1",
      baseQuantity: "1",
    };
    for (const foreign of [
      { productId: theirs.screws },
      { locationId: theirs.general },
    ]) {
      await expect(
        line(mine, id, { ...data, ...foreign }),
        JSON.stringify(Object.keys(foreign)),
      ).rejects.toThrow(/foreign key|unitCode/i);
      await expect(
        db.stockBalance.create({
          data: {
            id: newId(),
            organizationId: mine.actor.organizationId,
            productId: mine.screws,
            locationId: mine.general,
            quantity: "1",
            ...foreign,
          },
        }),
      ).rejects.toThrow(/foreign key/i);
    }
    // A line of this company in a movement of the other.
    const theirMovement = await movement(theirs);
    await expect(line(mine, theirMovement, data)).rejects.toThrow(
      /foreign key/i,
    );
    await line(mine, id, data);
    // The scoped client of the other company sees none of it.
    const client = forOrganization(theirs.actor.organizationId);
    expect(await client.stockMovement.findFirst({ where: { id } })).toBeNull();
    expect(
      await client.stockMovementLine.count({ where: { movementId: id } }),
    ).toBe(0);
  });
});

describe("the unit of a product after its first movement", () => {
  it("can change freely before, and is fixed afterwards", async () => {
    const own = await fixture();
    const card = {
      sku: "FIJO-1",
      name: "Manguera",
      unit: "m",
      step: "0.1",
    };
    const created = await createProduct(own.actor, card);
    if (!created.ok) throw new Error("product setup failed");
    const id = created.productId;
    // No movements yet: the unit is still a decision.
    expect(
      await updateProduct(own.actor, id, { ...card, unit: "cm", step: "1" }),
    ).toMatchObject({ ok: true });
    expect(await updateProduct(own.actor, id, card)).toMatchObject({
      ok: true,
    });

    const entry = await movement(own);
    await line(own, entry, {
      productId: id,
      locationId: own.general,
      capturedQuantity: "12.5",
      baseQuantity: "12.5",
      unitCode: "m",
    });

    expect(
      await updateProduct(own.actor, id, { ...card, unit: "cm", step: "1" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        unit: "Este producto ya tiene movimientos: su unidad ya no se puede cambiar.",
      },
    });
    // The precision may become finer, never coarser.
    expect(
      await updateProduct(own.actor, id, { ...card, step: "1" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        step: "Este producto ya tiene movimientos: su precisión solo puede hacerse más fina (por ejemplo, de 0.1 a 0.01).",
      },
    });
    expect(
      await updateProduct(own.actor, id, { ...card, step: "0.01" }),
    ).toMatchObject({ ok: true });
    // The rest of the card is still editable.
    expect(
      await updateProduct(own.actor, id, {
        ...card,
        step: "0.01",
        name: "Manguera reforzada",
      }),
    ).toMatchObject({ ok: true });
    // And the database refuses the unit change by itself.
    await expect(
      db.product.update({ where: { id }, data: { unitCode: "cm" } }),
    ).rejects.toThrow(/the unit cannot change after the first movement/);
    expect(await db.product.findUniqueOrThrow({ where: { id } })).toMatchObject(
      { unitCode: "m", name: "Manguera reforzada" },
    );
  });
});
