import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { listAuditTrail } from "@/platform/audit";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createProduct,
  getProduct,
  listProducts,
  reactivateProduct,
  updateProduct,
  type CatalogActor,
} from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-04: archiving frees a place of the quota; reactivating takes one;
// the history stays.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `archivo.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(productLimit = 3): Promise<CatalogActor> {
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
      productLimit,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de archivo de productos",
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

async function newProduct(actor: CatalogActor, sku = `P-${++counter}`) {
  const result = await createProduct(actor, { sku, name: `Producto ${sku}` });
  if (!result.ok) throw new Error(`product setup failed: ${result.reason}`);
  return result.productId;
}

const used = async (actor: CatalogActor) =>
  (await getQuotaUsage(actor.organizationId, "active_products")).used;

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("archiveProduct", () => {
  it("frees a place that a new product can take", async () => {
    const actor = await company(2);
    const first = await newProduct(actor);
    await newProduct(actor);
    expect(
      (await createProduct(actor, { sku: "NO-CABE", name: "No cabe" })).ok,
    ).toBe(false);

    expect(await archiveProduct(actor, first, "Descontinuado")).toEqual({
      ok: true,
    });
    expect(await used(actor)).toBe(1);
    expect((await getProduct(actor, first))?.status).toBe("ARCHIVED");
    expect(
      (await createProduct(actor, { sku: "YA-CABE", name: "Ya cabe" })).ok,
    ).toBe(true);
    expect(await used(actor)).toBe(2);
  });

  it("keeps the card and its history; nothing is deleted", async () => {
    const actor = await company();
    const id = await newProduct(actor, "HIST-1");
    await updateProduct(actor, id, { sku: "HIST-1", name: "Con historia" });
    await archiveProduct(actor, id, "  Ya no se vende  ");

    expect(await getProduct(actor, id)).toMatchObject({
      sku: "HIST-1",
      name: "Con historia",
      status: "ARCHIVED",
    });
    const trail = (await listAuditTrail(actor.organizationId))
      .filter((e) => e.action.startsWith("product."))
      .reverse();
    expect(trail.map((e) => e.action)).toEqual([
      "product.created",
      "product.updated",
      "product.archived",
    ]);
    expect(trail[2]).toMatchObject({
      label: "Archivó un producto",
      reason: "Ya no se vende",
    });
    // Its code stays taken: the archived product still exists.
    expect(
      await createProduct(actor, { sku: "hist-1", name: "Otro" }),
    ).toMatchObject({ ok: false, reason: "duplicate" });
  });

  it("leaves the list of active products and appears among the archived", async () => {
    const actor = await company();
    const id = await newProduct(actor, "LISTA-1");
    await newProduct(actor, "LISTA-2");
    await archiveProduct(actor, id);
    expect((await listProducts(actor)).items.map((p) => p.sku)).toEqual([
      "LISTA-2",
    ]);
    expect(
      (await listProducts(actor, { status: "ARCHIVED" })).items.map(
        (p) => p.sku,
      ),
    ).toEqual(["LISTA-1"]);
  });

  it("archiving twice, even at once, frees one place", async () => {
    const actor = await company();
    const id = await newProduct(actor);
    await newProduct(actor);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => archiveProduct(actor, id)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await used(actor)).toBe(1);
    expect(await archiveProduct(actor, id)).toMatchObject({
      ok: false,
      reason: "unchanged",
    });
    expect(await used(actor)).toBe(1);
  });

  it("an unknown product or one of another company is not found", async () => {
    const mine = await company();
    const theirs = await company();
    const id = await newProduct(theirs);
    for (const productId of [id, newId()]) {
      expect(await archiveProduct(mine, productId)).toMatchObject({
        ok: false,
        reason: "not_found",
      });
    }
    expect((await getProduct(theirs, id))?.status).toBe("ACTIVE");
    expect(await used(theirs)).toBe(1);
  });
});

describe("reactivateProduct", () => {
  it("takes a place again and records it", async () => {
    const actor = await company();
    const id = await newProduct(actor);
    await archiveProduct(actor, id);
    expect(await used(actor)).toBe(0);
    expect(await reactivateProduct(actor, id)).toEqual({ ok: true });
    expect(await used(actor)).toBe(1);
    expect((await getProduct(actor, id))?.status).toBe("ACTIVE");
    expect(
      await db.auditEvent.count({
        where: { action: "product.reactivated", targetId: id },
      }),
    ).toBe(1);
  });

  it("is refused when the plan is full, and the product stays archived", async () => {
    const actor = await company(2);
    const id = await newProduct(actor);
    await newProduct(actor);
    await archiveProduct(actor, id);
    await newProduct(actor);
    expect(await reactivateProduct(actor, id)).toEqual({
      ok: false,
      reason: "limit_reached",
      error: expect.stringContaining("2 de 2 productos activos"),
    });
    expect((await getProduct(actor, id))?.status).toBe("ARCHIVED");
    expect(await used(actor)).toBe(2);
    expect(
      await db.auditEvent.count({
        where: { action: "product.reactivated", targetId: id },
      }),
    ).toBe(0);
  });

  it("with one place left, two archived products reactivated at once allow one", async () => {
    const actor = await company(2);
    const a = await newProduct(actor);
    const b = await newProduct(actor);
    await archiveProduct(actor, a);
    await archiveProduct(actor, b);
    await newProduct(actor);
    const results = await Promise.all([
      reactivateProduct(actor, a),
      reactivateProduct(actor, b),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await used(actor)).toBe(2);
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId, status: "ACTIVE" },
      }),
    ).toBe(2);
  });

  it("reactivating the same product several times at once takes one place", async () => {
    const actor = await company();
    const id = await newProduct(actor);
    await archiveProduct(actor, id);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reactivateProduct(actor, id)),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await used(actor)).toBe(1);
    expect(await reactivateProduct(actor, id)).toMatchObject({
      ok: false,
      reason: "unchanged",
    });
  });
});

describe("who can archive and reactivate", () => {
  it("Almacén can; Comprador and Consulta cannot", async () => {
    const owner = await company();
    const id = await newProduct(owner);
    for (const role of ["buyer", "viewer"] as const) {
      const actor = await member(owner.organizationId, role);
      await expect(archiveProduct(actor, id), role).rejects.toMatchObject({
        code: "permission_denied",
      });
    }
    const warehouse = await member(owner.organizationId, "warehouse");
    expect(await archiveProduct(warehouse, id)).toEqual({ ok: true });
    const buyer = await member(owner.organizationId, "buyer");
    await expect(reactivateProduct(buyer, id)).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect(await reactivateProduct(warehouse, id)).toEqual({ ok: true });
  });

  it("with the plan expired nothing is archived or reactivated", async () => {
    const actor = await company();
    const active = await newProduct(actor);
    const archived = await newProduct(actor);
    await archiveProduct(actor, archived);
    await db.entitlement.updateMany({
      where: { organizationId: actor.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(actor.organizationId);
    await expect(archiveProduct(actor, active)).rejects.toMatchObject({
      code: "module_read_only",
    });
    await expect(reactivateProduct(actor, archived)).rejects.toMatchObject({
      code: "module_read_only",
    });
  });
});
