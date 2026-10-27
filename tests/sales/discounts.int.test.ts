import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { registerEntry, reconcileStock } from "@/modules/inventory";
import {
  authorizeDiscount,
  listDiscountAuthorizers,
  quoteSale,
  registerSale,
  setSalePrices,
  updateSalesSettings,
  type SaleInput,
} from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember, withPassword } from "../setup/sales";

// VEN-14 (ADR 0030): each role discounts up to the cap the titular sets;
// above it, someone with a cap large enough allows it with their password;
// below cost only with that permission; always with a reason, in the trail.

type Actor = { organizationId: string; userId: string };
const PASSWORD = "Supervisora-2026!";

let skus = 0;
/** $10 a piece, costing $8 (or the cost given). */
async function hammer(actor: Actor, cost = "8") {
  const created = await createProduct(actor, {
    sku: `M-${++skus}`,
    name: `Martillo ${skus}`,
  });
  if (!created.ok) throw new Error("product setup failed");
  await registerEntry(actor, {
    productId: created.productId,
    quantity: "100",
    unitCost: cost,
  });
  await setSalePrices(actor, created.productId, {
    unitPrice: "10",
    presentations: {},
  });
  return created.productId;
}

async function shop() {
  const titular = await salesCompany();
  const productId = await hammer(titular);
  const cajero = await salesMember(titular.organizationId, "cashier");
  const encargada = await salesMember(titular.organizationId, "cash_manager");
  await withPassword(encargada.userId, PASSWORD);
  return { titular, productId, cajero, encargada };
}

