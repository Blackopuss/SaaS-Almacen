import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  getProductSupplier,
  linkProductSupplier,
  listProductsOfSupplier,
  listSuppliersOfProduct,
  recordLastCost,
  updateProductSupplier,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  changePresentationFactor,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// CMP-03: which supplier sells which product — the supplier's code, the
// presentation of purchase and the last cost.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `prodprov.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(
  modules: string[] = ["inventory", "purchasing"],
): Promise<PurchasingActor> {
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
      modules,
      validUntil: null,
      reason: "Prueba de producto-proveedor",
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

async function product(actor: PurchasingActor, sku: string, unit = "piece") {
  const created = await createProduct(actor, {
    sku,
    name: `Producto ${sku}`,
    unit,
  });
  if (!created.ok) throw new Error("product setup failed");
  return created.productId;
}

async function box(actor: PurchasingActor, productId: string, factor = "100") {
  const created = await createPresentation(actor, productId, {
    name: "Caja",
    factor,
  });
  if (!created.ok) throw new Error("presentation setup failed");
  return created.presentationId;
}

async function supplier(actor: PurchasingActor, name: string) {
  const created = await createSupplier(actor, { name });
  if (!created.ok) throw new Error("supplier setup failed");
  return created.supplierId;
}

async function linked(
  actor: PurchasingActor,
  productId: string,
  supplierId: string,
  extra: { supplierSku?: string; presentationId?: string } = {},
) {
  const result = await linkProductSupplier(actor, {
    productId,
    supplierId,
    ...extra,
  });
  if (!result.ok) throw new Error(`link failed: ${result.reason}`);
  return result.linkId;
}

/** Latest version of a presentation, as a purchase would name it. */
async function versionOf(presentationId: string) {
  const version = await db.presentationVersion.findFirstOrThrow({
    where: { presentationId },
    orderBy: { version: "desc" },
  });
  return { presentationId, versionId: version.id };
}

const costed = (
  actor: PurchasingActor,
  input: Parameters<typeof recordLastCost>[1],
) =>
  forOrganization(actor.organizationId).$transaction((tx) =>
    recordLastCost(tx, input),
  );

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("linkProductSupplier", () => {
  it("keeps the supplier's code and the presentation it is bought in", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const caja = await box(actor, tornillo);
    const norte = await supplier(actor, "Ferretera del Norte");
    const linkId = await linked(actor, tornillo, norte, {
      supplierSku: "  FN-88213  ",
      presentationId: caja,
    });

    const expected = {
      id: linkId,
      productId: tornillo,
      sku: "TOR-1",
      productName: "Producto TOR-1",
      productArchived: false,
      supplierId: norte,
      supplierName: "Ferretera del Norte",
      supplierArchived: false,
      supplierSku: "FN-88213",
      presentation: { id: caja, name: "Caja", text: "caja de 100 piezas" },
      unitName: "pieza",
      lastCost: null,
    };
    expect(await getProductSupplier(actor, linkId)).toEqual(expected);
    expect(await listProductsOfSupplier(actor, norte)).toEqual({
      items: [expected],
      total: 1,
      page: 1,
      pageCount: 1,
      costsVisible: true,
    });
    expect((await listSuppliersOfProduct(actor, tornillo)).items).toEqual([
      expected,
    ]);
    expect(
      await db.auditEvent.findFirst({
        where: { action: "product_supplier.created", targetId: linkId },
      }),
    ).toMatchObject({
      actorUserId: actor.userId,
      metadata: { producto: "TOR-1", proveedor: "Ferretera del Norte" },
    });
  });

  it("code and presentation are optional; a product can have several suppliers", async () => {
    const actor = await company();
    const cable = await product(actor, "CAB-2", "m");
    const norte = await supplier(actor, "Ferretera del Norte");
    const sur = await supplier(actor, "Ferretera del Sur");
    await linked(actor, cable, norte);
    await linked(actor, cable, sur, { supplierSku: "S-1" });
    const suppliers = await listSuppliersOfProduct(actor, cable);
    expect(
      suppliers.items.map((item) => [
        item.supplierName,
        item.supplierSku,
        item.presentation,
        item.unitName,
      ]),
    ).toEqual([
      ["Ferretera del Norte", null, null, "metro"],
      ["Ferretera del Sur", "S-1", null, "metro"],
    ]);
  });

  it("one link per product and supplier", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const norte = await supplier(actor, "Ferretera del Norte");
    await linked(actor, tornillo, norte);
    const again = await linkProductSupplier(actor, {
      productId: tornillo,
      supplierId: norte,
      supplierSku: "OTRO",
    });
    expect(again).toMatchObject({ ok: false, reason: "duplicate" });
    expect(!again.ok && again.formError).toContain("ya está vinculado");
    // At the same moment, too: the database keeps one.
    const clavo = await product(actor, "CLA-2");
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        linkProductSupplier(actor, { productId: clavo, supplierId: norte }),
      ),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      await db.productSupplier.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(2);
  });

  it("product, supplier and presentation must be usable and of the company", async () => {
    const actor = await company();
    const theirs = await company();
    const tornillo = await product(actor, "TOR-1");
    const clavo = await product(actor, "CLA-2");
    const otherBox = await box(actor, clavo);
    const archived = await product(actor, "VIE-3");
    await archiveProduct(actor, archived);
    const norte = await supplier(actor, "Ferretera del Norte");
    const gone = await supplier(actor, "Ya no surte");
    await db.contact.update({
      where: { id: gone },
      data: { archivedAt: new Date() },
    });
    const customer = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Solo cliente",
        isCustomer: true,
        createdByUserId: actor.userId,
      },
    });
    const foreignProduct = await product(theirs, "AJENO-1");
    const foreignSupplier = await supplier(theirs, "Proveedor ajeno");

    const attempt = (input: Parameters<typeof linkProductSupplier>[1]) =>
      linkProductSupplier(actor, input);
    expect(await attempt({ productId: "", supplierId: "" })).toMatchObject({
      reason: "invalid",
      fieldErrors: {
        productId: "Elige el producto.",
        supplierId: "Elige el proveedor.",
      },
    });
    for (const productId of [foreignProduct, newId()]) {
      expect(await attempt({ productId, supplierId: norte })).toMatchObject({
        reason: "not_found",
        fieldErrors: { productId: "Ese producto ya no existe." },
      });
    }
    expect(
      await attempt({ productId: archived, supplierId: norte }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { productId: expect.stringContaining("archivado") },
    });
    for (const supplierId of [foreignSupplier, customer.id, newId()]) {
      expect(await attempt({ productId: tornillo, supplierId })).toMatchObject({
        reason: "not_found",
        fieldErrors: { supplierId: "Ese proveedor ya no existe." },
      });
    }
    expect(
      await attempt({ productId: tornillo, supplierId: gone }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { supplierId: expect.stringContaining("archivado") },
    });
    // The box of another product is not a way to buy this one.
    expect(
      await attempt({
        productId: tornillo,
        supplierId: norte,
        presentationId: otherBox,
      }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: {
        presentationId: expect.stringContaining("no es de este producto"),
      },
    });
    expect(
      await attempt({
        productId: tornillo,
        supplierId: norte,
        supplierSku: "x".repeat(65),
      }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { supplierSku: expect.any(String) },
    });
    expect(
      await db.productSupplier.count({
        where: {
          organizationId: {
            in: [actor.organizationId, theirs.organizationId],
          },
        },
      }),
    ).toBe(0);
  });
});

