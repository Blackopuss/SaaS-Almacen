import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import {
  reconcileStock,
  reconcileValue,
  registerEntry,
  reverseMovement,
} from "@/modules/inventory";
import {
  cancelSale,
  findReturnByKey,
  getMyCashSession,
  getReturnableSale,
  recordCashMovement,
  registerSale,
  returnSale,
  setSalePrices,
  updateSalesSettings,
  type ReturnInput,
} from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createPresentation, createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-19..21 (ADR 0030): what comes back of a sale enters stock at the
// cost it left with and its money goes back by the method chosen; never
// more than was sold; the last return closes the total to the cent; a
// cancelled sale returns everything and stays marked.

type Actor = { organizationId: string; userId: string };

let skus = 0;
async function screws(actor: Actor) {
  const created = await createProduct(actor, {
    sku: `D-${++skus}`,
    name: `Tornillo ${skus}`,
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
    unitCost: "0.90",
  });
  await setSalePrices(actor, created.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  return { productId: created.productId, boxId: box.presentationId };
}

/** One box and 3 pieces: $504.50. */
async function sold(
  actor: Actor,
  productId: string,
  boxId: string,
  payments: { method: string; received?: string; reference?: string }[] = [
    { method: "CASH", received: "600" },
  ],
) {
  const result = await registerSale(actor, {
    lines: [
      { productId, capture: `p:${boxId}`, quantity: "1" },
      { productId, capture: "base", quantity: "3" },
    ],
    payments,
    idempotencyKey: newId(),
  });
  if (!result.ok) throw new Error("sale setup failed");
  const lines = await db.saleLine.findMany({
    where: { saleId: result.saleId },
    orderBy: { lineNumber: "asc" },
    select: { id: true },
  });
  return { saleId: result.saleId, box: lines[0]!.id, pieces: lines[1]!.id };
}

const stockOf = async (productId: string) =>
  (
    await db.stockBalance.aggregate({
      where: { productId },
      _sum: { quantity: true },
    })
  )._sum.quantity?.toString();

const back = (
  lines: Record<string, string>,
  patch: Partial<ReturnInput> = {},
): ReturnInput => ({
  lines: Object.entries(lines).map(([saleLineId, quantity]) => ({
    saleLineId,
    quantity,
  })),
  reason: "No le quedó",
  refundMethod: "CASH",
  idempotencyKey: newId(),
  ...patch,
});

async function settled(organizationId: string) {
  expect(await reconcileStock(organizationId)).toEqual([]);
  expect(await reconcileValue(organizationId)).toEqual([]);
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("returns", () => {
  it("partial, then the rest: stock back at its cost, cash out of the register", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    expect(await stockOf(productId)).toBe("497");

    expect(
      await returnSale(actor, sale.saleId, back({ [sale.pieces]: "1" })),
    ).toEqual({ ok: true, returnId: expect.any(String), refund: "$1.50" });
    expect(await stockOf(productId)).toBe("498");
    expect((await getMyCashSession(actor))?.totals).toMatchObject({
      cashSales: "$504.50",
      cashRefunds: "$1.50",
      expectedCash: "$503.00",
    });

    expect(await getReturnableSale(actor, sale.saleId)).toMatchObject({
      refunded: "$1.50",
      lines: [
        { sold: "1", returned: "0", returnable: "1", unitPrice: "$500.00" },
        { sold: "3", returned: "1", returnable: "2", unitPrice: "$1.50" },
      ],
    });

    // Never more than what is left, and boxes come back whole.
    expect(
      await returnSale(
        actor,
        sale.saleId,
        back({ [sale.pieces]: "3", [sale.box]: "0.5" }),
      ),
    ).toMatchObject({
      ok: false,
      lineErrors: {
        [sale.pieces]: "Solo quedan 2 por devolver.",
        [sale.box]: "Escribe cuántas completas regresan.",
      },
    });
    expect(
      await returnSale(actor, sale.saleId, back({ [sale.pieces]: "" })),
    ).toMatchObject({
      ok: false,
      formError: "Escribe cuánto regresa de al menos un producto.",
    });

    // The last return gives back exactly what is left of the total.
    expect(
      await returnSale(
        actor,
        sale.saleId,
        back({ [sale.pieces]: "2", [sale.box]: "1" }),
      ),
    ).toMatchObject({ ok: true, refund: "$503.00" });
    expect(await stockOf(productId)).toBe("1000");
    expect((await getMyCashSession(actor))?.totals.expectedCash).toBe("$0.00");
    expect(
      await returnSale(actor, sale.saleId, back({ [sale.pieces]: "1" })),
    ).toMatchObject({
      ok: false,
      lineErrors: { [sale.pieces]: "De esta línea ya se devolvió todo." },
    });

    const movements = await db.stockMovement.findMany({
      where: { organizationId: actor.organizationId, type: "SALE_RETURN" },
      include: { lines: true },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0]!.reference).toBe("Venta 1");
    expect(
      movements.flatMap((m) => m.lines.map((l) => l.unitCost?.toString())),
    ).toEqual(["0.9", "0.9", "0.9"]);
    // A return is not reversed from Inventario either.
    expect(
      await reverseMovement(actor, {
        movementId: movements[0]!.id,
        reason: "Error",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, reason: "not_allowed" });
    const trail = await listAuditTrail(actor.organizationId, { limit: 10 });
    expect(trail.map((entry) => entry.action)).toContain("sales.returned");
    await settled(actor.organizationId);
  });

  it("cash only if the register has it; card and transfer need a reference", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId, [
      { method: "CARD", reference: "4421" },
    ]);
    expect(
      await returnSale(actor, sale.saleId, back({ [sale.box]: "1" })),
    ).toMatchObject({
      ok: false,
      fieldErrors: {
        refundMethod: expect.stringMatching(/debería haber \$0\.00/),
      },
    });
    expect(
      await returnSale(
        actor,
        sale.saleId,
        back({ [sale.box]: "1" }, { refundMethod: "CARD" }),
      ),
    ).toMatchObject({
      ok: false,
      fieldErrors: { reference: expect.stringMatching(/autorización/) },
    });
    expect(
      await returnSale(
        actor,
        sale.saleId,
        back({ [sale.box]: "1" }, { refundMethod: "CARD", reference: "9911" }),
      ),
    ).toMatchObject({ ok: true, refund: "$500.00" });
    const saved = await db.saleReturn.findFirstOrThrow({
      where: { saleId: sale.saleId },
    });
    expect([saved.reference, saved.cashSessionId]).toEqual(["9911", null]);
    expect((await getMyCashSession(actor))?.totals.expectedCash).toBe("$0.00");
    await settled(actor.organizationId);
  });

  it("with VAT added on top, it comes back with the VAT and closes to the cent", async () => {
    const actor = await salesCompany();
    const { productId } = await screws(actor);
    await updateSalesSettings(actor, { taxMode: "added", taxRate: "16" });
    const result = await registerSale(actor, {
      lines: [{ productId, capture: "base", quantity: "10" }],
      payments: [{ method: "CASH" }],
      idempotencyKey: newId(),
    });
    if (!result.ok) throw new Error("sale failed");
    expect(result.total).toBe("$17.40");
    const [line] = await db.saleLine.findMany({
      where: { saleId: result.saleId },
    });
    const refunds = [];
    for (const quantity of ["3", "3", "4"]) {
      const answer = await returnSale(
        actor,
        result.saleId,
        back({ [line!.id]: quantity }),
      );
      if (!answer.ok) throw new Error("return failed");
      refunds.push(answer.refund);
    }
    // 4.50 + 0.72 each; the last one is what is left of $17.40.
    expect(refunds).toEqual(["$5.22", "$5.22", "$6.96"]);
    await settled(actor.organizationId);
  });

  it("the same confirmation twice gives back once", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    const input = back({ [sale.pieces]: "2" });
    const first = await returnSale(actor, sale.saleId, input);
    const again = await returnSale(actor, sale.saleId, input);
    expect(first.ok && again.ok && again.returnId === first.returnId).toBe(
      true,
    );
    expect(again).toMatchObject({ repeated: true, refund: "$3.00" });
    expect(await stockOf(productId)).toBe("499");
    // After a lost answer, the key tells whether it was registered.
    expect(await findReturnByKey(actor, input.idempotencyKey)).toMatchObject({
      refund: "$3.00",
      cancelsSale: false,
    });

    const encargada = await salesMember(actor.organizationId, "cash_manager");
    expect(await returnSale(encargada, sale.saleId, input)).toMatchObject({
      ok: false,
      reason: "not_allowed",
    });
    expect(await findReturnByKey(encargada, input.idempotencyKey)).toBeNull();
  });

  it("two people returning the same at once: it comes back once", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    const encargada = await salesMember(actor.organizationId, "cash_manager");
    await recordCashMovement(encargada, {
      direction: "IN",
      amount: "100",
      reason: "Cambio",
    });
    const answers = await Promise.all([
      returnSale(actor, sale.saleId, back({ [sale.pieces]: "3" })),
      returnSale(encargada, sale.saleId, back({ [sale.pieces]: "3" })),
    ]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(await stockOf(productId)).toBe("500");
    await settled(actor.organizationId);
  });
});

