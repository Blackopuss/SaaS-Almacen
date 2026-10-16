import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  addOrderLine,
  buildPurchaseReport,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  getPendingReport,
  getPurchasesBySupplier,
  receivePurchaseOrder,
  returnToSupplier,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createSupplier } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-15: reports of Compras — what is still to be received and what was
// bought from each supplier — with amounts only for who may see costs.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: `Persona ${counter + 1}`,
      email: `reportecompras.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<PurchasingActor> {
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
      productLimit: 30,
      users: 10,
      modules: ["inventory", "purchasing"],
      validUntil: null,
      reason: "Prueba de reportes de compras",
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

let skus = 0;
async function product(actor: PurchasingActor) {
  const created = await createProduct(actor, {
    sku: `R-${++skus}`,
    name: `Tornillo ${skus}`,
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

const key = () => newId();

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

async function supplierOf(actor: PurchasingActor, name: string) {
  const created = await createSupplier(actor, { name });
  if (!created.ok) throw new Error("supplier setup failed");
  return created.supplierId;
}

async function order(
  actor: PurchasingActor,
  supplierId: string,
  lines: {
    productId: string;
    capture?: string;
    quantity: string;
    unitCost?: string;
  }[],
  options: { expectedOn?: string; send?: boolean } = {},
) {
  const created = await createPurchaseOrder(actor, {
    supplierId,
    ...(options.expectedOn ? { expectedOn: options.expectedOn } : {}),
  });
  if (!created.ok) throw new Error("order setup failed");
  for (const line of lines) {
    const added = await addOrderLine(actor, created.orderId, {
      productId: line.productId,
      capture: line.capture ?? "base",
      quantity: line.quantity,
      ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
    });
    if (!added.ok) throw new Error(`line failed: ${JSON.stringify(added)}`);
  }
  if (options.send !== false) {
    const sent = await submitPurchaseOrder(actor, created.orderId);
    if (!sent.ok) throw new Error("submit failed");
  }
  return created.orderId;
}

const firstLine = async (orderId: string) =>
  (
    await db.purchaseOrderLine.findFirstOrThrow({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
    })
  ).id;

/** Some activity: open, late, partial, closed and draft orders. */
async function scene() {
  const actor = await company();
  const norte = await supplierOf(actor, "Ferretera del Norte");
  const bajio = await supplierOf(actor, "Aceros del Bajío");
  const clavo = await product(actor);
  const caja = await box(actor, clavo);
  const varilla = await product(actor);
  // Late and received in part: 1 of 3 boxes at $250.
  const late = await order(
    actor,
    norte,
    [
      {
        productId: clavo,
        capture: `p:${caja}`,
        quantity: "3",
        unitCost: "250",
      },
    ],
    { expectedOn: "2020-01-02" },
  );
  await receivePurchaseOrder(actor, late, {
    idempotencyKey: key(),
    lines: [{ orderLineId: await firstLine(late), quantity: "1" }],
  });
  // Sent, nothing arrived, no cost.
  const plain = await order(actor, bajio, [
    { productId: varilla, quantity: "12" },
  ]);
  // Received in part and closed: expects nothing more.
  const closed = await order(actor, bajio, [
    { productId: varilla, quantity: "10", unitCost: "40" },
  ]);
  await receivePurchaseOrder(actor, closed, {
    idempotencyKey: key(),
    lines: [{ orderLineId: await firstLine(closed), quantity: "4" }],
  });
  await closePurchaseOrder(actor, closed, { reason: "No llegará" });
  // Drafts and cancelled orders are not pending.
  await order(actor, norte, [{ productId: varilla, quantity: "1" }], {
    send: false,
  });
  const cancelled = await order(actor, norte, [
    { productId: varilla, quantity: "1" },
  ]);
  await cancelPurchaseOrder(actor, cancelled, { reason: "Ya no" });
  return { actor, norte, bajio, late, plain, closed };
}

describe("getPendingReport", () => {
  it("lists what is still to be received, the overdue first", async () => {
    const { actor, late, plain } = await scene();
    const report = await getPendingReport(actor);
    expect(report).toMatchObject({
      orders: 2,
      costsVisible: true,
      totalText: "$500.00",
      truncated: false,
    });
    expect(report.rows).toEqual([
      expect.objectContaining({
        orderId: late,
        statusLabel: "Recibida en parte",
        supplierName: "Ferretera del Norte",
        expectedOn: "2020-01-02",
        late: true,
        orderedText: "3 cajas",
        receivedText: "1 caja",
        pendingText: "2 cajas",
        pendingQuantity: "2",
        pendingAmount: "500.00",
        pendingAmountText: "$500.00",
      }),
      expect.objectContaining({
        orderId: plain,
        expectedOn: null,
        late: false,
        receivedText: null,
        pendingText: "12 piezas",
        pendingAmount: null,
      }),
    ]);
  });

  it("without costs the amounts are not in the answer; Almacén has no way in", async () => {
    const { actor } = await scene();
    const viewer = await member(actor.organizationId, "viewer");
    const report = await getPendingReport(viewer);
    expect(report.costsVisible).toBe(false);
    expect("totalText" in report).toBe(false);
    for (const row of report.rows) {
      expect("pendingAmount" in row).toBe(false);
      expect("pendingAmountText" in row).toBe(false);
    }
    expect(JSON.stringify(report)).not.toMatch(/500[.]00/);
    await expect(
      getPendingReport(await member(actor.organizationId, "warehouse")),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });
});

describe("getPurchasesBySupplier", () => {
  it("adds what was received and returned in the period, by supplier", async () => {
    const { actor, norte, bajio, late } = await scene();
    const receipt = await db.purchaseReceipt.findFirstOrThrow({
      where: { orderId: late },
      include: { lines: true },
    });
    const back = await returnToSupplier(actor, receipt.id, {
      reason: "Llegó dañada",
      idempotencyKey: key(),
      lines: [{ receiptLineId: receipt.lines[0]!.id, quantity: "1" }],
    });
    expect(back).toMatchObject({ ok: true });

    const report = await getPurchasesBySupplier(actor);
    if (!report.ok) throw new Error(report.error);
    expect(report.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(report.rows).toEqual([
      expect.objectContaining({
        supplierId: bajio,
        supplierName: "Aceros del Bajío",
        receipts: 1,
        orders: 1,
        products: 1,
        returns: 0,
        receivedAmountText: "$160.00",
        netAmountText: "$160.00",
        linesWithoutCost: 0,
      }),
      expect.objectContaining({
        supplierId: norte,
        receipts: 1,
        returns: 1,
        receivedAmountText: "$250.00",
        returnedAmountText: "$250.00",
        netAmountText: "$0.00",
      }),
    ]);
    expect(report.totalText).toBe("$160.00");

    const viewer = await member(actor.organizationId, "viewer");
    const plain = await getPurchasesBySupplier(viewer);
    expect(JSON.stringify(plain)).not.toMatch(/160[.]00|250[.]00/);
    expect(plain).toMatchObject({ ok: true, costsVisible: false });
  });

  it("only the period asked for; dates are checked", async () => {
    const { actor } = await scene();
    expect(
      await getPurchasesBySupplier(actor, {
        from: "2020-01-01",
        to: "2020-01-31",
      }),
    ).toMatchObject({ ok: true, rows: [] });
    expect(
      await getPurchasesBySupplier(actor, { from: "ayer", to: "2020-01-31" }),
    ).toMatchObject({ ok: false, error: /día de calendario/ });
    expect(
      await getPurchasesBySupplier(actor, {
        from: "2020-02-01",
        to: "2020-01-31",
      }),
    ).toMatchObject({ ok: false, error: /anterior o igual/ });
  });
});

describe("buildPurchaseReport", () => {
  it("the file holds what the screen shows: no cost columns without costs", async () => {
    const { actor } = await scene();
    const full = await buildPurchaseReport(actor, {
      kind: "pendientes",
      format: "csv",
    });
    if (!full.ok) throw new Error(full.error);
    const text = full.bytes.toString("utf8");
    expect(text).toContain("Importe pendiente");
    expect(text).toContain("500.00");
    expect(full).toMatchObject({
      rows: 2,
      contentType: "text/csv; charset=utf-8",
    });
    expect(full.name).toMatch(/^compras-pendientes-\d{4}-\d{2}-\d{2}\.csv$/);

    const viewer = await member(actor.organizationId, "viewer");
    const limited = await buildPurchaseReport(viewer, {
      kind: "proveedores",
      format: "csv",
    });
    if (!limited.ok) throw new Error(limited.error);
    const plainText = limited.bytes.toString("utf8");
    expect(plainText).not.toMatch(/Recibido|Neto|160[.]00/);
    expect(plainText).toContain("Aceros del Bajío");
    const xlsx = await buildPurchaseReport(actor, {
      kind: "proveedores",
      format: "xlsx",
    });
    expect(xlsx.ok && xlsx.bytes.subarray(0, 2).toString()).toBe("PK");

    await expect(
      buildPurchaseReport(await member(actor.organizationId, "warehouse"), {
        kind: "pendientes",
        format: "csv",
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(
      await db.auditEvent.count({
        where: {
          organizationId: actor.organizationId,
          action: "purchasing.report_exported",
        },
      }),
    ).toBe(3);
  });
});