describe("updateProductSupplier", () => {
  it("changes code and presentation, and never the content of the catalog", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const caja = await box(actor, tornillo);
    const clavo = await product(actor, "CLA-2");
    const otherBox = await box(actor, clavo);
    const norte = await supplier(actor, "Ferretera del Norte");
    const linkId = await linked(actor, tornillo, norte);

    expect(
      await updateProductSupplier(actor, linkId, {
        supplierSku: "FN-1",
        presentationId: caja,
      }),
    ).toEqual({ ok: true, linkId });
    expect(await getProductSupplier(actor, linkId)).toMatchObject({
      supplierSku: "FN-1",
      presentation: { id: caja, text: "caja de 100 piezas" },
    });
    expect(
      await updateProductSupplier(actor, linkId, {
        supplierSku: "FN-1",
        presentationId: otherBox,
      }),
    ).toMatchObject({
      reason: "invalid",
      fieldErrors: { presentationId: expect.any(String) },
    });
    // Saving the same leaves no trace; emptying both clears them.
    await updateProductSupplier(actor, linkId, {
      supplierSku: " FN-1 ",
      presentationId: caja,
    });
    expect(
      await db.auditEvent.count({
        where: { action: "product_supplier.updated", targetId: linkId },
      }),
    ).toBe(1);
    await updateProductSupplier(actor, linkId, {});
    expect(await getProductSupplier(actor, linkId)).toMatchObject({
      supplierSku: null,
      presentation: null,
    });
    // The catalog was not touched: the box still has its only version.
    expect(
      await db.presentationVersion.count({ where: { presentationId: caja } }),
    ).toBe(1);
  });

  it("reaches only links of the company", async () => {
    const ours = await company();
    const theirs = await company();
    const foreign = await linked(
      theirs,
      await product(theirs, "X-1"),
      await supplier(theirs, "Ajeno"),
      { supplierSku: "SECRETO" },
    );
    for (const id of [foreign, newId(), "no-es-un-id"]) {
      expect(await getProductSupplier(ours, id)).toBeNull();
      expect(
        await updateProductSupplier(ours, id, { supplierSku: "CAMBIADO" }),
      ).toMatchObject({ ok: false, reason: "not_found" });
    }
    expect((await getProductSupplier(theirs, foreign))!.supplierSku).toBe(
      "SECRETO",
    );
    const mine = await supplier(ours, "Nuestro");
    expect((await listProductsOfSupplier(ours, mine)).items).toEqual([]);
    expect((await listProductsOfSupplier(ours, foreign)).items).toEqual([]);
  });
});