describe("cancelling a sale", () => {
  it("returns what is left, marks it and keeps it", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    await returnSale(actor, sale.saleId, back({ [sale.pieces]: "1" }));
    const input = {
      reason: "Cobrada dos veces",
      refundMethod: "CASH",
      idempotencyKey: newId(),
    };
    expect(await cancelSale(actor, sale.saleId, input)).toMatchObject({
      ok: true,
      refund: "$503.00",
    });
    expect(await stockOf(productId)).toBe("1000");
    expect(
      await db.sale.findUniqueOrThrow({ where: { id: sale.saleId } }),
    ).toMatchObject({
      status: "CANCELLED",
      cancelledByUserId: actor.userId,
      cancelReason: "Cobrada dos veces",
    });
    expect(await getReturnableSale(actor, sale.saleId)).toMatchObject({
      cancelled: true,
      refunded: "$504.50",
    });
    // The same confirmation is a retry; another one finds it cancelled.
    expect(await cancelSale(actor, sale.saleId, input)).toMatchObject({
      ok: true,
      repeated: true,
    });
    expect(
      await cancelSale(actor, sale.saleId, {
        ...input,
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, formError: "Esta venta ya está cancelada." });
    expect(
      await returnSale(actor, sale.saleId, back({ [sale.box]: "1" })),
    ).toMatchObject({ ok: false, formError: "Esta venta ya está cancelada." });
    const trail = await listAuditTrail(actor.organizationId, { limit: 10 });
    expect(trail.map((entry) => entry.action)).toContain("sales.cancelled");
    await settled(actor.organizationId);
  });

  it("asks for a reason", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    expect(
      await cancelSale(actor, sale.saleId, {
        reason: "",
        refundMethod: "CASH",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, fieldErrors: { reason: expect.any(String) } });
  });
});

