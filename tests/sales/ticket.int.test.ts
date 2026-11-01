import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  getPublicTicket,
  getSaleTicket,
  registerSale,
  setSalePrices,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-15 (ADR 0030): the ticket says what was sold and how it was paid; it
// is not a tax receipt. The customer's link opens it only while unaltered.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

let skus = 0;
async function soldBox() {
  const actor = await salesCompany();
  const created = await createProduct(actor, {
    sku: `TK-${++skus}`,
    name: "Tornillo 1/4",
  });
  if (!created.ok) throw new Error("product setup failed");
  const box = await createPresentation(actor, created.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  await registerEntry(actor, {
    productId: created.productId,
    quantity: "1000",
  });
  await setSalePrices(actor, created.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  const customer = await createCustomer(actor, { name: "Constructora" });
  if (!customer.ok) throw new Error("customer setup failed");
  const sale = await registerSale(actor, {
    lines: [
      {
        productId: created.productId,
        capture: `p:${box.presentationId}`,
        quantity: "1",
      },
      { productId: created.productId, capture: "base", quantity: "2" },
    ],
    customerId: customer.customer.id,
    discount: { percent: "5", reason: "Cliente frecuente" },
    payments: [{ method: "CASH", received: "500" }],
    idempotencyKey: newId(),
  });
  if (!sale.ok) throw new Error(JSON.stringify(sale));
  return { actor, saleId: sale.saleId };
}

describe("ticket", () => {
  it("says what was sold, the discount, VAT and how it was paid", async () => {
    const { actor, saleId } = await soldBox();
    const ticket = await getSaleTicket(actor, saleId);
    expect(ticket).toMatchObject({
      number: 1,
      cancelled: false,
      customer: "Constructora",
      lines: [
        {
          name: "Tornillo 1/4",
          quantity: "1 caja de 500 piezas",
          unitPrice: "$500.00 c/u",
          amount: "$500.00",
        },
        {
          name: "Tornillo 1/4",
          quantity: "2 piezas",
          unitPrice: "$1.50 c/u",
          amount: "$3.00",
        },
      ],
      // 503.00 − 5 % (25.15) = 477.85.
      discount: "-$25.15 (5 %)",
      taxLabel: "IVA incluido (16 %)",
      total: "$477.85",
      payments: [
        {
          method: "Efectivo",
          amount: "$477.85",
          detail: "Recibido $500.00 · Cambio $22.15",
        },
      ],
    });
    expect(ticket?.publicPath).toMatch(
      new RegExp(`^/ticket/${actor.organizationId}\\.${saleId}\\.[\\w-]{32}$`),
    );
  });

  it("the customer's link opens it only while unaltered", async () => {
    const { actor, saleId } = await soldBox();
    const ticket = await getSaleTicket(actor, saleId);
    const token = ticket!.publicPath.replace("/ticket/", "");
    expect((await getPublicTicket(token))?.total).toBe("$477.85");
    // Another sale with the same signature, a changed signature, junk.
    const other = await soldBox();
    const [, , sig] = token.split(".");
    expect(
      await getPublicTicket(
        `${other.actor.organizationId}.${other.saleId}.${sig}`,
      ),
    ).toBeNull();
    // A different last character, whatever the signature ends in.
    const flipped = token.endsWith("A") ? "B" : "A";
    expect(await getPublicTicket(`${token.slice(0, -1)}${flipped}`)).toBeNull();
    expect(await getPublicTicket("nada")).toBeNull();
    expect(await getPublicTicket(`${token}.extra`)).not.toBeNull();
  });

  it("is read by whoever may see sales, in their company only", async () => {
    const { actor, saleId } = await soldBox();
    const consulta = await salesMember(actor.organizationId, "viewer");
    expect((await getSaleTicket(consulta, saleId))?.number).toBe(1);
    const almacen = await salesMember(actor.organizationId, "warehouse");
    await expect(getSaleTicket(almacen, saleId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const other = await salesCompany();
    expect(await getSaleTicket(other, saleId)).toBeNull();
  });
});
