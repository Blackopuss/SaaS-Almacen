import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// INV-01: product schema — SKU, name, description, category, brand and
// barcode. The SKU is unique per company.

const stamp = Date.now();
let counter = 0;

async function newCompany() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `producto.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(user.id, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  return created.organizationId;
}

const product = (organizationId: string, sku: string, extra = {}) => ({
  id: newId(),
  organizationId,
  sku,
  name: "Tornillo hexagonal 1/4",
  ...extra,
});

let orgA = "";
let orgB = "";

beforeAll(async () => {
  orgA = await newCompany();
  orgB = await newCompany();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("product", () => {
  it("stores the whole card", async () => {
    const category = await forOrganization(orgA).productCategory.create({
      data: { id: newId(), organizationId: orgA, name: "Tornillería" },
    });
    const brand = await forOrganization(orgA).productBrand.create({
      data: { id: newId(), organizationId: orgA, name: "Truper" },
    });
    const created = await forOrganization(orgA).product.create({
      data: product(orgA, "TOR-001", {
        description: "Galvanizado, caja de 100 piezas.",
        categoryId: category.id,
        brandId: brand.id,
        barcode: "7501234567890",
      }),
      include: { category: true, brand: true },
    });
    expect(created).toMatchObject({
      sku: "TOR-001",
      name: "Tornillo hexagonal 1/4",
      description: "Galvanizado, caja de 100 piezas.",
      barcode: "7501234567890",
      status: "ACTIVE",
      category: { name: "Tornillería" },
      brand: { name: "Truper" },
    });
  });

  it("the SKU is unique in the company, whatever the capitals or accents", async () => {
    for (const sku of ["TOR-001", "tor-001", "Tór-001"]) {
      await expect(
        forOrganization(orgA).product.create({ data: product(orgA, sku) }),
        sku,
      ).rejects.toThrow(/Unique constraint|product_organizationId_sku_key/);
    }
    expect(await forOrganization(orgA).product.count()).toBe(1);
  });

  it("another company can use the same SKU and barcode", async () => {
    await expect(
      forOrganization(orgB).product.create({
        data: product(orgB, "TOR-001", { barcode: "7501234567890" }),
      }),
    ).resolves.toBeTruthy();
    expect(await forOrganization(orgB).product.count()).toBe(1);
    expect(await forOrganization(orgA).product.count()).toBe(1);
  });

  it("a barcode is unique in the company; many products may have none", async () => {
    await expect(
      forOrganization(orgA).product.create({
        data: product(orgA, "TOR-002", { barcode: "7501234567890" }),
      }),
    ).rejects.toThrow();
    await forOrganization(orgA).product.create({
      data: product(orgA, "SIN-CODIGO-1"),
    });
    await forOrganization(orgA).product.create({
      data: product(orgA, "SIN-CODIGO-2"),
    });
    expect(
      await forOrganization(orgA).product.count({ where: { barcode: null } }),
    ).toBe(2);
  });

  it("needs a SKU and a name; an empty barcode is not stored", async () => {
    await expect(
      forOrganization(orgA).product.create({ data: product(orgA, "   ") }),
    ).rejects.toThrow(/product_text_check/);
    await expect(
      forOrganization(orgA).product.create({
        data: { ...product(orgA, "VACIO-1"), name: " " },
      }),
    ).rejects.toThrow(/product_text_check/);
    await expect(
      forOrganization(orgA).product.create({
        data: product(orgA, "VACIO-2", { barcode: "" }),
      }),
    ).rejects.toThrow(/product_text_check/);
  });

  it("cannot use the category or brand of another company", async () => {
    const theirs = await forOrganization(orgB).productCategory.create({
      data: { id: newId(), organizationId: orgB, name: "Pinturas" },
    });
    const brand = await forOrganization(orgB).productBrand.create({
      data: { id: newId(), organizationId: orgB, name: "Comex" },
    });
    await expect(
      forOrganization(orgA).product.create({
        data: product(orgA, "AJENO-1", { categoryId: theirs.id }),
      }),
    ).rejects.toThrow();
    await expect(
      forOrganization(orgA).product.create({
        data: product(orgA, "AJENO-2", { brandId: brand.id }),
      }),
    ).rejects.toThrow();
  });

  it("one company never sees the products of another", async () => {
    const mine = await forOrganization(orgA).product.findMany();
    expect(mine.every((p) => p.organizationId === orgA)).toBe(true);
    const theirs = await forOrganization(orgB).product.findFirstOrThrow();
    expect(
      await forOrganization(orgA).product.findFirst({
        where: { id: theirs.id },
      }),
    ).toBeNull();
    await expect(
      forOrganization(orgA).product.update({
        where: { id: theirs.id },
        data: { name: "Hackeado" },
      }),
    ).rejects.toThrow();
  });

  it("has no quantity: stock is not a field of the card", async () => {
    const row = await forOrganization(orgA).product.findFirstOrThrow();
    expect(Object.keys(row).sort()).toEqual([
      "barcode",
      "brandId",
      "categoryId",
      "createdAt",
      "description",
      "id",
      "name",
      "organizationId",
      "sku",
      "status",
      "updatedAt",
    ]);
  });
});

describe("categories and brands", () => {
  it("names are unique in the company, whatever the capitals", async () => {
    await expect(
      forOrganization(orgA).productCategory.create({
        data: { id: newId(), organizationId: orgA, name: "tornillería" },
      }),
    ).rejects.toThrow();
    await expect(
      forOrganization(orgA).productBrand.create({
        data: { id: newId(), organizationId: orgA, name: "TRUPER" },
      }),
    ).rejects.toThrow();
    await expect(
      forOrganization(orgB).productCategory.create({
        data: { id: newId(), organizationId: orgB, name: "Tornillería" },
      }),
    ).resolves.toBeTruthy();
  });

  it("a category or brand in use cannot be deleted", async () => {
    const category = await forOrganization(
      orgA,
    ).productCategory.findFirstOrThrow({ where: { name: "Tornillería" } });
    await expect(
      forOrganization(orgA).productCategory.delete({
        where: { id: category.id },
      }),
    ).rejects.toThrow();
  });

  it("an empty name is rejected", async () => {
    await expect(
      forOrganization(orgA).productCategory.create({
        data: { id: newId(), organizationId: orgA, name: "  " },
      }),
    ).rejects.toThrow(/product_category_name_check/);
  });
});