describe("who may", () => {
  it("a cashier neither returns nor cancels; a cash manager does", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    const cajero = await salesMember(actor.organizationId, "cashier");
    await expect(
      returnSale(cajero, sale.saleId, back({ [sale.pieces]: "1" })),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      cancelSale(cajero, sale.saleId, {
        reason: "Error",
        refundMethod: "CASH",
        idempotencyKey: newId(),
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const encargada = await salesMember(actor.organizationId, "cash_manager");
    expect(
      await returnSale(
        encargada,
        sale.saleId,
        back(
          { [sale.pieces]: "1" },
          { refundMethod: "TRANSFER", reference: "SPEI-1" },
        ),
      ),
    ).toMatchObject({ ok: true, refund: "$1.50" });
  });

  it("another company's sale does not exist", async () => {
    const actor = await salesCompany();
    const { productId, boxId } = await screws(actor);
    const sale = await sold(actor, productId, boxId);
    const other = await salesCompany();
    expect(await getReturnableSale(other, sale.saleId)).toBeNull();
    expect(
      await returnSale(other, sale.saleId, back({ [sale.pieces]: "1" })),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(
      await cancelSale(other, sale.saleId, {
        reason: "Ajena",
        refundMethod: "CASH",
        idempotencyKey: newId(),
      }),
    ).toMatchObject({ ok: false, reason: "not_found" });
    expect(await stockOf(productId)).toBe("497");
  });
});
