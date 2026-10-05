import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  PRODUCT_PAGE_SIZE,
  archiveProduct,
  createProduct,
  listProducts,
  type CatalogActor,
} from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { migratorConnection } from "../setup/test-db";

// INV-10: the list of products is cut into pages by the database. With
// 10,000 products each page brings only its rows.

const stamp = Date.now();
const TOTAL = 10_000;
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `lista.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(productLimit = 20_000): Promise<CatalogActor> {
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
      reason: "Prueba de la lista de productos",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

/** Name of the n-th bulk product; zero-padded so names sort like numbers. */
const bulkName = (n: number) => `Producto ${String(n).padStart(5, "0")}`;

/**
 * Loads many products directly: going through `createProduct` 10,000 times
 * would only slow the test down. The list does not depend on the quota.
 */
async function bulkProducts(organizationId: string, total: number) {
  const connection = await migratorConnection();
  try {
    for (let start = 1; start <= total; start += 1_000) {
      const rows = [];
      for (let n = start; n < start + 1_000 && n <= total; n++) {
        rows.push([newId(), organizationId, `B-${n}`, bulkName(n)]);
      }
      await connection.batch(
        "INSERT INTO product (id, organizationId, sku, name, updatedAt) VALUES (?, ?, ?, ?, NOW(3))",
        rows,
      );
    }
  } finally {
    await connection.end();
  }
}

afterAll(async () => {
  await db.$disconnect();
});

describe("listProducts with 10,000 products", () => {
  let actor: CatalogActor;

  beforeAll(async () => {
    actor = await company();
    await bulkProducts(actor.organizationId, TOTAL);
  }, 120_000);

  it("the first page brings only its rows and the total", async () => {
    const page = await listProducts(actor);
    expect(page).toMatchObject({
      total: TOTAL,
      page: 1,
      pageSize: PRODUCT_PAGE_SIZE,
      pageCount: TOTAL / PRODUCT_PAGE_SIZE,
    });
    expect(page.items).toHaveLength(PRODUCT_PAGE_SIZE);
    expect(page.items[0]?.name).toBe(bulkName(1));
    expect(page.items.at(-1)?.name).toBe(bulkName(PRODUCT_PAGE_SIZE));
  });

  it("consecutive pages follow each other without repeating or skipping", async () => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const page of [1, 2, 3, 199, 200, 201]) {
      const result = await listProducts(actor, { page });
      expect(result.page).toBe(page);
      for (const item of result.items) {
        expect(seen.has(item.id), item.name).toBe(false);
        seen.add(item.id);
        names.push(item.name);
      }
    }
    expect(names.slice(0, 75)).toEqual(
      Array.from({ length: 75 }, (_, i) => bulkName(i + 1)),
    );
    // Page 199 starts after 198 full pages.
    expect(names[75]).toBe(bulkName(198 * PRODUCT_PAGE_SIZE + 1));
  });

  it("the last page ends the list and a page past the end becomes the last", async () => {
    const lastPage = TOTAL / PRODUCT_PAGE_SIZE;
    const last = await listProducts(actor, { page: lastPage });
    expect(last.items).toHaveLength(PRODUCT_PAGE_SIZE);
    expect(last.items.at(-1)?.name).toBe(bulkName(TOTAL));
    const beyond = await listProducts(actor, { page: 999_999 });
    expect(beyond.page).toBe(lastPage);
    expect(beyond.items.map((p) => p.id)).toEqual(last.items.map((p) => p.id));
  });

  it("a page that is not a positive whole number is the first", async () => {
    for (const page of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = await listProducts(actor, { page });
      expect(result.page, String(page)).toBe(1);
      expect(result.items[0]?.name).toBe(bulkName(1));
    }
  });

  it("the page size is bounded", async () => {
    expect((await listProducts(actor, { pageSize: 5_000 })).items).toHaveLength(
      100,
    );
    expect((await listProducts(actor, { pageSize: 0 })).items).toHaveLength(1);
  });

  it("any page answers quickly, also deep in the list", async () => {
    await listProducts(actor, { page: 2 });
    const started = performance.now();
    await listProducts(actor, { page: 390 });
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("the database walks the index of company, status and name, without sorting", async () => {
    const connection = await migratorConnection();
    try {
      const plan = (await connection.query(
        "EXPLAIN SELECT id FROM product WHERE organizationId = ? AND status = 'ACTIVE' ORDER BY name, id LIMIT 25 OFFSET 5000",
        [actor.organizationId],
      )) as { key: string; Extra: string | null }[];
      expect(plan[0]?.key).toBe("product_organizationId_status_name_idx");
      expect(plan[0]?.Extra ?? "").not.toContain("filesort");
    } finally {
      await connection.end();
    }
  });

  it("archived products are a separate list", async () => {
    const created = await createProduct(actor, {
      sku: "ARCH-LISTA",
      name: "Aaa archivado",
    });
    if (!created.ok) throw new Error("product setup failed");
    await archiveProduct(actor, created.productId);
    const archived = await listProducts(actor, { status: "ARCHIVED" });
    expect(archived).toMatchObject({ total: 1, page: 1, pageCount: 1 });
    expect(archived.items.map((p) => p.sku)).toEqual(["ARCH-LISTA"]);
    expect((await listProducts(actor)).total).toBe(TOTAL);
  });

  it("another company sees none of them", async () => {
    const other = await company(10);
    expect(await listProducts(other)).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
    });
    const intruder = {
      organizationId: actor.organizationId,
      userId: other.userId,
    };
    await expect(listProducts(intruder)).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});

describe("listProducts", () => {
  it("orders by name and breaks ties so equal names never repeat", async () => {
    const actor = await company(20);
    for (const [sku, name] of [
      ["Z-1", "Tornillo"],
      ["A-9", "Tornillo"],
      ["M-5", "Arandela"],
      ["K-2", "Tornillo"],
    ] as const) {
      const result = await createProduct(actor, {
        sku,
        name,
        category: "Tornillería",
      });
      if (!result.ok) throw new Error("product setup failed");
    }
    const pages = await Promise.all(
      [1, 2, 3, 4].map((page) => listProducts(actor, { page, pageSize: 1 })),
    );
    expect(pages[0]?.items[0]).toMatchObject({
      sku: "M-5",
      category: "Tornillería",
      brand: null,
    });
    expect(pages.map((p) => p.pageCount)).toEqual([4, 4, 4, 4]);
    expect(new Set(pages.map((p) => p.items[0]?.sku)).size).toBe(4);
  });
});
