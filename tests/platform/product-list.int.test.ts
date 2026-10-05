import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  PRODUCT_PAGE_SIZE,
  archiveProduct,
  createProduct,
  listProducts,
  normalizeSearch,
  type CatalogActor,
} from "@/platform/catalog";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { migratorConnection } from "../setup/test-db";

// INV-10: the list of products is cut into pages by the database. With
// 10,000 products each page brings only its rows.
// INV-11: search by name, code (SKU) and barcode over the same catalog.

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
const bulkName = (n: number) => `Producto N${String(n).padStart(5, "0")}`;
const bulkBarcode = (n: number) => `750${String(n).padStart(10, "0")}`;

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
        rows.push([
          newId(),
          organizationId,
          `B-${n}`,
          bulkName(n),
          bulkBarcode(n),
        ]);
      }
      await connection.batch(
        "INSERT INTO product (id, organizationId, sku, name, barcode, updatedAt) VALUES (?, ?, ?, ?, ?, NOW(3))",
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
        "EXPLAIN SELECT id FROM product WHERE organizationId = ? AND status = 'ACTIVE' ORDER BY name, sku LIMIT 25 OFFSET 5000",
        [actor.organizationId],
      )) as { key: string; Extra: string | null }[];
      expect(plan[0]?.key).toBe(
        "product_organizationId_status_name_sku_barcode_idx",
      );
      expect(plan[0]?.Extra ?? "").not.toContain("filesort");
    } finally {
      await connection.end();
    }
  });

  it("finds by words of the name, in any order", async () => {
    const found = await listProducts(actor, { search: "n00042 producto" });
    expect(found).toMatchObject({ total: 1, page: 1, pageCount: 1 });
    expect(found.items.map((p) => p.sku)).toEqual(["B-42"]);
    expect(found.search).toBe("n00042 producto");
    // No code is exactly that text.
    expect(found.exact).toBeNull();
  });

  it("finds by part of the code and puts the exact code apart", async () => {
    // B-42, B-420…B-429 and B-4200…B-4299.
    const found = await listProducts(actor, { search: "b-42" });
    expect(found.total).toBe(111);
    expect(found.pageCount).toBe(5);
    expect(found.exact).toMatchObject({ sku: "B-42", name: bulkName(42) });
    // The list itself keeps its order by name.
    expect(found.items[0]?.sku).toBe("B-42");
    expect(found.items[1]?.sku).toBe("B-420");
  });

  it("finds a scanned barcode", async () => {
    const found = await listProducts(actor, { search: bulkBarcode(7_531) });
    expect(found.total).toBe(1);
    expect(found.exact?.sku).toBe("B-7531");
    // Part of a barcode also narrows the list: products 7500 to 7599.
    expect((await listProducts(actor, { search: "75000000075" })).total).toBe(
      100,
    );
  });

  it("a search pages like the whole list", async () => {
    // Products N00001 to N00099.
    const first = await listProducts(actor, { search: "Producto N000" });
    expect(first).toMatchObject({ total: 99, page: 1, pageCount: 4 });
    const last = await listProducts(actor, {
      search: "Producto N000",
      page: 9,
    });
    expect(last.page).toBe(4);
    expect(last.items).toHaveLength(99 - 3 * PRODUCT_PAGE_SIZE);
    expect(last.items.at(-1)?.name).toBe(bulkName(99));
  });

  it("nothing found is an empty first page", async () => {
    expect(
      await listProducts(actor, { search: "no existe este producto" }),
    ).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
      exact: null,
    });
  });

  it("searching 10,000 products answers quickly, found or not", async () => {
    await listProducts(actor, { search: "calentamiento" });
    for (const search of ["09999", "B-9999", bulkBarcode(9_999), "zzzz", "o"]) {
      const started = performance.now();
      await listProducts(actor, { search, page: 3 });
      expect(performance.now() - started, search).toBeLessThan(1_000);
    }
  });

  it("the search filters inside the index of the list", async () => {
    const connection = await migratorConnection();
    try {
      const plan = (await connection.query(
        "EXPLAIN SELECT id FROM product WHERE organizationId = ? AND status = 'ACTIVE' AND (name LIKE '%zzzz%' OR sku LIKE '%zzzz%' OR barcode LIKE '%zzzz%') ORDER BY name, sku LIMIT 25",
        [actor.organizationId],
      )) as { key: string; Extra: string | null }[];
      expect(plan[0]?.key).toBe(
        "product_organizationId_status_name_sku_barcode_idx",
      );
      // Answered from the index alone: no row of the table is read to filter.
      expect(plan[0]?.Extra ?? "").toContain("Using index");
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
    // A search looks only in the list it was made from.
    expect((await listProducts(actor, { search: "ARCH-LISTA" })).total).toBe(0);
    expect(
      await listProducts(actor, { status: "ARCHIVED", search: "arch-lista" }),
    ).toMatchObject({ total: 1, exact: { sku: "ARCH-LISTA" } });
  });

  it("another company sees none of them", async () => {
    const other = await company(10);
    expect(await listProducts(other)).toMatchObject({
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
    });
    expect(await listProducts(other, { search: "B-42" })).toMatchObject({
      total: 0,
      exact: null,
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
    // Equal names go by code.
    expect(pages.map((p) => p.items[0]?.sku)).toEqual([
      "M-5",
      "A-9",
      "K-2",
      "Z-1",
    ]);
    expect(pages[0]?.items[0]).toMatchObject({
      sku: "M-5",
      category: "Tornillería",
      brand: null,
    });
    expect(pages.map((p) => p.pageCount)).toEqual([4, 4, 4, 4]);
    expect(new Set(pages.map((p) => p.items[0]?.sku)).size).toBe(4);
  });
});

describe("searching products", () => {
  let actor: CatalogActor;

  beforeAll(async () => {
    actor = await company(20);
    for (const product of [
      {
        sku: "MAR-16",
        name: "Martillo de uña 16 oz",
        barcode: "7501234500016",
      },
      { sku: "MAR-20", name: "Martillo de bola 20 oz" },
      { sku: "LON-1", name: "Lona 100% algodón" },
      { sku: "TUB_34", name: "Tubo PVC 3/4" },
      { sku: "16", name: "Clavo estándar" },
    ]) {
      const result = await createProduct(actor, product);
      if (!result.ok) throw new Error("product setup failed");
    }
  });

  const skus = async (search: string) =>
    (await listProducts(actor, { search })).items.map((p) => p.sku);

  it("does not distinguish capitals or accents", async () => {
    expect(await skus("MARTILLO")).toEqual(["MAR-20", "MAR-16"]);
    expect(await skus("martíllo UNA")).toEqual(["MAR-16"]);
    expect(await skus("algodon")).toEqual(["LON-1"]);
    expect(await skus("estandar")).toEqual(["16"]);
  });

  it("every word must appear, in the name, the code or the barcode", async () => {
    expect(await skus("martillo oz")).toEqual(["MAR-20", "MAR-16"]);
    expect(await skus("martillo bola")).toEqual(["MAR-20"]);
    // One word from the name and another from the code or the barcode.
    expect(await skus("uña mar-16")).toEqual(["MAR-16"]);
    expect(await skus("martillo 75012345")).toEqual(["MAR-16"]);
    expect(await skus("martillo algodón")).toEqual([]);
  });

  it("an exact code is singled out even when other products mention it", async () => {
    const found = await listProducts(actor, { search: "16" });
    // «16» is in a name, a code and a barcode… and is the code of the nail.
    expect(found.total).toBe(2);
    expect(found.exact).toMatchObject({ sku: "16", name: "Clavo estándar" });
    const scanned = await listProducts(actor, { search: "7501234500016" });
    expect(scanned.exact).toMatchObject({ sku: "MAR-16" });
  });

  it("%, _ and the backslash are searched as written", async () => {
    expect(await skus("%")).toEqual(["LON-1"]);
    expect(await skus("100%")).toEqual(["LON-1"]);
    expect(await skus("_")).toEqual(["TUB_34"]);
    expect(await skus("TUB_34")).toEqual(["TUB_34"]);
    expect(await skus("\\")).toEqual([]);
    expect(await skus("3/4")).toEqual(["TUB_34"]);
    expect(await skus("' OR 1=1 --")).toEqual([]);
  });

  it("spaces, line breaks and very long text are tamed", async () => {
    expect(normalizeSearch("  martillo \t\n  bola  ")).toBe("martillo bola");
    expect(normalizeSearch(undefined)).toBe("");
    expect(normalizeSearch(["a", "b"])).toBe("");
    expect(normalizeSearch("x".repeat(500))).toHaveLength(100);
    expect(await skus("   ")).toHaveLength(5);
    const untidy = await listProducts(actor, { search: "  martillo\n bola " });
    expect(untidy.search).toBe("martillo bola");
    // Only the first words count; the rest are ignored instead of failing.
    expect(await skus("martillo de bola 20 oz mar extra palabras")).toEqual([
      "MAR-20",
    ]);
    expect(await skus("x".repeat(500))).toEqual([]);
  });
});
