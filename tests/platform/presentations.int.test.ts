import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createPresentation,
  createProduct,
  listPresentations,
  type CatalogActor,
} from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// INV-07: presentations per product. Caja = 100 piezas; zero, negative or
// another company's factors are rejected.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `presenta.${++counter}.${stamp}@example.test`,
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
      productLimit: 100,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de presentaciones",
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
  actor: CatalogActor,
  input: { unit?: string; step?: string } = {},
) {
  const sku = `PR-${++counter}`;
  const result = await createProduct(actor, {
    sku,
    name: `Producto ${sku}`,
    ...input,
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

let actor: CatalogActor;

beforeAll(async () => {
  actor = await company();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("createPresentation", () => {
  it("Caja = 100 piezas", async () => {
    const tornillo = await product(actor);
    const result = await createPresentation(actor, tornillo, {
      name: " Caja ",
      factor: "100",
    });
    expect(result).toMatchObject({ ok: true });
    expect(await listPresentations(actor, tornillo)).toEqual([
      {
        id: expect.any(String),
        name: "Caja",
        factor: "100",
        version: 1,
        label: "Caja = 100 piezas",
      },
    ]);
    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: actor.organizationId,
        action: "presentation.created",
        targetId: tornillo,
      },
    });
    expect(event.metadata).toMatchObject({
      presentation: "Caja",
      content: "100 piezas",
    });
  });

  it("the examples of the plan: rollo, bolsa and cubeta", async () => {
    const cable = await product(actor, { unit: "m" });
    const clavo = await product(actor, { unit: "kg", step: "0.001" });
    const pintura = await product(actor, { unit: "l" });
    await createPresentation(actor, cable, { name: "Rollo", factor: "100" });
    await createPresentation(actor, clavo, { name: "Bolsa", factor: "5" });
    await createPresentation(actor, clavo, { name: "Bolsita", factor: "0.25" });
    await createPresentation(actor, pintura, { name: "Cubeta", factor: "19" });
    expect((await listPresentations(actor, cable)).map((p) => p.label)).toEqual(
      ["Rollo = 100 metros"],
    );
    expect((await listPresentations(actor, clavo)).map((p) => p.label)).toEqual(
      ["Bolsa = 5 kilogramos", "Bolsita = 0.25 kilogramos"],
    );
    expect(
      (await listPresentations(actor, pintura)).map((p) => p.label),
    ).toEqual(["Cubeta = 19 litros"]);
  });

  it("the same name means different content in different products", async () => {
    const a = await product(actor);
    const b = await product(actor);
    await createPresentation(actor, a, { name: "Caja", factor: "100" });
    await createPresentation(actor, b, { name: "Caja", factor: "24" });
    expect((await listPresentations(actor, a))[0]!.factor).toBe("100");
    expect((await listPresentations(actor, b))[0]!.factor).toBe("24");
  });

  it.each([
    ["0", "La cantidad debe ser mayor que cero."],
    ["-100", "La cantidad debe ser mayor que cero."],
    ["", "Escribe una cantidad, por ejemplo 3 o 2.75."],
    ["cien", "Escribe una cantidad, por ejemplo 3 o 2.75."],
    ["1e2", "Escribe una cantidad, por ejemplo 3 o 2.75."],
    [
      "12.5",
      "Este producto se maneja en piezas completas: no admite fracciones.",
    ],
    ["1000000000", "La cantidad es demasiado grande."],
  ])("rejects the content %j of a box of pieces", async (factor, message) => {
    const tornillo = await product(actor);
    expect(
      await createPresentation(actor, tornillo, { name: "Caja", factor }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      fieldErrors: { factor: message },
    });
    expect(await listPresentations(actor, tornillo)).toEqual([]);
  });

  it("the content follows the increment of the product", async () => {
    const cable = await product(actor, { unit: "m", step: "0.1" });
    expect(
      await createPresentation(actor, cable, { name: "Rollo", factor: "30.5" }),
    ).toMatchObject({ ok: true });
    expect(
      await createPresentation(actor, cable, { name: "Tramo", factor: "2.75" }),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        factor: "Este producto se maneja en pasos de 0.1 metros.",
      },
    });
  });

  it("needs a name; a repeated name in the product is refused", async () => {
    const tornillo = await product(actor);
    expect(
      await createPresentation(actor, tornillo, { name: "  ", factor: "0" }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { name: expect.any(String), factor: expect.any(String) },
    });
    await createPresentation(actor, tornillo, { name: "Caja", factor: "100" });
    for (const name of ["Caja", "caja", "CAJA"]) {
      expect(
        await createPresentation(actor, tornillo, { name, factor: "50" }),
      ).toMatchObject({
        ok: false,
        reason: "duplicate",
        fieldErrors: { name: expect.any(String) },
      });
    }
    expect(await listPresentations(actor, tornillo)).toHaveLength(1);
  });

  it("the same name sent several times at once creates one presentation", async () => {
    const tornillo = await product(actor);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createPresentation(actor, tornillo, { name: "Caja", factor: "100" }),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await listPresentations(actor, tornillo)).toHaveLength(1);
  });

  it("an archived or unknown product gets no presentations", async () => {
    const tornillo = await product(actor);
    await archiveProduct(actor, tornillo);
    for (const id of [tornillo, newId()]) {
      expect(
        await createPresentation(actor, id, { name: "Caja", factor: "100" }),
      ).toMatchObject({ ok: false, reason: "not_found" });
    }
  });
});

