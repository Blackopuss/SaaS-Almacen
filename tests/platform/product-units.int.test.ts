import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  createProduct,
  getProduct,
  parseQuantity,
  updateProduct,
  type CatalogActor,
} from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-06: each product has a unit and an increment for its quantities.

const stamp = Date.now();
let counter = 0;
let actor: CatalogActor;

beforeAll(async () => {
  const owner = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `unidades.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const staff = await db.user.create({
    data: {
      id: newId(),
      name: "Soporte",
      email: `unidades.soporte.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  await db.platformStaff.create({ data: { userId: staff.id } });
  const created = await createOrganization(owner.id, {
    name: "Ferretería de unidades",
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const result = await provisionCompany(
    moduleRegistry,
    staff.id,
    created.organizationId,
    {
      productLimit: 100,
      users: 5,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de unidades por producto",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  actor = { organizationId: created.organizationId, userId: owner.id };
});

afterAll(async () => {
  await db.$disconnect();
});

async function newProduct(input: { unit?: string; step?: string } = {}) {
  const sku = `U-${++counter}`;
  const result = await createProduct(actor, {
    sku,
    name: `Producto ${sku}`,
    ...input,
  });
  return result;
}

async function ruleOf(input: { unit?: string; step?: string }) {
  const result = await newProduct(input);
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result)}`);
  const product = await getProduct(actor, result.productId);
  return {
    unitCode: product!.unitCode,
    quantityStep: product!.quantityStep,
  };
}

describe("unit and increment of a product", () => {
  it("is pieza in whole units when nothing is chosen", async () => {
    expect(await ruleOf({})).toEqual({ unitCode: "piece", quantityStep: "1" });
  });

  it("a measure gets 0.01 unless another precision is chosen", async () => {
    expect(await ruleOf({ unit: "m" })).toEqual({
      unitCode: "m",
      quantityStep: "0.01",
    });
    expect(await ruleOf({ unit: "kg", step: "0.001" })).toEqual({
      unitCode: "kg",
      quantityStep: "0.001",
    });
    expect(await ruleOf({ unit: "l", step: "1" })).toEqual({
      unitCode: "l",
      quantityStep: "1",
    });
  });

  it("0.5 pieces is rejected and 2.75 m is accepted, with the stored rules", async () => {
    const pieces = await ruleOf({ unit: "piece" });
    const meters = await ruleOf({ unit: "m" });
    expect(parseQuantity(pieces, "0.5").ok).toBe(false);
    expect(parseQuantity(pieces, "3").ok).toBe(true);
    const length = parseQuantity(meters, "2.75");
    expect(length.ok && length.quantity.toString()).toBe("2.75");
    expect(parseQuantity(meters, "2.755").ok).toBe(false);
  });

  it("things that are counted cannot use fractions", async () => {
    for (const unit of ["piece", "pair", "dozen"]) {
      expect(await newProduct({ unit, step: "0.1" })).toMatchObject({
        ok: false,
        reason: "invalid",
        fieldErrors: { step: expect.stringContaining("se manejan en enteros") },
      });
    }
  });

  it("rejects an unknown unit or precision", async () => {
    expect(await newProduct({ unit: "caja" })).toMatchObject({
      ok: false,
      fieldErrors: { unit: "Elige una unidad de la lista." },
    });
    expect(await newProduct({ unit: "m", step: "0.5" })).toMatchObject({
      ok: false,
      fieldErrors: { step: "Elige una precisión de la lista." },
    });
    expect(await newProduct({ unit: "m", step: "0.0001" })).toMatchObject({
      ok: false,
    });
  });

  it("a rejected card takes no place of the quota", async () => {
    const before = await db.product.count({
      where: { organizationId: actor.organizationId },
    });
    await newProduct({ unit: "caja" });
    await newProduct({ unit: "piece", step: "0.5" });
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(before);
  });

  it("changing the unit or the precision is recorded with both values", async () => {
    const created = await newProduct({ unit: "m" });
    if (!created.ok) throw new Error("expected ok");
    const card = (await getProduct(actor, created.productId))!;
    expect(
      await updateProduct(actor, created.productId, {
        sku: card.sku,
        name: card.name,
        unit: "kg",
        step: "0.001",
      }),
    ).toMatchObject({ ok: true });
    expect(await getProduct(actor, created.productId)).toMatchObject({
      unitCode: "kg",
      quantityStep: "0.001",
    });
    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "product.updated", targetId: created.productId },
    });
    expect(event.metadata).toMatchObject({
      changes: {
        Unidad: { antes: "metro", ahora: "kilogramo" },
        Precisión: { antes: "0.01", ahora: "0.001" },
      },
    });
  });

  it("saving the same unit and precision is not a change", async () => {
    const created = await newProduct({ unit: "m" });
    if (!created.ok) throw new Error("expected ok");
    const card = (await getProduct(actor, created.productId))!;
    expect(
      await updateProduct(actor, created.productId, {
        sku: card.sku,
        name: card.name,
        unit: "m",
        step: "0.010",
      }),
    ).toMatchObject({ ok: false, reason: "unchanged" });
  });

  it("the database refuses a unit that does not exist or a step of zero", async () => {
    const created = await newProduct({});
    if (!created.ok) throw new Error("expected ok");
    await expect(
      db.$executeRaw`UPDATE product SET unitCode = 'caja' WHERE id = ${created.productId}`,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.$executeRaw`UPDATE product SET quantityStep = 0 WHERE id = ${created.productId}`,
    ).rejects.toThrow(/product_quantity_step_check/);
  });
});
