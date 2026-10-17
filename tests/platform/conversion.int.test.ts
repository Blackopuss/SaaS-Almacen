import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
  previewConversion,
  resolveConversion,
  type Capture,
  type CatalogActor,
} from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// INV-09: the server resolves the factor and shows the conversion before
// anything is confirmed.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function company(): Promise<CatalogActor> {
  const owner = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `conversion.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(owner.id, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  if (!staff) {
    const user = await db.user.create({
      data: {
        id: newId(),
        name: "Soporte",
        email: `conversion.soporte.${stamp}@example.test`,
        emailVerified: true,
      },
    });
    staff = user.id;
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
      reason: "Prueba de conversiones",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner.id };
}

async function product(owner: CatalogActor, unit = "piece") {
  const sku = `C-${++counter}`;
  const result = await createProduct(owner, {
    sku,
    name: `Producto ${sku}`,
    unit,
  });
  if (!result.ok) throw new Error("product setup failed");
  return result.productId;
}

async function presentation(
  owner: CatalogActor,
  productId: string,
  name: string,
  factor: string,
) {
  const result = await createPresentation(owner, productId, { name, factor });
  if (!result.ok) throw new Error("presentation setup failed");
  return result.presentationId;
}

let actor: CatalogActor;

beforeAll(async () => {
  actor = await company();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("previewConversion", () => {
  it("3 cajas × 100 = 300 piezas, with the factor stored on the server", async () => {
    const tornillo = await product(actor);
    const caja = await presentation(actor, tornillo, "Caja", "100");
    expect(
      await previewConversion(actor, tornillo, {
        kind: "presentation",
        quantity: "3",
        presentationId: caja,
      }),
    ).toEqual({
      ok: true,
      preview: "3 cajas × 100 = 300 piezas",
      baseQuantity: "300",
      unitCode: "piece",
    });
  });

  it("a factor sent by the browser is ignored", async () => {
    const tornillo = await product(actor);
    const caja = await presentation(actor, tornillo, "Caja", "100");
    const tampered = {
      kind: "presentation",
      quantity: "3",
      presentationId: caja,
      factor: "100000",
      version: 99,
      baseQuantity: "999999",
    } as unknown as Capture;
    expect(await previewConversion(actor, tornillo, tampered)).toMatchObject({
      ok: true,
      baseQuantity: "300",
    });
  });

  it("uses the current version once the content changes", async () => {
    const tornillo = await product(actor);
    const caja = await presentation(actor, tornillo, "Caja", "100");
    await changePresentationFactor(actor, caja, { factor: "120" });
    const resolved = await resolveConversion(
      forOrganization(actor.organizationId),
      tornillo,
      { kind: "presentation", quantity: "1", presentationId: caja },
    );
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.conversion.preview).toBe("1 caja × 120 = 120 piezas");
    expect(resolved.conversion.presentation).toMatchObject({
      id: caja,
      version: 2,
      factor: "120",
    });
    // The id of the exact version travels with the result, for the movement.
    const stored = await db.presentationVersion.findUniqueOrThrow({
      where: { id: resolved.conversion.presentation!.versionId },
    });
    expect(stored.version).toBe(2);
  });

  it("captures in the product's unit and in another unit of its dimension", async () => {
    const cable = await product(actor, "m");
    expect(
      await previewConversion(actor, cable, { kind: "base", quantity: "2.75" }),
    ).toMatchObject({ ok: true, preview: "2.75 metros", baseQuantity: "2.75" });
    expect(
      await previewConversion(actor, cable, {
        kind: "unit",
        quantity: "275",
        unitCode: "cm",
      }),
    ).toMatchObject({
      ok: true,
      preview: "275 centímetros = 2.75 metros",
      baseQuantity: "2.75",
      unitCode: "m",
    });
  });

  it("rejects incompatible dimensions", async () => {
    const tornillo = await product(actor);
    const cable = await product(actor, "m");
    expect(
      await previewConversion(actor, tornillo, {
        kind: "unit",
        quantity: "1",
        unitCode: "kg",
      }),
    ).toEqual({
      ok: false,
      error:
        "No se puede convertir de kilogramos a piezas: miden cosas distintas.",
    });
    expect(
      await previewConversion(actor, cable, {
        kind: "unit",
        quantity: "1",
        unitCode: "l",
      }),
    ).toMatchObject({ ok: false, error: expect.stringMatching(/miden cosas/) });
  });

  it("a presentation of another product is refused", async () => {
    const tornillo = await product(actor);
    const clavo = await product(actor);
    const cajaDeClavo = await presentation(actor, clavo, "Caja", "500");
    expect(
      await previewConversion(actor, tornillo, {
        kind: "presentation",
        quantity: "1",
        presentationId: cajaDeClavo,
      }),
    ).toEqual({
      ok: false,
      error: "Esa presentación no existe para este producto.",
    });
  });

  it("another company cannot convert with this company's product or presentation", async () => {
    const theirs = await company();
    const tornillo = await product(actor);
    const caja = await presentation(actor, tornillo, "Caja", "100");
    const own = await product(theirs);
    expect(
      await previewConversion(theirs, tornillo, {
        kind: "base",
        quantity: "1",
      }),
    ).toMatchObject({ ok: false });
    expect(
      await previewConversion(theirs, own, {
        kind: "presentation",
        quantity: "1",
        presentationId: caja,
      }),
    ).toEqual({
      ok: false,
      error: "Esa presentación no existe para este producto.",
    });
    await expect(
      previewConversion(
        { organizationId: actor.organizationId, userId: theirs.userId },
        tornillo,
        { kind: "base", quantity: "1" },
      ),
    ).rejects.toMatchObject({ code: "permission_denied" });
  });

  it("an archived or unknown product cannot be converted", async () => {
    const tornillo = await product(actor);
    await archiveProduct(actor, tornillo);
    for (const id of [tornillo, newId()]) {
      expect(
        await previewConversion(actor, id, { kind: "base", quantity: "1" }),
      ).toEqual({
        ok: false,
        error: "Este producto ya no existe o está archivado.",
      });
    }
  });

  it("resolves inside a transaction with the same client", async () => {
    const tornillo = await product(actor);
    const caja = await presentation(actor, tornillo, "Caja", "100");
    const base = await forOrganization(actor.organizationId).$transaction(
      async (tx) => {
        const resolved = await resolveConversion(tx, tornillo, {
          kind: "presentation",
          quantity: "3",
          presentationId: caja,
        });
        if (!resolved.ok) throw new Error(resolved.error);
        return resolved.conversion.baseQuantity.toString();
      },
    );
    expect(base).toBe("300");
  });
});