describe("another company", () => {
  it("cannot add or see presentations of a product that is not its own", async () => {
    const theirs = await company();
    const tornillo = await product(actor);
    await createPresentation(actor, tornillo, { name: "Caja", factor: "100" });

    expect(
      await createPresentation(theirs, tornillo, {
        name: "Bolsa",
        factor: "10",
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await listPresentations(theirs, tornillo)).toEqual([]);
    await expect(
      createPresentation(
        { organizationId: actor.organizationId, userId: theirs.userId },
        tornillo,
        { name: "Bolsa", factor: "10" },
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
    expect(await listPresentations(actor, tornillo)).toHaveLength(1);
  });

  it("the database refuses a presentation or a version that mixes companies", async () => {
    const theirs = await company();
    const mine = await product(actor);
    await createPresentation(actor, mine, { name: "Caja", factor: "100" });
    const presentation = await forOrganization(
      actor.organizationId,
    ).productPresentation.findFirstOrThrow({ where: { productId: mine } });

    await expect(
      db.$executeRaw`INSERT INTO product_presentation (id, organizationId, productId, name) VALUES (${newId()}, ${theirs.organizationId}, ${mine}, 'Ajena')`,
    ).rejects.toThrow(/foreign key/i);
    await expect(
      db.$executeRaw`INSERT INTO presentation_version (id, organizationId, presentationId, version, factor, createdByUserId) VALUES (${newId()}, ${theirs.organizationId}, ${presentation.id}, 2, 999, ${theirs.userId})`,
    ).rejects.toThrow(/foreign key/i);
  });

  it("the database refuses a factor of zero or negative", async () => {
    const mine = await product(actor);
    await createPresentation(actor, mine, { name: "Caja", factor: "100" });
    const presentation = await forOrganization(
      actor.organizationId,
    ).productPresentation.findFirstOrThrow({ where: { productId: mine } });
    for (const factor of [0, -5]) {
      await expect(
        db.$executeRaw`INSERT INTO presentation_version (id, organizationId, presentationId, version, factor, createdByUserId) VALUES (${newId()}, ${actor.organizationId}, ${presentation.id}, 2, ${factor}, ${actor.userId})`,
      ).rejects.toThrow(/presentation_version_values_check/);
    }
  });
});

describe("who can define presentations", () => {
  it("Almacén can; Comprador and Consulta can only see them", async () => {
    const tornillo = await product(actor);
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      await createPresentation(warehouse, tornillo, {
        name: "Caja",
        factor: "100",
      }),
    ).toMatchObject({ ok: true });
    for (const role of ["buyer", "viewer"] as const) {
      const other = await member(actor.organizationId, role);
      await expect(
        createPresentation(other, tornillo, { name: "Bolsa", factor: "10" }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect(await listPresentations(other, tornillo)).toHaveLength(1);
    }
  });
});
