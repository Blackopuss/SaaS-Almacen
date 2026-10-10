import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  IMPORT_COLUMNS,
  applyImport,
  confirmImport,
  getFirstSteps,
  registerEntry,
  registerExit,
  registerInitialBalance,
  saveImportMapping,
  startImport,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { archiveProduct, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { buildCsv } from "@/platform/files";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-12: guide of first use. A new person gets from the catalog to the
// import and to a first movement; the guide reads where they are from
// what exists, without flags of its own.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `primerospasos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<InventoryActor> {
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
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de primeros pasos",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

const NOTHING = {
  hasProducts: false,
  hasStock: false,
  hasMovement: false,
  complete: false,
};

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("getFirstSteps", () => {
  it("by hand: a product, its starting stock, a first movement", async () => {
    const actor = await company();
    expect(await getFirstSteps(actor)).toEqual(NOTHING);

    const product = await createProduct(actor, {
      sku: "TOR-1",
      name: "Tornillo",
    });
    if (!product.ok) throw new Error("product setup failed");
    expect(await getFirstSteps(actor)).toEqual({
      ...NOTHING,
      hasProducts: true,
    });

    await registerInitialBalance(actor, {
      productId: product.productId,
      quantity: "50",
    });
    expect(await getFirstSteps(actor)).toEqual({
      hasProducts: true,
      hasStock: true,
      hasMovement: false,
      complete: false,
    });

    await registerEntry(actor, { productId: product.productId, quantity: "5" });
    expect(await getFirstSteps(actor)).toEqual({
      hasProducts: true,
      hasStock: true,
      hasMovement: true,
      complete: true,
    });
    // What is done stays done, even if the product is archived later.
    await registerExit(actor, { productId: product.productId, quantity: "55" });
    await archiveProduct(actor, product.productId);
    expect((await getFirstSteps(actor)).complete).toBe(true);
  });

  it("with a file: products and their stock arrive together", async () => {
    const actor = await company();
    const keys = IMPORT_COLUMNS.map((column) => column.key);
    const row = {
      sku: "CAB-1",
      name: "Cable",
      unit: "metro",
      initialStock: "12.5",
    };
    const started = await startImport(actor, {
      name: "inventario.csv",
      bytes: buildCsv(
        [
          IMPORT_COLUMNS.map((column) => column.header),
          keys.map((key) => (row as Record<string, string>)[key] ?? ""),
        ],
        { neutralize: false },
      ),
    });
    if (!started.ok) throw new Error(started.error);
    await saveImportMapping(actor, {
      importId: started.importId,
      mapping: Object.fromEntries(keys.map((key, index) => [key, index])),
      decimalSeparator: ".",
    });
    // Uploading and reviewing changes nothing yet.
    expect(await getFirstSteps(actor)).toEqual(NOTHING);
    const confirmed = await confirmImport(actor, started.importId);
    if (!confirmed.ok) throw new Error(confirmed.error);
    await applyImport(actor.organizationId, started.importId);

    // Two steps at once; the first movement is still to come.
    expect(await getFirstSteps(actor)).toEqual({
      hasProducts: true,
      hasStock: true,
      hasMovement: false,
      complete: false,
    });
  });

  it("an entry as the very first thing counts as stock and as movement", async () => {
    const actor = await company();
    const product = await createProduct(actor, {
      sku: "TOR-1",
      name: "Tornillo",
    });
    if (!product.ok) throw new Error("product setup failed");
    await registerEntry(actor, { productId: product.productId, quantity: "5" });
    expect((await getFirstSteps(actor)).complete).toBe(true);
  });

  it("is read per company, and only by its people", async () => {
    const ours = await company();
    const theirs = await company();
    const product = await createProduct(theirs, { sku: "X-1", name: "Ajeno" });
    if (!product.ok) throw new Error("product setup failed");
    await registerEntry(theirs, {
      productId: product.productId,
      quantity: "1",
    });

    expect(await getFirstSteps(ours)).toEqual(NOTHING);
    await expect(
      getFirstSteps({
        organizationId: theirs.organizationId,
        userId: ours.userId,
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});
