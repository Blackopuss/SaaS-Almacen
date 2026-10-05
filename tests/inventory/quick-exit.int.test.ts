import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  QUICK_EXIT_MAX_LINES,
  getStockByLocation,
  getStockTotals,
  listMovements,
  reconcileStock,
  registerEntry,
  registerQuickExit,
  reverseMovement,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-28: quick exit of several lines in one confirmation.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `rapida.${++counter}.${stamp}@example.test`,
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
      productLimit: 200,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de salida rápida",
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

/** A product with stock in «General». */
async function stocked(
  owner: InventoryActor,
  name: string,
  quantity: string,
  unit?: string,
) {
  const result = await createProduct(owner, {
    sku: `Q-${++counter}`,
    name,
    ...(unit ? { unit } : {}),
  });
  if (!result.ok) throw new Error("product setup failed");
  const entry = await registerEntry(owner, {
    productId: result.productId,
    quantity,
  });
  if (!entry.ok) throw new Error("entry setup failed");
  return result.productId;
}

const total = async (owner: InventoryActor, productId: string) =>
  (await getStockTotals(owner, [productId]))[productId] ?? "0";

const movementCount = async (owner: InventoryActor) =>
  (await listMovements(owner, { type: "EXIT" })).total;

let actor: InventoryActor;

