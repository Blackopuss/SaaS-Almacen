import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  addOrderLine,
  buildOrderPdf,
  cancelPurchaseOrder,
  createPurchaseOrder,
  linkProductSupplier,
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

// CMP-06A: the PDF of the order, with the data of the business and of
// the supplier.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `pdforden.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(name = "Ferretería El Tornillo Feliz") {
  const owner = await newUser();
  const created = await createOrganization(owner, { name, timeZone: "" });
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
      productLimit: 200,
      users: 10,
      modules: ["inventory", "purchasing"],
      validUntil: null,
      reason: "Prueba del PDF de la orden",
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

const decoder = new TextDecoder("windows-1252");

/** The texts drawn on each page of a PDF, as a person would read them. */
function pagesOf(file: Buffer): string[] {
  const raw = file.toString("latin1");
  return [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((stream) =>
    [...stream[1]!.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)]
      .map((text) =>
        decoder.decode(Buffer.from(text[1]!.replace(/\\(.)/g, "$1"), "latin1")),
      )
      .join("\n"),
  );
}

/** Every object of the file is where its table says it is. */
function expectWellFormed(file: Buffer) {
  const text = file.toString("latin1");
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const table = text.slice(start).split("\n");
  const size = Number(table[1]!.split(" ")[1]);
  for (let id = 1; id < size; id++) {
    const offset = Number(table[2 + id]!.slice(0, 10));
    expect(text.slice(offset, offset + 12), `object ${id}`).toMatch(
      new RegExp(`^${id} 0 obj\n`),
    );
  }
}

async function product(actor: PurchasingActor, sku: string, name: string) {
  const created = await createProduct(actor, { sku, name });
  if (!created.ok) throw new Error(`product setup failed: ${sku}`);
  return created.productId;
}