describe("last cost", () => {
  it("is written by a purchase and says what it was for", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const caja = await box(actor, tornillo);
    const cable = await product(actor, "CAB-2", "m");
    const norte = await supplier(actor, "Ferretera del Norte");
    const byBox = await linked(actor, tornillo, norte, {
      presentationId: caja,
    });
    const byMetre = await linked(actor, cable, norte);

    const when = new Date("2026-10-09T18:30:00.000Z");
    expect(
      await costed(actor, {
        productId: tornillo,
        supplierId: norte,
        cost: "250.5",
        presentationVersion: await versionOf(caja),
        at: when,
      }),
    ).toBe(true);
    expect(
      await costed(actor, {
        productId: cable,
        supplierId: norte,
        cost: "18.7525",
        presentationVersion: null,
      }),
    ).toBe(true);

    expect((await getProductSupplier(actor, byBox))!.lastCost).toEqual({
      amount: "250.5",
      text: "$250.50 por caja de 100 piezas",
      at: when,
    });
    expect((await getProductSupplier(actor, byMetre))!.lastCost).toMatchObject({
      amount: "18.7525",
      text: "$18.7525 por metro",
    });

    // The box changes afterwards: the cost still says what was bought.
    await changePresentationFactor(actor, caja, {
      factor: "120",
      reason: "Nuevo empaque",
    });
    expect(await getProductSupplier(actor, byBox)).toMatchObject({
      presentation: { text: "caja de 120 piezas" },
      lastCost: { text: "$250.50 por caja de 100 piezas" },
    });
    // A newer purchase replaces it.
    await costed(actor, {
      productId: tornillo,
      supplierId: norte,
      cost: "1,234.00".replace(",", ""),
      presentationVersion: await versionOf(caja),
    });
    expect((await getProductSupplier(actor, byBox))!.lastCost).toMatchObject({
      amount: "1234",
      text: "$1,234.00 por caja de 120 piezas",
    });
  });

  it("refuses a cost that is not one, and a version of another product", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const clavo = await product(actor, "CLA-2");
    const otherBox = await box(actor, clavo);
    const norte = await supplier(actor, "Ferretera del Norte");
    const linkId = await linked(actor, tornillo, norte);
    const base = {
      productId: tornillo,
      supplierId: norte,
      presentationVersion: null,
    };
    for (const cost of ["-1", "1.00001", "99999999999"]) {
      await expect(costed(actor, { ...base, cost }), cost).rejects.toThrow();
    }
    await expect(
      costed(actor, {
        ...base,
        cost: "10",
        presentationVersion: await versionOf(otherBox),
      }),
    ).rejects.toThrow("not of the product");
    // A pair that is not linked gets no cost.
    expect(
      await costed(actor, {
        productId: clavo,
        supplierId: norte,
        cost: "10",
        presentationVersion: null,
      }),
    ).toBe(false);
    expect((await getProductSupplier(actor, linkId))!.lastCost).toBeNull();
    // Zero is a cost (a sample, a gift).
    expect(await costed(actor, { ...base, cost: "0" })).toBe(true);
    expect((await getProductSupplier(actor, linkId))!.lastCost).toMatchObject({
      text: "$0.00 por pieza",
    });
  });

  it("never leaves the service for who may not see costs (NEG-04)", async () => {
    const actor = await company();
    const tornillo = await product(actor, "TOR-1");
    const norte = await supplier(actor, "Ferretera del Norte");
    const linkId = await linked(actor, tornillo, norte, {
      supplierSku: "FN-1",
    });
    await costed(actor, {
      productId: tornillo,
      supplierId: norte,
      cost: "987.65",
      presentationVersion: null,
    });

    const viewer = await member(actor.organizationId, "viewer");
    const seen = [
      await getProductSupplier(viewer, linkId),
      ...(await listProductsOfSupplier(viewer, norte)).items,
      ...(await listSuppliersOfProduct(viewer, tornillo)).items,
    ];
    expect(seen).toHaveLength(3);
    for (const link of seen) {
      // Consulta sees the link and its code…
      expect(link).toMatchObject({ sku: "TOR-1", supplierSku: "FN-1" });
      // …but not a trace of the cost: no field, no number anywhere.
      expect(link && "lastCost" in link).toBe(false);
      expect(JSON.stringify(link)).not.toContain("987");
    }
    expect((await listProductsOfSupplier(viewer, norte)).costsVisible).toBe(
      false,
    );
    // Compras does see it.
    const buyer = await member(actor.organizationId, "buyer");
    expect((await getProductSupplier(buyer, linkId))!.lastCost).toMatchObject({
      amount: "987.65",
    });
    // Almacén has no way in at all.
    const warehouse = await member(actor.organizationId, "warehouse");
    await expect(getProductSupplier(warehouse, linkId)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(
      listSuppliersOfProduct(warehouse, tornillo),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("who may", () => {
  it("follows the matrix, and needs the Compras module", async () => {
    const actor = await company();
    const norte = await supplier(actor, "Ferretera del Norte");
    const linkId = await linked(actor, await product(actor, "BASE-0"), norte);
    let n = 0;
    const can = async (person: PurchasingActor) => {
      const productId = await product(actor, `P-${++n}`);
      return {
        read: await listProductsOfSupplier(person, norte).then(
          () => true,
          () => false,
        ),
        create: await linkProductSupplier(person, {
          productId,
          supplierId: norte,
        }).then(
          (result) => result.ok,
          () => false,
        ),
        update: await updateProductSupplier(person, linkId, {
          supplierSku: `C-${n}`,
        }).then(
          (result) => result.ok,
          () => false,
        ),
      };
    };
    const all = { read: true, create: true, update: true };
    expect(await can(actor)).toEqual(all);
    expect(
      await can(await member(actor.organizationId, "administrator")),
    ).toEqual(all);
    expect(await can(await member(actor.organizationId, "buyer"))).toEqual(all);
    expect(await can(await member(actor.organizationId, "viewer"))).toEqual({
      read: true,
      create: false,
      update: false,
    });
    expect(await can(await member(actor.organizationId, "warehouse"))).toEqual({
      read: false,
      create: false,
      update: false,
    });

    const without = await company(["inventory"]);
    await expect(
      listSuppliersOfProduct(without, await product(without, "X-1")),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});