beforeAll(async () => {
  actor = await company();
}, 60_000);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("registerQuickExit", () => {
  it("takes several products out in one movement", async () => {
    const tornillo = await stocked(actor, "Tornillo", "100");
    const clavo = await stocked(actor, "Clavo", "40");
    const cable = await stocked(actor, "Cable", "25.5", "m");
    const result = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "12" },
        { productId: clavo, quantity: "40" },
        { productId: cable, quantity: "2.5" },
      ],
      reason: "Venta",
      reference: "Nota 1042",
    });
    expect(result).toMatchObject({
      ok: true,
      summary: "Salida registrada con 3 líneas.",
    });
    if (!result.ok) return;
    expect(await total(actor, tornillo)).toBe("88");
    expect(await total(actor, clavo)).toBe("0");
    expect(await total(actor, cable)).toBe("23");

    const movement = await db.stockMovement.findUniqueOrThrow({
      where: { id: result.movementId },
      include: { lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(movement).toMatchObject({
      type: "EXIT",
      reason: "Venta",
      reference: "Nota 1042",
      createdByUserId: actor.userId,
    });
    expect(
      movement.lines.map((line) => [
        line.lineNumber,
        line.productId,
        line.direction,
        line.baseQuantity.toString(),
      ]),
    ).toEqual([
      [1, tornillo, "OUT", "12"],
      [2, clavo, "OUT", "40"],
      [3, cable, "OUT", "2.5"],
    ]);
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("converts presentations and units with what the server knows", async () => {
    const tornillo = await stocked(actor, "Tornillo de caja", "500");
    const cable = await stocked(actor, "Cable por metro", "10", "m");
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    const result = await registerQuickExit(actor, {
      lines: [
        {
          productId: tornillo,
          quantity: "2",
          presentationId: caja.presentationId,
        },
        { productId: tornillo, quantity: "30" },
        { productId: cable, quantity: "150", unitCode: "cm" },
      ],
      reason: "Venta",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(await total(actor, tornillo)).toBe("270");
    expect(await total(actor, cable)).toBe("8.5");
    const lines = await db.stockMovementLine.findMany({
      where: { movementId: result.movementId },
      orderBy: { lineNumber: "asc" },
    });
    expect(lines[0]).toMatchObject({ presentationId: caja.presentationId });
    expect(lines[0]!.factor.toString()).toBe("100");
    expect(lines[0]!.baseQuantity.toString()).toBe("200");
    expect(lines[0]!.presentationVersionId).toBeTruthy();
    expect(lines[2]!.capturedUnitCode).toBe("cm");
    expect(lines[2]!.baseQuantity.toString()).toBe("1.5");
  });

  it("takes from the location of each line", async () => {
    const tornillo = await stocked(actor, "Tornillo en estante", "10");
    const created = await createLocation(actor, {
      kind: "SHELF",
      name: `Estante ${++counter}`,
    });
    if (!created.ok) throw new Error("location setup failed");
    await registerEntry(actor, {
      productId: tornillo,
      locationId: created.locationId,
      quantity: "30",
    });
    const result = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "4" },
        {
          productId: tornillo,
          locationId: created.locationId,
          quantity: "25",
        },
      ],
      reason: "Venta",
    });
    expect(result.ok).toBe(true);
    const byLocation = await getStockByLocation(actor, tornillo);
    expect(byLocation[created.locationId]).toBe("5");
    expect(await total(actor, tornillo)).toBe("11");
  });

  it("writes nothing when one line cannot leave, and says which", async () => {
    const tornillo = await stocked(actor, "Tornillo corto", "10");
    const clavo = await stocked(actor, "Clavo corto", "5");
    const before = await movementCount(actor);
    const result = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "3" },
        { productId: clavo, quantity: "6" },
        { productId: tornillo, quantity: "1.5" },
      ],
      reason: "Venta",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok) return;
    expect(Object.keys(result.lineErrors)).toEqual(["1", "2"]);
    expect(result.lineErrors[1]).toContain("Solo hay 5 piezas");
    expect(await total(actor, tornillo)).toBe("10");
    expect(await total(actor, clavo)).toBe("5");
    expect(await movementCount(actor)).toBe(before);
  });

  it("adds up lines of the same product: together they never exceed stock", async () => {
    const tornillo = await stocked(actor, "Tornillo repetido", "10");
    const refused = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "6" },
        { productId: tornillo, quantity: "5" },
      ],
      reason: "Venta",
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.lineErrors[0]).toBeUndefined();
    expect(refused.lineErrors[1]).toContain(
      "Con las líneas anteriores ya solo quedan 4 piezas",
    );
    expect(await total(actor, tornillo)).toBe("10");

    const accepted = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "6" },
        { productId: tornillo, quantity: "4" },
      ],
      reason: "Venta",
    });
    expect(accepted.ok).toBe(true);
    expect(await total(actor, tornillo)).toBe("0");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });

  it("asks for lines and a reason", async () => {
    const tornillo = await stocked(actor, "Tornillo sin motivo", "10");
    expect(
      await registerQuickExit(actor, { lines: [], reason: "Venta" }),
    ).toMatchObject({ ok: false, formError: "Agrega al menos un producto." });
    expect(
      await registerQuickExit(actor, {
        lines: [{ productId: tornillo, quantity: "1" }],
        reason: "  ",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { reason: "Elige el motivo de la salida." },
    });
    const empty = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "" },
        { productId: tornillo, quantity: "-2" },
        { productId: tornillo, quantity: "0.5" },
      ],
      reason: "Venta",
    });
    expect(empty.ok).toBe(false);
    if (empty.ok) return;
    expect(empty.lineErrors[0]).toBe("Escribe la cantidad que sale.");
    const tooMany = await registerQuickExit(actor, {
      lines: Array.from({ length: QUICK_EXIT_MAX_LINES + 1 }, () => ({
        productId: tornillo,
        quantity: "1",
      })),
      reason: "Venta",
    });
    expect(tooMany).toMatchObject({ ok: false });
    if (tooMany.ok) return;
    expect(tooMany.formError).toContain("hasta 50 líneas");
    expect(await total(actor, tornillo)).toBe("10");
  });

  it("refuses fractions of whole units and broken quantities, per line", async () => {
    const tornillo = await stocked(actor, "Tornillo entero", "10");
    const result = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "0.5" },
        { productId: tornillo, quantity: "dos" },
        { productId: tornillo, quantity: "-1" },
      ],
      reason: "Venta",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.lineErrors)).toEqual(["0", "1", "2"]);
    expect(await total(actor, tornillo)).toBe("10");
  });

  it("refuses archived or unknown products and other companies' data", async () => {
    const tornillo = await stocked(actor, "Tornillo vigente", "10");
    const archived = await createProduct(actor, {
      sku: `Q-${++counter}`,
      name: "Descontinuado",
    });
    if (!archived.ok) throw new Error("product setup failed");
    await archiveProduct(actor, archived.productId);
    const theirs = await company();
    const foreign = await stocked(theirs, "Ajeno", "50");
    const foreignShelf = await createLocation(theirs, {
      kind: "SHELF",
      name: "Estante ajeno",
    });
    if (!foreignShelf.ok) throw new Error("location setup failed");

    const result = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "1" },
        { productId: archived.productId, quantity: "1" },
        { productId: foreign, quantity: "1" },
        { productId: newId(), quantity: "1" },
        {
          productId: tornillo,
          locationId: foreignShelf.locationId,
          quantity: "1",
        },
      ],
      reason: "Venta",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.lineErrors)).toEqual(["1", "2", "3", "4"]);
    expect(result.lineErrors[1]).toContain("archivado");
    expect(result.lineErrors[2]).toBe("Este producto ya no existe.");
    expect(result.lineErrors[4]).toContain("ubicación ya no existe");
    expect(await total(actor, tornillo)).toBe("10");
    expect(await total(theirs, foreign)).toBe("50");
  });

  it("only who may register exits", async () => {
    const tornillo = await stocked(actor, "Tornillo vigilado", "10");
    const viewer = await member(actor.organizationId, "viewer");
    await expect(
      registerQuickExit(viewer, {
        lines: [{ productId: tornillo, quantity: "1" }],
        reason: "Venta",
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      (
        await registerQuickExit(warehouse, {
          lines: [{ productId: tornillo, quantity: "1" }],
          reason: "Venta",
        })
      ).ok,
    ).toBe(true);
    expect(await total(actor, tornillo)).toBe("9");
  });
});