const sale = (
  productId: string,
  discount?: SaleInput["discount"],
): SaleInput => ({
  lines: [{ productId, capture: "base", quantity: "10" }],
  payments: [{ method: "CASH" }],
  discount,
  idempotencyKey: newId(),
});

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("discounts", () => {
  it("the cashier gives up to their cap, with a reason, and it stays in the trail", async () => {
    const { titular, productId, cajero } = await shop();
    expect(
      await quoteSale(cajero, {
        lines: [{ productId, capture: "base", quantity: "10" }],
        discountPercent: "5",
      }),
    ).toMatchObject({
      total: "$95.00",
      discount: {
        amount: "-$5.00",
        cap: "5 %",
        needsAuthorization: false,
        belowCost: false,
      },
    });
    expect(
      await registerSale(cajero, sale(productId, { percent: "5" })),
    ).toMatchObject({
      ok: false,
      discountError: expect.stringMatching(/motivo/),
    });
    const sold = await registerSale(
      cajero,
      sale(productId, { percent: "5", reason: "Cliente frecuente" }),
    );
    expect(sold).toMatchObject({ ok: true, total: "$95.00" });
    if (!sold.ok) return;
    const stored = await db.sale.findUniqueOrThrow({
      where: { id: sold.saleId },
      include: { lines: true },
    });
    expect(
      [stored.discount, stored.discountPercent, stored.total].map(String),
    ).toEqual(["5", "5", "95"]);
    expect(stored.discountReason).toBe("Cliente frecuente");
    expect(
      [stored.lines[0]?.discount, stored.lines[0]?.amount].map(String),
    ).toEqual(["5", "95"]);
    const trail = await listAuditTrail(titular.organizationId, { limit: 5 });
    const given = trail.find((e) => e.action === "sales.discount_given");
    expect(given?.reason).toBe("Cliente frecuente");
    expect(given?.facts).toEqual(["Venta: 1", "Descuento: 5 %"]);
    expect(await reconcileStock(titular.organizationId)).toEqual([]);
  });

  it("above the cap it needs someone who allows it, with their password", async () => {
    const { titular, productId, cajero, encargada } = await shop();
    const ten = { percent: "10", reason: "Compra grande" };
    expect(
      (
        await quoteSale(cajero, {
          lines: [{ productId, capture: "base", quantity: "10" }],
          discountPercent: "10",
        })
      ).discount,
    ).toMatchObject({ needsAuthorization: true });
    expect(await registerSale(cajero, sale(productId, ten))).toMatchObject({
      ok: false,
      discountError:
        "Tu tope de descuento es 5 %. Pide que lo autorice un encargado.",
    });

    expect(
      (await listDiscountAuthorizers(cajero)).map((a) => [a.userId, a.cap]),
    ).toEqual(
      expect.arrayContaining([
        [encargada.userId, "20 %"],
        [titular.userId, "100 %"],
      ]),
    );
    const ask = (password: string, percent = "10") =>
      authorizeDiscount(cajero, {
        authorizerUserId: encargada.userId,
        password,
        percent,
        reason: "Compra grande",
        ip: "203.0.113.7",
      });
    expect(await ask("otra-cosa-123")).toMatchObject({
      ok: false,
      fieldErrors: { password: expect.any(String) },
    });
    expect(await ask(PASSWORD, "25")).toMatchObject({
      ok: false,
      fieldErrors: { percent: expect.stringMatching(/hasta 20 %/) },
    });
    const allowed = await ask(PASSWORD);
    expect(allowed).toMatchObject({ ok: true, belowCost: false });
    if (!allowed.ok) return;

    const sold = await registerSale(
      cajero,
      sale(productId, { ...ten, authorizationId: allowed.authorizationId }),
    );
    expect(sold).toMatchObject({ ok: true, total: "$90.00" });
    // Used once: another sale needs another authorization.
    expect(
      await registerSale(
        cajero,
        sale(productId, { ...ten, authorizationId: allowed.authorizationId }),
      ),
    ).toMatchObject({
      ok: false,
      discountError: expect.stringMatching(/ya no sirve/),
    });
    // …and it is for that cashier only.
    const otro = await salesMember(titular.organizationId, "cashier");
    expect(
      await registerSale(
        otro,
        sale(productId, { ...ten, authorizationId: allowed.authorizationId }),
      ),
    ).toMatchObject({ ok: false, discountError: expect.any(String) });
  }, 30_000);

  it("an authorization that ran out of time no longer allows anything", async () => {
    const { titular, productId, cajero, encargada } = await shop();
    const old = await db.saleDiscountAuthorization.create({
      data: {
        id: newId(),
        organizationId: titular.organizationId,
        sellerUserId: cajero.userId,
        authorizerUserId: encargada.userId,
        percent: "15",
        belowCost: false,
        reason: "Ayer",
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(
      await registerSale(
        cajero,
        sale(productId, {
          percent: "10",
          reason: "Ayer",
          authorizationId: old.id,
        }),
      ),
    ).toMatchObject({
      ok: false,
      discountError: expect.stringMatching(/venció/),
    });
  });

  it("wrong passwords block the supervisor for a while", async () => {
    const { cajero, encargada } = await shop();
    const results = [];
    for (let i = 0; i < 6; i++) {
      results.push(
        await authorizeDiscount(cajero, {
          authorizerUserId: encargada.userId,
          password: `mala-${i}-contraseña`,
          percent: "10",
          reason: "Prueba",
          ip: `198.51.100.${i}`,
        }),
      );
    }
    expect(results.at(-1)).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/Demasiados intentos/),
    });
  }, 30_000);

  it("below cost only with that permission", async () => {
    const { titular, encargada } = await shop();
    // A $10 hammer that cost $8.50: 20 % off sells it at $8, below cost.
    // Within the Encargada's cap, but she may not sell below cost; the
    // titular may.
    const productId = await hammer(titular, "8.50");
    const below = { percent: "20", reason: "Liquidación" };
    expect(
      (
        await quoteSale(encargada, {
          lines: [{ productId, capture: "base", quantity: "10" }],
          discountPercent: below.percent,
        })
      ).discount,
    ).toMatchObject({ needsAuthorization: false, belowCost: true });
    expect(await registerSale(encargada, sale(productId, below))).toMatchObject(
      {
        ok: false,
        discountError: expect.stringMatching(/debajo de su costo/),
      },
    );
    // Exactly at cost is not below it.
    expect(
      (
        await registerSale(
          encargada,
          sale(productId, { percent: "15", reason: "Al costo" }),
        )
      ).ok,
    ).toBe(true);
    expect((await registerSale(titular, sale(productId, below))).ok).toBe(true);
  });

  it("the titular sets each role's cap", async () => {
    const { titular, productId, cajero } = await shop();
    await updateSalesSettings(titular, {
      taxMode: "included",
      taxRate: "16",
      caps: { cashier: "0" },
    });
    expect(
      await registerSale(
        cajero,
        sale(productId, { percent: "1", reason: "Redondeo" }),
      ),
    ).toMatchObject({
      ok: false,
      discountError: expect.stringMatching(/tope de descuento es 0 %/),
    });
  });
});