async function order(
  actor: PurchasingActor,
  supplier: Parameters<typeof createSupplier>[1],
  header: { expectedOn?: string; notes?: string } = {},
) {
  const made = await createSupplier(actor, supplier);
  if (!made.ok) throw new Error("supplier setup failed");
  const created = await createPurchaseOrder(actor, {
    supplierId: made.supplierId,
    ...header,
  });
  if (!created.ok) throw new Error("order setup failed");
  return { orderId: created.orderId, supplierId: made.supplierId };
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("buildOrderPdf", () => {
  it("carries the business, the supplier, what is asked for and its prices", async () => {
    const actor = await company();
    const { orderId, supplierId } = await order(
      actor,
      {
        name: "Ferretera del Norte",
        legalName: "Ferretera del Norte, S.A. de C.V.",
        rfc: "FNO010203AB1",
        contactPerson: "Laura Méndez",
        phone: "81 5555 0101",
        email: "ventas@ferreteranorte.example",
        address: "Av. Industria 100, Monterrey, N.L.",
      },
      {
        expectedOn: "2026-10-20",
        notes: "Entregar por la mañana.\nPedir factura.",
      },
    );
    const tornillo = await product(actor, "TOR-001", "Tornillo hexagonal 1/4");
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    await linkProductSupplier(actor, {
      productId: tornillo,
      supplierId,
      supplierSku: "FN-88213",
    });
    const cable = await product(actor, "CAB-012", "Cable THW calibre 12");
    await addOrderLine(actor, orderId, {
      productId: tornillo,
      capture: `p:${caja.presentationId}`,
      quantity: "3",
      unitCost: "1250.50",
    });
    await addOrderLine(actor, orderId, {
      productId: cable,
      capture: "base",
      quantity: "12",
      unitCost: "18.7525",
    });
    await submitPurchaseOrder(actor, orderId);

    const pdf = await buildOrderPdf(actor, orderId);
    expect(pdf).toMatchObject({
      name: "OC-0001.pdf",
      contentType: "application/pdf",
    });
    expectWellFormed(pdf!.bytes);
    const pages = pagesOf(pdf!.bytes);
    expect(pages).toHaveLength(1);
    const text = pages[0]!;
    for (const expected of [
      "Ferretería El Tornillo Feliz",
      "ORDEN DE COMPRA",
      "OC-0001",
      "Ferretera del Norte",
      "Ferretera del Norte, S.A. de C.V.",
      "RFC FNO010203AB1",
      "Atención: Laura Méndez",
      "Tel. 81 5555 0101",
      "ventas@ferreteranorte.example",
      "Av. Industria 100, Monterrey, N.L.",
      "20 oct 2026",
      "Enviada",
      // The supplier's own code where it is known, ours where it is not.
      "FN-88213",
      "CAB-012",
      "Tornillo hexagonal 1/4",
      "3 cajas × 100 = 300 piezas",
      "$1,250.50",
      "$3,751.50",
      "12 piezas",
      "$18.7525",
      "$225.03",
      "Total antes de impuestos",
      "$3,976.53",
      "Entregar por la mañana.",
      "Pedir factura.",
      "Página 1 de 1",
    ]) {
      expect(text, expected).toContain(expected);
    }
    // A confirmed order does not carry the warning of a draft.
    expect(text).not.toContain("BORRADOR");
    expect(text).not.toContain("CANCELADA");
    const [event] = await db.auditEvent.findMany({
      where: { action: "purchase_order.exported", targetId: orderId },
    });
    expect(event).toMatchObject({
      actorUserId: actor.userId,
      metadata: { orden: "OC-0001", proveedor: "Ferretera del Norte" },
    });
  });

  it("a draft and a cancelled order say so on the paper", async () => {
    const actor = await company();
    const { orderId } = await order(actor, { name: "Proveedor Uno" });
    await addOrderLine(actor, orderId, {
      productId: await product(actor, "P-1", "Producto uno"),
      capture: "base",
      quantity: "5",
    });
    let text = pagesOf((await buildOrderPdf(actor, orderId))!.bytes)[0]!;
    expect(text).toContain("BORRADOR · todavía no es un pedido");
    // A line without a cost shows a dash, and the total says what is missing.
    expect(text).toContain("No incluye 1 producto sin costo.");

    await cancelPurchaseOrder(actor, orderId, {
      reason: "El proveedor ya no lo maneja.",
    });
    text = pagesOf((await buildOrderPdf(actor, orderId))!.bytes)[0]!;
    expect(text).toContain("CANCELADA");
    expect(text).toContain("MOTIVO DE LA CANCELACIÓN");
    expect(text).toContain("El proveedor ya no lo maneja.");
    expect(text).not.toContain("BORRADOR");
  });

  it("a long order continues on more pages, with every product", async () => {
    const actor = await company();
    const { orderId } = await order(actor, { name: "Proveedor Largo" });
    for (let i = 1; i <= 70; i++) {
      const added = await addOrderLine(actor, orderId, {
        productId: await product(
          actor,
          `L-${String(i).padStart(3, "0")}`,
          `Producto de la línea ${i} con un nombre bastante largo para ocupar dos renglones`,
        ),
        capture: "base",
        quantity: String(i),
        unitCost: "10",
      });
      if (!added.ok) throw new Error("line setup failed");
    }
    const pdf = await buildOrderPdf(actor, orderId);
    expectWellFormed(pdf!.bytes);
    const pages = pagesOf(pdf!.bytes);
    expect(pages.length).toBeGreaterThan(2);
    pages.forEach((page, index) => {
      expect(page).toContain(`Página ${index + 1} de ${pages.length}`);
      expect(page).toContain("OC-0001");
      if (index > 0) expect(page).toContain("Continuación");
    });
    const all = pages.join("\n");
    for (let i = 1; i <= 70; i++) {
      expect(all, `line ${i}`).toContain(`L-${String(i).padStart(3, "0")}`);
    }
    // 1 + 2 + … + 70 = 2,485 units at $10.
    expect(pages.at(-1)).toContain("$24,850.00");
  }, 120_000);

  it("prints hostile text as text, and the file stays a plain document", async () => {
    const actor = await company("Ferretería (la) «Ñ» \\ Co.");
    const hostile = ") Tj ET BT /F1 99 Tf (PWNED) Tj /JavaScript (app.alert(1";
    const { orderId } = await order(
      actor,
      { name: "Proveedor ) ( \\ raro", address: "Calle 表 😀 #5" },
      { notes: "<< /OpenAction << /S /Launch >> >>" },
    );
    await addOrderLine(actor, orderId, {
      productId: await product(actor, "X-(1)", hostile),
      capture: "base",
      quantity: "1",
    });
    const pdf = await buildOrderPdf(actor, orderId);
    expectWellFormed(pdf!.bytes);
    const text = pagesOf(pdf!.bytes).join("\n");
    // Everything arrives as the text it was, parentheses included.
    expect(text).toContain("Ferretería (la) «Ñ» \\ Co.");
    expect(text).toContain("Proveedor ) ( \\ raro");
    expect(text).toContain("X-(1)");
    expect(text).toContain("<< /OpenAction << /S /Launch >> >>");
    // What the font cannot show becomes «?», it does not break the file.
    expect(text).toContain("Calle ? ? #5");
    // No object of the file is anything but structure, fonts and text.
    const structure = pdf!.bytes
      .toString("latin1")
      .replace(/stream\n[\s\S]*?\nendstream/g, "")
      .replace(/\((?:\\.|[^\\)])*\)/g, "()");
    for (const active of [
      "/JavaScript",
      "/JS",
      "/OpenAction",
      "/Launch",
      "/URI",
      "/AA",
    ]) {
      expect(structure, active).not.toContain(active);
    }
    // And the hostile name did not become an instruction: one font size
    // 99 would be the trace of it.
    expect(pdf!.bytes.toString("latin1")).not.toMatch(
      /\/F1 99 Tf \(PWNED\) Tj\n/,
    );
  });

  it("is for who may export orders, in their own company", async () => {
    const actor = await company();
    const { orderId } = await order(actor, { name: "Proveedor Uno" });
    await addOrderLine(actor, orderId, {
      productId: await product(actor, "P-1", "Producto uno"),
      capture: "base",
      quantity: "5",
      unitCost: "987.65",
    });
    // Consulta sees the order on screen but does not take its prices out.
    for (const role of ["viewer", "warehouse"] as const) {
      await expect(
        buildOrderPdf(await member(actor.organizationId, role), orderId),
        role,
      ).rejects.toMatchObject({ kind: "forbidden" });
    }
    for (const role of ["buyer", "administrator"] as const) {
      const pdf = await buildOrderPdf(
        await member(actor.organizationId, role),
        orderId,
      );
      expect(pagesOf(pdf!.bytes)[0], role).toContain("$987.65");
    }
    const theirs = await company("Otra ferretería");
    expect(await buildOrderPdf(theirs, orderId)).toBeNull();
    expect(await buildOrderPdf(actor, newId())).toBeNull();
    expect(await buildOrderPdf(actor, "no-es-un-id")).toBeNull();
    // Only the downloads that happened are written down.
    expect(
      await db.auditEvent.count({
        where: { action: "purchase_order.exported", targetId: orderId },
      }),
    ).toBe(2);
  });
});