describe("one confirmation, one movement", () => {
  it("a retry with the same key answers with the first movement", async () => {
    const tornillo = await stocked(actor, "Tornillo reintento", "20");
    const clavo = await stocked(actor, "Clavo reintento", "20");
    const input = {
      lines: [
        { productId: tornillo, quantity: "5" },
        { productId: clavo, quantity: "2" },
      ],
      reason: "Venta",
      idempotencyKey: newId(),
    };
    const first = await registerQuickExit(actor, input);
    const again = await registerQuickExit(actor, input);
    expect(first.ok && again.ok).toBe(true);
    if (!first.ok || !again.ok) return;
    expect(again.movementId).toBe(first.movementId);
    expect(again.repeated).toBe(true);
    expect(await total(actor, tornillo)).toBe("15");
    expect(await total(actor, clavo)).toBe("18");
  });

  it("the same key for a different exit is refused", async () => {
    const tornillo = await stocked(actor, "Tornillo otra clave", "20");
    const idempotencyKey = newId();
    await registerQuickExit(actor, {
      lines: [{ productId: tornillo, quantity: "5" }],
      reason: "Venta",
      idempotencyKey,
    });
    const other = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "5" },
        { productId: tornillo, quantity: "1" },
      ],
      reason: "Venta",
      idempotencyKey,
    });
    expect(other).toMatchObject({ ok: false, reason: "not_allowed" });
    expect(await total(actor, tornillo)).toBe("15");
  });

  it("two confirmations at once never take more than there is", async () => {
    const tornillo = await stocked(actor, "Tornillo disputado", "10");
    const clavo = await stocked(actor, "Clavo disputado", "10");
    const results = await Promise.all([
      registerQuickExit(actor, {
        lines: [
          { productId: tornillo, quantity: "7" },
          { productId: clavo, quantity: "7" },
        ],
        reason: "Venta",
      }),
      // The other one names them in the opposite order.
      registerQuickExit(actor, {
        lines: [
          { productId: clavo, quantity: "7" },
          { productId: tornillo, quantity: "7" },
        ],
        reason: "Venta",
      }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(await total(actor, tornillo)).toBe("3");
    expect(await total(actor, clavo)).toBe("3");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  }, 60_000);

  it("a quick exit is reversed whole", async () => {
    const tornillo = await stocked(actor, "Tornillo devuelto", "10");
    const clavo = await stocked(actor, "Clavo devuelto", "10");
    const exit = await registerQuickExit(actor, {
      lines: [
        { productId: tornillo, quantity: "4" },
        { productId: clavo, quantity: "6" },
      ],
      reason: "Venta",
    });
    if (!exit.ok) throw new Error("exit failed");
    const reversal = await reverseMovement(actor, {
      movementId: exit.movementId,
      reason: "Se canceló la venta",
    });
    expect(reversal.ok).toBe(true);
    expect(await total(actor, tornillo)).toBe("10");
    expect(await total(actor, clavo)).toBe("10");
    expect(await reconcileStock(actor.organizationId)).toEqual([]);
  });
});
