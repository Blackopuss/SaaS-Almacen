import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getStockByLocation,
  getStockTotals,
  listRecentMovements,
  listStockLocations,
  reconcileStock,
  registerEntry,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import {
  archiveLocation,
  createLocation,
  getDefaultLocation,
} from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

import { migratorConnection } from "../setup/test-db";

// INV-16: a simple entry in the product's unit. The movement and the
// balance are written in the same transaction.
// INV-17: an entry captured in a presentation or in another unit.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  const user = await db.user.create({
    data: {
      id: newId(),
      name,
      email: `entradas.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<InventoryActor> {
  const owner = await newUser("Olga Titular");
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
      reason: "Prueba de entradas",
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

async function product(
  actor: InventoryActor,
  card: { name: string; unit?: string; step?: string },
) {
  const result = await createProduct(actor, { sku: `P-${++counter}`, ...card });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function shelf(actor: InventoryActor, name: string, parentId?: string) {
  const result = await createLocation(actor, { kind: "SHELF", name, parentId });
  if (!result.ok) throw new Error("location setup failed");
  return result.locationId;
}

const generalOf = async (actor: InventoryActor) =>
  (await getDefaultLocation(actor))?.id ?? "";

/** Movements, lines and balances of a product, as plain text. */
async function stored(actor: InventoryActor, productId: string) {
  const client = forOrganization(actor.organizationId);
  const [lines, balances] = await Promise.all([
    client.stockMovementLine.findMany({
      where: { productId },
      orderBy: { id: "asc" },
      include: { movement: true },
    }),
    client.stockBalance.findMany({ where: { productId } }),
  ]);
  return {
    lines: lines.map((l) => ({
      type: l.movement.type,
      direction: l.direction,
      captured: l.capturedQuantity.toString(),
      factor: l.factor.toString(),
      base: l.baseQuantity.toString(),
      unit: l.unitCode,
      locationId: l.locationId,
    })),
    balances: Object.fromEntries(
      balances.map((b) => [b.locationId, b.quantity.toString()]),
    ),
  };
}

let actor: InventoryActor;
let general = "";
beforeAll(async () => {
  actor = await company();
  general = await generalOf(actor);
}, 60_000);

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("registerEntry", () => {
  it("writes the movement, its line and the balance together", async () => {
    const screws = await product(actor, { name: "Tornillo" });
    const first = await registerEntry(actor, {
      productId: screws,
      quantity: "25",
      reference: "Remisión 118",
      reason: "Compra de mostrador",
    });
    expect(first).toMatchObject({
      ok: true,
      summary:
        "Entraron 25 piezas de Tornillo a General. Ahora hay 25 piezas ahí.",
    });
    // Without a location it goes to General.
    expect(await stored(actor, screws)).toEqual({
      lines: [
        {
          type: "ENTRY",
          direction: "IN",
          captured: "25",
          factor: "1",
          base: "25",
          unit: "piece",
          locationId: general,
        },
      ],
      balances: { [general]: "25" },
    });
    if (!first.ok) throw new Error("entry failed");
    expect(
      await db.stockMovement.findUniqueOrThrow({
        where: { id: first.movementId },
      }),
    ).toMatchObject({
      type: "ENTRY",
      createdByUserId: actor.userId,
      reference: "Remisión 118",
      reason: "Compra de mostrador",
    });

    // The next entry adds to the same balance.
    expect(
      await registerEntry(actor, { productId: screws, quantity: "1,300" }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 1,300 piezas de Tornillo a General. Ahora hay 1,325 piezas ahí.",
    });
    expect((await stored(actor, screws)).balances).toEqual({
      [general]: "1325",
    });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("keeps a balance per location and the product's total is their sum", async () => {
    const screws = await product(actor, { name: "Pija" });
    const a = await shelf(actor, "Estante A");
    await registerEntry(actor, { productId: screws, quantity: "40" });
    expect(
      await registerEntry(actor, {
        productId: screws,
        locationId: a,
        quantity: "1",
      }),
    ).toMatchObject({
      ok: true,
      summary: "Entró 1 pieza de Pija a Estante A. Ahora hay 1 pieza ahí.",
    });
    await registerEntry(actor, {
      productId: screws,
      locationId: a,
      quantity: "9",
    });
    expect(await getStockByLocation(actor, screws)).toEqual({
      [general]: "40",
      [a]: "10",
    });
    const other = await product(actor, { name: "Sin existencias" });
    expect(await getStockTotals(actor, [screws, other, newId()])).toEqual({
      [screws]: "50",
    });
    expect(await getStockTotals(actor, [])).toEqual({});
  });

  it("accepts the decimals the product allows and never rounds", async () => {
    const cable = await product(actor, {
      name: "Cable",
      unit: "m",
      step: "0.01",
    });
    expect(
      await registerEntry(actor, { productId: cable, quantity: "2.75" }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 2.75 metros de Cable a General. Ahora hay 2.75 metros ahí.",
    });
    await registerEntry(actor, { productId: cable, quantity: "197.25" });
    expect((await stored(actor, cable)).balances).toEqual({ [general]: "200" });
    const pieces = await product(actor, { name: "Arandela" });
    for (const [productId, quantity] of [
      [cable, "2.755"],
      [cable, "0"],
      [cable, "-3"],
      [cable, "dos"],
      [cable, "1e3"],
      [cable, "9999999999"],
      [pieces, "0.5"],
      [pieces, "2.0001"],
    ] as const) {
      const result = await registerEntry(actor, { productId, quantity });
      expect(result, quantity).toMatchObject({ ok: false, reason: "invalid" });
      expect(!result.ok && result.fieldErrors.quantity, quantity).toBeTruthy();
    }
    expect(
      await registerEntry(actor, { productId: pieces, quantity: " " }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { quantity: "Escribe la cantidad que entra." },
    });
    // Nothing of the refused entries was written.
    expect((await stored(actor, cable)).lines).toHaveLength(2);
    expect(await stored(actor, pieces)).toEqual({ lines: [], balances: {} });
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("validates the reference and the note", async () => {
    const productId = await product(actor, { name: "Clavo" });
    expect(
      await registerEntry(actor, {
        productId,
        quantity: "1",
        reference: "x".repeat(121),
        reason: "y".repeat(501),
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: {
        reference: "La referencia es demasiado larga (máximo 120 caracteres).",
        reason: "La nota es demasiado larga (máximo 500 caracteres).",
      },
    });
    expect(
      await registerEntry(actor, {
        productId,
        quantity: "1",
        reference: "Factura\n123",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { reference: "Quita los saltos de línea o tabuladores." },
    });
    // Empty optional texts are stored as nothing.
    const result = await registerEntry(actor, {
      productId,
      quantity: "1",
      reference: "  ",
      reason: "",
    });
    if (!result.ok) throw new Error("entry failed");
    expect(
      await db.stockMovement.findUniqueOrThrow({
        where: { id: result.movementId },
      }),
    ).toMatchObject({ reference: null, reason: null });
  });

  it("refuses archived or missing products and locations, writing nothing", async () => {
    const archived = await product(actor, { name: "Descontinuado" });
    await archiveProduct(actor, archived);
    const productId = await product(actor, { name: "Vigente" });
    const closed = await shelf(actor, "Estante cerrado");
    await archiveLocation(actor, closed);
    const cases: [object, object][] = [
      [
        { productId: archived },
        {
          reason: "not_allowed",
          fieldErrors: {
            productId:
              "Este producto está archivado. Reactívalo para registrar entradas.",
          },
        },
      ],
      [
        { productId: newId() },
        {
          reason: "not_found",
          fieldErrors: { productId: "Este producto ya no existe." },
        },
      ],
      [
        { productId: "" },
        { reason: "invalid", fieldErrors: { productId: "Elige un producto." } },
      ],
      [
        { productId, locationId: closed },
        {
          reason: "not_allowed",
          fieldErrors: {
            locationId:
              "«Estante cerrado» está archivada. Elige otra ubicación.",
          },
        },
      ],
      [
        { productId, locationId: newId() },
        {
          reason: "not_found",
          fieldErrors: {
            locationId: "Esa ubicación ya no existe. Elige otra.",
          },
        },
      ],
    ];
    const before = await db.stockMovement.count({
      where: { organizationId: actor.organizationId },
    });
    for (const [input, expected] of cases) {
      expect(
        await registerEntry(actor, {
          productId: "",
          quantity: "5",
          ...input,
        }),
        JSON.stringify(input),
      ).toMatchObject({ ok: false, ...expected });
    }
    expect(
      await db.stockMovement.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(before);
    expect(await stored(actor, productId)).toEqual({ lines: [], balances: {} });
  });

  it("if the balance cannot be written, the movement is not written either", async () => {
    const own = await company();
    const productId = await product(own, { name: "Atómico" });
    const connection = await migratorConnection();
    try {
      // The database refuses balances of this company only.
      await connection.query(
        `CREATE TRIGGER test_balance_fails BEFORE INSERT ON stock_balance FOR EACH ROW
         BEGIN
           IF NEW.organizationId = '${own.organizationId}' THEN
             SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'test: balance refused';
           END IF;
         END`,
      );
      await expect(
        registerEntry(own, { productId, quantity: "5" }),
      ).rejects.toThrow(/balance refused/);
    } finally {
      await connection.query("DROP TRIGGER IF EXISTS test_balance_fails");
      await connection.end();
    }
    expect(await stored(own, productId)).toEqual({ lines: [], balances: {} });
    expect(
      await db.stockMovement.count({
        where: { organizationId: own.organizationId },
      }),
    ).toBe(0);
    // Without the obstacle the same entry works.
    expect((await registerEntry(own, { productId, quantity: "5" })).ok).toBe(
      true,
    );
    expect(await reconcileStock(own.organizationId)).toEqual([]);
  });

  it("simultaneous entries are all counted, also the very first ones", async () => {
    const own = await company();
    const productId = await product(own, { name: "Concurrido" });
    const a = await shelf(own, "Estante A");
    const mainLocation = await generalOf(own);
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        registerEntry(own, {
          productId,
          locationId: i % 3 === 0 ? a : undefined,
          quantity: String(i + 1),
        }),
      ),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    // 1 + 2 + … + 24 = 300; every third one (1, 4, …, 22) went to the shelf.
    expect(await getStockByLocation(own, productId)).toEqual({
      [mainLocation]: "208",
      [a]: "92",
    });
    expect((await stored(own, productId)).lines).toHaveLength(24);
    expect(await reconcileStock(own.organizationId)).toEqual([]);
  }, 30_000);
});

describe("who can register entries", () => {
  it("Almacén and Administrador can; Comprador and Consulta cannot", async () => {
    const owner = await company();
    const productId = await product(owner, { name: "Tuerca" });
    for (const role of ["warehouse", "administrator"] as const) {
      const person = await member(owner.organizationId, role);
      expect(
        (await registerEntry(person, { productId, quantity: "10" })).ok,
        role,
      ).toBe(true);
    }
    for (const role of ["buyer", "viewer"] as const) {
      const person = await member(owner.organizationId, role);
      await expect(
        registerEntry(person, { productId, quantity: "10" }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
      // They can look at stock and history.
      expect(await getStockTotals(person, [productId])).toEqual({
        [productId]: "20",
      });
      expect(await listRecentMovements(person)).toHaveLength(2);
    }
  });

  it("with the plan expired stock is seen but nothing enters", async () => {
    const own = await company();
    const productId = await product(own, { name: "Rondana" });
    await registerEntry(own, { productId, quantity: "7" });
    await db.entitlement.updateMany({
      where: { organizationId: own.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(own.organizationId);
    await expect(
      registerEntry(own, { productId, quantity: "1" }),
    ).rejects.toMatchObject({ code: "module_read_only" });
    expect(await getStockTotals(own, [productId])).toEqual({
      [productId]: "7",
    });
  });

  it("another company cannot receive into, or see, this one's stock (NEG-12)", async () => {
    const mine = await company();
    const theirs = await company();
    const productId = await product(mine, { name: "Propio" });
    const theirProduct = await product(theirs, { name: "Ajeno" });
    await registerEntry(mine, { productId, quantity: "12" });
    // Their session with this company's ids: they do not exist for them.
    expect(
      await registerEntry(theirs, { productId, quantity: "5" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await registerEntry(theirs, {
        productId: theirProduct,
        locationId: await generalOf(mine),
        quantity: "5",
      }),
    ).toMatchObject({
      ok: false,
      reason: "not_found",
      fieldErrors: { locationId: "Esa ubicación ya no existe. Elige otra." },
    });
    expect(await getStockTotals(theirs, [productId])).toEqual({});
    expect(await getStockByLocation(theirs, productId)).toEqual({});
    expect(await listRecentMovements(theirs)).toEqual([]);
    // Acting on this company with the other person's account is refused.
    const intruder = {
      organizationId: mine.organizationId,
      userId: theirs.userId,
    };
    await expect(
      registerEntry(intruder, { productId, quantity: "5" }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    await expect(listRecentMovements(intruder)).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(await getStockTotals(mine, [productId])).toEqual({
      [productId]: "12",
    });
  });
});

describe("the list of movements", () => {
  it("shows the latest first, with who made them and where", async () => {
    const own = await company();
    const zone = await createLocation(own, { kind: "ZONE", name: "Bodega" });
    if (!zone.ok) throw new Error("location setup failed");
    const inside = await shelf(own, "Estante 3", zone.locationId);
    const hose = await product(own, { name: "Manguera", unit: "m" });
    const nut = await product(own, { name: "Tuerca" });
    await registerEntry(own, { productId: nut, quantity: "500" });
    const second = await registerEntry(own, {
      productId: hose,
      locationId: inside,
      quantity: "12.5",
      reference: "Nota 7",
    });
    if (!second.ok) throw new Error("entry failed");

    const list = await listRecentMovements(own);
    expect(
      list.map((m) => ({
        type: m.typeLabel,
        author: m.authorName,
        reference: m.reference,
        lines: m.lines.map(
          (l) =>
            `${l.direction} ${l.quantity} · ${l.productName} · ${l.location}`,
        ),
      })),
    ).toEqual([
      {
        type: "Entrada",
        author: "Olga Titular",
        reference: "Nota 7",
        lines: ["IN 12.5 metros · Manguera · Bodega › Estante 3"],
      },
      {
        type: "Entrada",
        author: "Olga Titular",
        reference: null,
        lines: ["IN 500 piezas · Tuerca · General"],
      },
    ]);
    expect(await listRecentMovements(own, { limit: 1 })).toHaveLength(1);
    expect(
      (await listRecentMovements(own, { movementId: second.movementId })).map(
        (m) => m.id,
      ),
    ).toEqual([second.movementId]);
    expect(await listRecentMovements(own, { movementId: newId() })).toEqual([]);
  });

  it("offers the active locations in reading order, General first", async () => {
    const own = await company();
    const zone = await createLocation(own, { kind: "ZONE", name: "Bodega" });
    if (!zone.ok) throw new Error("location setup failed");
    await shelf(own, "Estante 10", zone.locationId);
    await shelf(own, "Estante 2", zone.locationId);
    const closed = await shelf(own, "Anaquel viejo");
    await archiveLocation(own, closed);
    expect((await listStockLocations(own)).map((l) => l.path)).toEqual([
      "General",
      "Bodega",
      "Bodega › Estante 2",
      "Bodega › Estante 10",
    ]);
  });
});

describe("an entry captured in a presentation (UNI-01)", () => {
  async function withBox() {
    const own = await company();
    const screws = await product(own, { name: "Tornillo" });
    const box = await createPresentation(own, screws, {
      name: "Caja",
      factor: "100",
    });
    if (!box.ok) throw new Error("presentation setup failed");
    return { own, screws, box: box.presentationId };
  }

  /** What each line of the product kept, in order. */
  async function kept(own: InventoryActor, productId: string) {
    const lines = await forOrganization(
      own.organizationId,
    ).stockMovementLine.findMany({
      where: { productId },
      orderBy: { id: "asc" },
      include: { presentationVersion: true, presentation: true },
    });
    return lines.map((l) => ({
      captured: l.capturedQuantity.toString(),
      in: l.presentation?.name ?? l.capturedUnitCode ?? null,
      version: l.presentationVersion?.version ?? null,
      factor: l.factor.toString(),
      base: l.baseQuantity.toString(),
    }));
  }

  it("3 boxes of 100 are 300 pieces", async () => {
    const { own, screws, box } = await withBox();
    expect(
      await registerEntry(own, {
        productId: screws,
        quantity: "3",
        presentationId: box,
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 300 piezas de Tornillo a General (3 cajas × 100 = 300 piezas). Ahora hay 300 piezas ahí.",
    });
    expect(await kept(own, screws)).toEqual([
      { captured: "3", in: "Caja", version: 1, factor: "100", base: "300" },
    ]);
    expect(await getStockTotals(own, [screws])).toEqual({ [screws]: "300" });
    // Loose pieces add to the same balance: boxes are not a second stock.
    await registerEntry(own, { productId: screws, quantity: "25" });
    expect(await getStockTotals(own, [screws])).toEqual({ [screws]: "325" });
    expect(await reconcileStock(own.organizationId)).toEqual([]);
  });

  it("uses the content the box has when it enters, and keeps the earlier lines", async () => {
    const { own, screws, box } = await withBox();
    await registerEntry(own, {
      productId: screws,
      quantity: "3",
      presentationId: box,
    });
    const changed = await changePresentationFactor(own, box, {
      factor: "120",
      reason: "El proveedor cambió la caja",
    });
    expect(changed.ok).toBe(true);
    expect(
      await registerEntry(own, {
        productId: screws,
        quantity: "1",
        presentationId: box,
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 120 piezas de Tornillo a General (1 caja × 120 = 120 piezas). Ahora hay 420 piezas ahí.",
    });
    expect(await kept(own, screws)).toEqual([
      { captured: "3", in: "Caja", version: 1, factor: "100", base: "300" },
      { captured: "1", in: "Caja", version: 2, factor: "120", base: "120" },
    ]);
    // The history reads each entry with the content of its moment.
    const list = await listRecentMovements(own);
    expect(
      list.map((m) => m.lines.map((l) => `${l.quantity} · ${l.captured}`)),
    ).toEqual([
      ["120 piezas · 1 caja de 120"],
      ["300 piezas · 3 cajas de 100"],
    ]);
    expect(await reconcileStock(own.organizationId)).toEqual([]);
  });

  it("the content never comes from the request", async () => {
    const { own, screws, box } = await withBox();
    // Whatever else is sent, only the id of the presentation counts.
    const forged = {
      productId: screws,
      quantity: "2",
      presentationId: box,
      factor: "5000",
      baseQuantity: "10000",
      capturedQuantity: "9",
    };
    expect(await registerEntry(own, forged)).toMatchObject({ ok: true });
    expect(await kept(own, screws)).toEqual([
      { captured: "2", in: "Caja", version: 1, factor: "100", base: "200" },
    ]);
  });

  it("boxes are counted whole and belong to their product", async () => {
    const { own, screws, box } = await withBox();
    const other = await product(own, { name: "Clavo" });
    const theirs = await withBox();
    const cases: [object, string][] = [
      [
        { productId: screws, quantity: "2.5", presentationId: box },
        "Las presentaciones se capturan completas. Para una parte de caja, captura en piezas.",
      ],
      [
        { productId: screws, quantity: "0", presentationId: box },
        "La cantidad debe ser mayor que cero.",
      ],
      // The box of another product, of another company, or one that is not.
      [
        { productId: other, quantity: "1", presentationId: box },
        "Esa presentación no existe para este producto.",
      ],
      [
        { productId: screws, quantity: "1", presentationId: theirs.box },
        "Esa presentación no existe para este producto.",
      ],
      [
        { productId: screws, quantity: "1", presentationId: newId() },
        "Esa presentación no existe para este producto.",
      ],
      [
        {
          productId: screws,
          quantity: "1",
          presentationId: box,
          unitCode: "dozen",
        },
        "Elige una sola forma de capturar: presentación o unidad.",
      ],
    ];
    for (const [input, message] of cases) {
      expect(
        await registerEntry(own, input as Parameters<typeof registerEntry>[1]),
        JSON.stringify(input),
      ).toMatchObject({
        ok: false,
        reason: "invalid",
        fieldErrors: { quantity: message },
      });
    }
    expect(await kept(own, screws)).toEqual([]);
    expect(await kept(own, other)).toEqual([]);
    expect(await kept(theirs.own, theirs.screws)).toEqual([]);
  });
});

describe("an entry captured in another unit", () => {
  it("converts between units of the same kind and refuses the rest", async () => {
    const own = await company();
    const cable = await product(own, {
      name: "Cable",
      unit: "m",
      step: "0.01",
    });
    const screws = await product(own, { name: "Tornillo" });
    expect(
      await registerEntry(own, {
        productId: cable,
        quantity: "275",
        unitCode: "cm",
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 2.75 metros de Cable a General (275 centímetros = 2.75 metros). Ahora hay 2.75 metros ahí.",
    });
    expect(
      await registerEntry(own, {
        productId: screws,
        quantity: "3",
        unitCode: "dozen",
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 36 piezas de Tornillo a General (3 docenas = 36 piezas). Ahora hay 36 piezas ahí.",
    });
    // The product's own unit sent as "another unit" is just the unit.
    expect(
      await registerEntry(own, {
        productId: cable,
        quantity: "1.25",
        unitCode: "m",
      }),
    ).toMatchObject({
      ok: true,
      summary:
        "Entraron 1.25 metros de Cable a General. Ahora hay 4 metros ahí.",
    });
    const lines = await forOrganization(
      own.organizationId,
    ).stockMovementLine.findMany({
      where: { productId: { in: [cable, screws] } },
      orderBy: { id: "asc" },
    });
    expect(
      lines.map((l) => [
        l.capturedQuantity.toString(),
        l.capturedUnitCode,
        l.factor.toString(),
        l.baseQuantity.toString(),
        l.unitCode,
      ]),
    ).toEqual([
      ["275", "cm", "0.01", "2.75", "m"],
      ["3", "dozen", "12", "36", "piece"],
      ["1.25", null, "1", "1.25", "m"],
    ]);
    expect((await listRecentMovements(own))[2]?.lines[0]?.captured).toBe(
      "275 centímetros",
    );

    for (const [input, message] of [
      // Kilograms are not pieces; 5 mm do not fit hundredths of a meter.
      [
        { productId: screws, quantity: "2", unitCode: "kg" },
        "No se puede convertir de kilogramos a piezas: miden cosas distintas.",
      ],
      [{ productId: cable, quantity: "5", unitCode: "mm" }, null],
      [{ productId: cable, quantity: "5", unitCode: "leguas" }, null],
    ] as const) {
      const result = await registerEntry(own, input);
      expect(result, JSON.stringify(input)).toMatchObject({
        ok: false,
        reason: "invalid",
      });
      if (message) {
        expect(!result.ok && result.fieldErrors.quantity).toBe(message);
      }
    }
    expect(await getStockTotals(own, [cable, screws])).toEqual({
      [cable]: "4",
      [screws]: "36",
    });
    expect(await reconcileStock(own.organizationId)).toEqual([]);
  });
});
