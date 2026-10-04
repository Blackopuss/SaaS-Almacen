import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
  listPresentationVersions,
  listPresentations,
  type CatalogActor,
} from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-08: versions of a presentation's content. Changing from 100 to 120
// creates a version and keeps the previous one.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `version.${++counter}.${stamp}@example.test`,
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
      reason: "Prueba de versiones de presentación",
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

/** A product with «Caja = 100». Returns product and presentation ids. */
async function box(owner: CatalogActor, input: { unit?: string } = {}) {
  const sku = `V-${++counter}`;
  const product = await createProduct(owner, {
    sku,
    name: `Producto ${sku}`,
    ...input,
  });
  if (!product.ok) throw new Error("product setup failed");
  const presentation = await createPresentation(owner, product.productId, {
    name: "Caja",
    factor: "100",
  });
  if (!presentation.ok) throw new Error("presentation setup failed");
  return {
    productId: product.productId,
    presentationId: presentation.presentationId,
  };
}

let actor: CatalogActor;

beforeAll(async () => {
  actor = await company();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("changePresentationFactor", () => {
  it("changing from 100 to 120 creates version 2 and keeps version 1", async () => {
    const { productId, presentationId } = await box(actor);
    expect(
      await changePresentationFactor(actor, presentationId, {
        factor: "120",
        reason: "El proveedor cambió el empaque",
      }),
    ).toEqual({ ok: true, presentationId });

    expect(
      (await listPresentationVersions(actor, presentationId)).map((v) => [
        v.version,
        v.factor,
      ]),
    ).toEqual([
      [1, "100"],
      [2, "120"],
    ]);
    // The current content is the newest version.
    expect(await listPresentations(actor, productId)).toMatchObject([
      { name: "Caja", factor: "120", version: 2, label: "Caja = 120 piezas" },
    ]);
    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: actor.organizationId,
        action: "presentation.updated",
        targetId: productId,
      },
    });
    expect(event).toMatchObject({
      actorUserId: actor.userId,
      reason: "El proveedor cambió el empaque",
      metadata: {
        presentation: "Caja",
        version: 2,
        antes: "100 piezas",
        ahora: "120 piezas",
      },
    });
  });

  it("each change adds a version; none is overwritten", async () => {
    const { presentationId } = await box(actor);
    for (const factor of ["120", "144", "100"]) {
      expect(
        (await changePresentationFactor(actor, presentationId, { factor })).ok,
      ).toBe(true);
    }
    const versions = await listPresentationVersions(actor, presentationId);
    expect(versions.map((v) => v.factor)).toEqual(["100", "120", "144", "100"]);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3, 4]);
    expect(versions.every((v) => v.createdByUserId === actor.userId)).toBe(
      true,
    );
  });

  it("a version cannot be edited or deleted, not even with SQL", async () => {
    const { presentationId } = await box(actor);
    await changePresentationFactor(actor, presentationId, { factor: "120" });
    const first = await db.presentationVersion.findFirstOrThrow({
      where: { presentationId, version: 1 },
    });
    await expect(
      db.presentationVersion.update({
        where: { id: first.id },
        data: { factor: "999" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.$executeRaw`UPDATE presentation_version SET factor = 999 WHERE id = ${first.id}`,
    ).rejects.toThrow(/immutable/);
    await expect(
      db.presentationVersion.delete({ where: { id: first.id } }),
    ).rejects.toThrow(/immutable/);
    expect(
      (await listPresentationVersions(actor, presentationId))[0]!.factor,
    ).toBe("100");
  });

  it("the same content is not a new version", async () => {
    const { presentationId } = await box(actor);
    for (const factor of ["100", "100.000", " 100 "]) {
      expect(
        await changePresentationFactor(actor, presentationId, { factor }),
      ).toMatchObject({
        ok: false,
        reason: "unchanged",
        fieldErrors: { factor: "Ese ya es su contenido actual." },
      });
    }
    expect(await listPresentationVersions(actor, presentationId)).toHaveLength(
      1,
    );
  });

  it.each(["0", "-120", "12.5", "abc", ""])(
    "rejects the content %j without creating a version",
    async (factor) => {
      const { presentationId } = await box(actor);
      expect(
        await changePresentationFactor(actor, presentationId, { factor }),
      ).toMatchObject({
        ok: false,
        reason: "invalid",
        fieldErrors: { factor: expect.any(String) },
      });
      expect(
        await listPresentationVersions(actor, presentationId),
      ).toHaveLength(1);
    },
  );

  it("simultaneous changes never repeat or skip a version number", async () => {
    const { presentationId } = await box(actor);
    const results = await Promise.all(
      ["110", "120", "130", "140"].map((factor) =>
        changePresentationFactor(actor, presentationId, { factor }),
      ),
    );
    const applied = results.filter((r) => r.ok).length;
    expect(applied).toBeGreaterThanOrEqual(1);
    for (const refused of results.filter((r) => !r.ok)) {
      expect(refused).toMatchObject({ reason: "conflict" });
    }
    const versions = await listPresentationVersions(actor, presentationId);
    expect(versions.map((v) => v.version)).toEqual(
      Array.from({ length: applied + 1 }, (_, i) => i + 1),
    );
  });

  it("follows the product's unit and increment", async () => {
    const { presentationId, productId } = await box(actor, { unit: "m" });
    expect(
      await changePresentationFactor(actor, presentationId, {
        factor: "91.44",
      }),
    ).toMatchObject({ ok: true });
    expect((await listPresentations(actor, productId))[0]!.label).toBe(
      "Caja = 91.44 metros",
    );
    expect(
      await changePresentationFactor(actor, presentationId, {
        factor: "91.445",
      }),
    ).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("a presentation of an archived or unknown product cannot change", async () => {
    const { productId, presentationId } = await box(actor);
    await archiveProduct(actor, productId);
    for (const id of [presentationId, newId()]) {
      expect(
        await changePresentationFactor(actor, id, { factor: "120" }),
      ).toMatchObject({ ok: false, reason: "not_found" });
    }
  });
});

describe("who can change it", () => {
  it("Almacén can; Comprador and Consulta cannot", async () => {
    const { presentationId } = await box(actor);
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      await changePresentationFactor(warehouse, presentationId, {
        factor: "120",
      }),
    ).toMatchObject({ ok: true });
    for (const role of ["buyer", "viewer"] as const) {
      const other = await member(actor.organizationId, role);
      await expect(
        changePresentationFactor(other, presentationId, { factor: "150" }),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
      expect(
        await listPresentationVersions(other, presentationId),
      ).toHaveLength(2);
    }
  });

  it("another company cannot change or read it", async () => {
    const theirs = await company();
    const { presentationId } = await box(actor);
    expect(
      await changePresentationFactor(theirs, presentationId, { factor: "1" }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await listPresentationVersions(theirs, presentationId)).toEqual([]);
    expect(await listPresentationVersions(actor, presentationId)).toHaveLength(
      1,
    );
  });
});
