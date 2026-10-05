import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { type Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import {
  createProduct,
  listProductGroups,
  listProducts,
} from "@/platform/catalog";
import { getQuotaUsage, invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// INV-02: every new product goes through one service that takes a place of
// the quota. With 100 of 100, the next one is rejected.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `alta.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

/** Company with Inventario and a product quota. */
async function company(productLimit: number | null = 100) {
  const owner = await newUser();
  const created = await createOrganization(owner, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const organizationId = created.organizationId;
  if (productLimit !== null) {
    if (!staff) {
      staff = await newUser();
      await db.platformStaff.create({ data: { userId: staff } });
    }
    const result = await provisionCompany(
      moduleRegistry,
      staff,
      organizationId,
      {
        productLimit,
        users: 10,
        modules: ["inventory"],
        validUntil: null,
        reason: "Prueba de altas de producto",
      },
    );
    if (!result.ok) throw new Error("provision failed");
  }
  return { organizationId, userId: owner };
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

const tornillo = (sku = `TOR-${++counter}`) => ({
  sku,
  name: "Tornillo hexagonal 1/4",
});

const used = async (organizationId: string) =>
  (await getQuotaUsage(organizationId, "active_products")).used;

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("createProduct", () => {
  it("creates the product, takes one place and records it", async () => {
    const actor = await company();
    const result = await createProduct(actor, {
      sku: "  TOR-001 ",
      name: " Tornillo hexagonal 1/4 ",
      description: "Galvanizado.",
      category: "Tornillería",
      brand: "Truper",
      barcode: " 7501234567890 ",
    });
    if (!result.ok) throw new Error("expected ok");

    const stored = await db.product.findUniqueOrThrow({
      where: { id: result.productId },
      include: { category: true, brand: true },
    });
    expect(stored).toMatchObject({
      organizationId: actor.organizationId,
      sku: "TOR-001",
      name: "Tornillo hexagonal 1/4",
      description: "Galvanizado.",
      barcode: "7501234567890",
      status: "ACTIVE",
      category: { name: "Tornillería" },
      brand: { name: "Truper" },
    });
    expect(await used(actor.organizationId)).toBe(1);
    const event = await db.auditEvent.findFirstOrThrow({
      where: {
        organizationId: actor.organizationId,
        action: "product.created",
      },
    });
    expect(event).toMatchObject({
      actorUserId: actor.userId,
      targetId: result.productId,
      metadata: { sku: "TOR-001", name: "Tornillo hexagonal 1/4" },
    });
  });

  it("with 100 of 100 the next product is rejected and nothing is written", async () => {
    const actor = await company(100);
    for (let i = 0; i < 100; i++) {
      const result = await createProduct(actor, tornillo(`LLENO-${i}`));
      if (!result.ok) throw new Error(`setup failed at ${i}`);
    }
    expect(await used(actor.organizationId)).toBe(100);

    expect(
      await createProduct(actor, {
        ...tornillo("UNO-MAS"),
        category: "Nueva categoría",
      }),
    ).toEqual({
      ok: false,
      reason: "limit_reached",
      fieldErrors: {},
      formError:
        "Llegaste al límite de tu plan: 100 de 100 productos activos. Archiva productos que ya no uses o pide un nivel mayor.",
    });
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(100);
    expect(await used(actor.organizationId)).toBe(100);
    // Not even the category of the rejected product stays.
    expect(
      await db.productCategory.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  }, 60_000);

  it("with one place left, simultaneous products allow exactly one", async () => {
    const actor = await company(1);
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        createProduct(actor, tornillo(`CARRERA-${i}`)),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      await db.product.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(1);
    expect(await used(actor.organizationId)).toBe(1);
  });

  it("a repeated SKU is refused without taking a place, whatever the capitals", async () => {
    const actor = await company();
    await createProduct(actor, tornillo("REP-001"));
    for (const sku of ["REP-001", "rep-001"]) {
      expect(await createProduct(actor, tornillo(sku))).toMatchObject({
        ok: false,
        reason: "duplicate",
        fieldErrors: { sku: expect.stringContaining("esa clave") },
      });
    }
    expect(await used(actor.organizationId)).toBe(1);
  });

  it("the same SKU sent twice at once creates one product and takes one place", async () => {
    const actor = await company();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createProduct(actor, tornillo("DOBLE-1")),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(
      results
        .filter((r) => !r.ok)
        .every((r) => !r.ok && r.reason === "duplicate"),
    ).toBe(true);
    expect(await used(actor.organizationId)).toBe(1);
  });

  it("a repeated barcode is refused", async () => {
    const actor = await company();
    await createProduct(actor, { ...tornillo(), barcode: "750000000001" });
    expect(
      await createProduct(actor, { ...tornillo(), barcode: "750000000001" }),
    ).toMatchObject({
      ok: false,
      reason: "duplicate",
      fieldErrors: { barcode: expect.any(String) },
    });
    expect(await used(actor.organizationId)).toBe(1);
  });

  it("validates the card and explains each field", async () => {
    const actor = await company();
    expect(
      await createProduct(actor, {
        sku: "   ",
        name: "X",
        description: "x".repeat(2001),
        barcode: "a".repeat(65),
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: {
        sku: "Escribe la clave del producto (SKU).",
        name: expect.any(String),
        description: expect.any(String),
        barcode: expect.any(String),
      },
    });
    expect(
      await createProduct(actor, { sku: "A\tB", name: "Con tabulador" }),
    ).toMatchObject({ ok: false, fieldErrors: { sku: expect.any(String) } });
    expect(await used(actor.organizationId)).toBe(0);
  });

  it("reuses an existing category and brand instead of duplicating them", async () => {
    const actor = await company();
    await createProduct(actor, {
      ...tornillo(),
      category: "Pinturas",
      brand: "Comex",
    });
    await createProduct(actor, {
      ...tornillo(),
      category: "pinturas",
      brand: "COMEX",
    });
    expect(await listProductGroups(actor)).toEqual({
      categories: ["Pinturas"],
      brands: ["Comex"],
    });
  });

  it("empty optional fields are stored as nothing", async () => {
    const actor = await company();
    const result = await createProduct(actor, {
      ...tornillo(),
      description: "  ",
      category: "",
      brand: " ",
      barcode: "",
    });
    if (!result.ok) throw new Error("expected ok");
    expect(
      await db.product.findUniqueOrThrow({ where: { id: result.productId } }),
    ).toMatchObject({
      description: null,
      categoryId: null,
      brandId: null,
      barcode: null,
    });
  });
});

describe("who can create products", () => {
  it("Almacén and Administrador can; Comprador and Consulta cannot", async () => {
    const owner = await company();
    for (const role of ["warehouse", "administrator"] as const) {
      const actor = await member(owner.organizationId, role);
      expect((await createProduct(actor, tornillo())).ok, role).toBe(true);
    }
    for (const role of ["buyer", "viewer"] as const) {
      const actor = await member(owner.organizationId, role);
      await expect(
        createProduct(actor, tornillo()),
        role,
      ).rejects.toMatchObject({ code: "permission_denied" });
      // They can still look at the catalog.
      expect((await listProducts(actor)).items.length).toBe(2);
    }
    expect(await used(owner.organizationId)).toBe(2);
  });

  it("a company without a plan cannot create products", async () => {
    const actor = await company(null);
    await expect(createProduct(actor, tornillo())).rejects.toMatchObject({
      code: "module_not_contracted",
    });
  });

  it("with the plan expired products can be seen but not created", async () => {
    const actor = await company();
    await createProduct(actor, tornillo());
    await db.entitlement.updateMany({
      where: { organizationId: actor.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(actor.organizationId);
    await expect(createProduct(actor, tornillo())).rejects.toMatchObject({
      code: "module_read_only",
    });
    expect((await listProducts(actor)).items).toHaveLength(1);
  });

  it("someone of another company cannot create or see products here", async () => {
    const mine = await company();
    const theirs = await company();
    await createProduct(mine, tornillo("PROPIO-1"));
    const intruder = {
      organizationId: mine.organizationId,
      userId: theirs.userId,
    };
    await expect(createProduct(intruder, tornillo())).rejects.toMatchObject({
      code: "permission_denied",
    });
    await expect(listProducts(intruder)).rejects.toMatchObject({
      code: "permission_denied",
    });
    expect((await listProducts(theirs)).items).toEqual([]);
    // Each company counts its own products.
    await createProduct(theirs, tornillo("PROPIO-1"));
    expect(await used(mine.organizationId)).toBe(1);
    expect(await used(theirs.organizationId)).toBe(1);
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === "generated" ? [] : sources(full);
    }
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [full] : [];
  });
}

describe("one way in", () => {
  it("only the catalog service creates products", () => {
    const creators = sources(path.join(process.cwd(), "src")).filter((file) =>
      /\bproduct\s*\.\s*(create|createMany|upsert)\s*\(/.test(
        readFileSync(file, "utf8"),
      ),
    );
    expect(creators.map((file) => path.basename(file))).toEqual([
      "products.ts",
    ]);
  });
});
