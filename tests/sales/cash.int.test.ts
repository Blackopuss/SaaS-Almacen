import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { registerEntry } from "@/modules/inventory";
import {
  NO_CASH_SESSION,
  closeCashSession,
  getCashSession,
  getMyCashSession,
  listCashSessions,
  openCashSession,
  recordCashMovement,
  registerSale,
  setSalePrices,
  type SaleInput,
} from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-16..18 (ADR 0030): nobody charges without an open register; money in
// and out goes with its reason; the close counts what there is against
// what there should be, by payment method.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

async function shop() {
  const titular = await salesCompany();
  const created = await createProduct(titular, { sku: "C-1", name: "Pala" });
  if (!created.ok) throw new Error("product setup failed");
  await registerEntry(titular, {
    productId: created.productId,
    quantity: "100",
  });
  await setSalePrices(titular, created.productId, {
    unitPrice: "50",
    presentations: {},
  });
  const cajero = await salesMember(titular.organizationId, "cashier", {
    openCash: false,
  });
  const encargada = await salesMember(titular.organizationId, "cash_manager");
  return { titular, productId: created.productId, cajero, encargada };
}

const sale = (
  productId: string,
  quantity: string,
  payments: SaleInput["payments"],
): SaleInput => ({
  lines: [{ productId, capture: "base", quantity }],
  payments,
  idempotencyKey: newId(),
});

describe("cash register", () => {
  it("without an open register nobody charges", async () => {
    const { productId, cajero } = await shop();
    expect(
      await registerSale(cajero, sale(productId, "1", [{ method: "CASH" }])),
    ).toMatchObject({ ok: false, formError: NO_CASH_SESSION });
    expect(await getMyCashSession(cajero)).toBeNull();
  });

  it("a shift: float, sales, money in and out, and the close", async () => {
    const { titular, productId, cajero, encargada } = await shop();
    expect(
      await openCashSession(cajero, { openingFloat: "500" }),
    ).toMatchObject({
      ok: true,
    });
    expect(
      await openCashSession(cajero, { openingFloat: "100" }),
    ).toMatchObject({
      ok: false,
      formError: "Ya tienes una caja abierta.",
    });
    // $100 in cash (handed $200), $50 by card.
    expect(
      (
        await registerSale(
          cajero,
          sale(productId, "2", [{ method: "CASH", received: "200" }]),
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await registerSale(
          cajero,
          sale(productId, "1", [{ method: "CARD", reference: "4421" }]),
        )
      ).ok,
    ).toBe(true);
    expect(
      await recordCashMovement(cajero, {
        direction: "IN",
        amount: "200",
        reason: "Cambio del banco",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await recordCashMovement(cajero, {
        direction: "OUT",
        amount: "50",
        reason: "Garrafón de agua",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await recordCashMovement(cajero, {
        direction: "OUT",
        amount: "5000",
        reason: "Demasiado",
      }),
    ).toMatchObject({
      ok: false,
      fieldErrors: { amount: expect.stringMatching(/debería haber \$750\.00/) },
    });
    expect(
      await recordCashMovement(cajero, {
        direction: "OUT",
        amount: "10",
        reason: "",
      }),
    ).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });

    const mine = await getMyCashSession(cajero);
    expect(mine?.totals).toEqual({
      float: "$500.00",
      cashSales: "$100.00",
      cashOnAccounts: "$0.00",
      cashIn: "$200.00",
      cashOut: "$50.00",
      cashRefunds: "$0.00",
      card: "$50.00",
      transfer: "$0.00",
      expectedCash: "$750.00",
    });

    // The cashier does not close; the cash manager does.
    await expect(
      closeCashSession(cajero, mine!.id, {
        countedCash: "750",
        countedCard: "50",
        countedTransfer: "0",
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(
      (await listCashSessions(encargada)).map((view) => view.id),
    ).toContain(mine!.id);
    expect(
      await closeCashSession(encargada, mine!.id, {
        countedCash: "740",
        countedCard: "50",
        countedTransfer: "",
        note: "Faltaron 10 pesos",
      }),
    ).toMatchObject({ ok: true });
    expect((await getCashSession(encargada, mine!.id))?.close).toMatchObject({
      countedCash: "$740.00",
      differenceCash: "-$10.00",
      differenceCard: "$0.00",
      differenceTransfer: "$0.00",
      note: "Faltaron 10 pesos",
    });
    // Closed: no more sales nor movements in it, and it closes once.
    expect(
      await registerSale(cajero, sale(productId, "1", [{ method: "CASH" }])),
    ).toMatchObject({ ok: false, formError: NO_CASH_SESSION });
    expect(
      await closeCashSession(encargada, mine!.id, {
        countedCash: "0",
        countedCard: "0",
        countedTransfer: "0",
      }),
    ).toMatchObject({ ok: false, formError: "Esta caja ya se cerró." });
    // A new shift.
    expect((await openCashSession(cajero, { openingFloat: "" })).ok).toBe(true);

    const trail = await listAuditTrail(titular.organizationId, { limit: 20 });
    expect(trail.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "sales.cash_opened",
        "sales.cash_in",
        "sales.cash_out",
        "sales.cash_closed",
      ]),
    );
  });

  it("a sale and the close at once: the sale lands before, or not at all", async () => {
    for (let round = 0; round < 3; round++) {
      const { productId, cajero, encargada } = await shop();
      await openCashSession(cajero, { openingFloat: "100" });
      const session = await getMyCashSession(cajero);
      const [sold] = await Promise.all([
        registerSale(cajero, sale(productId, "1", [{ method: "CASH" }])),
        closeCashSession(encargada, session!.id, {
          countedCash: "100",
          countedCard: "0",
          countedTransfer: "0",
        }),
      ]);
      const closed = await db.cashSession.findUniqueOrThrow({
        where: { id: session!.id },
      });
      expect(closed.expectedCash?.toString()).toBe(sold.ok ? "150" : "100");
      if (sold.ok) {
        expect(
          (await db.sale.findUniqueOrThrow({ where: { id: sold.saleId } }))
            .cashSessionId,
        ).toBe(session!.id);
      }
    }
  });

  it("a register is seen by who opened it and by cash managers only", async () => {
    const { titular, cajero, encargada } = await shop();
    await openCashSession(cajero, { openingFloat: "10" });
    const session = await getMyCashSession(cajero);
    const otro = await salesMember(titular.organizationId, "cashier");
    await expect(getCashSession(otro, session!.id)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect((await getCashSession(encargada, session!.id))?.cashier).toBe(
      "cashier",
    );
    const other = await salesCompany();
    expect(await getCashSession(other, session!.id)).toBeNull();
  });
});
