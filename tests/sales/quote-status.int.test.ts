import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib";
import {
  acceptQuote,
  createQuote,
  getQuote,
  markQuoteSent,
  rejectQuote,
  setSalePrices,
  updateQuote,
} from "@/modules/sales";
import { createProduct } from "@/platform/catalog";
import { createCustomer } from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-04 (ADR 0030): a quote goes draft → sent → accepted or rejected,
// following one table the database repeats; expired is read from its day.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

async function draft() {
  const titular = await salesCompany();
  const product = await createProduct(titular, { sku: "E-1", name: "Pala" });
  if (!product.ok) throw new Error("product setup failed");
  await setSalePrices(titular, product.productId, {
    unitPrice: "250",
    presentations: {},
  });
  const customer = await createCustomer(titular, { name: "Obra Norte" });
  if (!customer.ok) throw new Error("customer setup failed");
  const input = {
    customerId: customer.customer.id,
    lines: [{ productId: product.productId, capture: "base", quantity: "2" }],
  };
  const quote = await createQuote(titular, input);
  if (!quote.ok) throw new Error("quote setup failed");
  return { titular, quoteId: quote.quoteId, input };
}

const expire = (quoteId: string) =>
  db.salesQuote.update({
    where: { id: quoteId },
    data: { validUntil: new Date("2020-01-31T00:00:00.000Z") },
  });

const actions = (quoteId: string) =>
  db.auditEvent.findMany({
    where: { targetId: quoteId, action: { startsWith: "sales.quote_" } },
    orderBy: { id: "asc" },
    select: { action: true, reason: true },
  });

describe("states of a quote", () => {
  it("handed over, then accepted: once each, and the draft no longer changes", async () => {
    const { titular, quoteId, input } = await draft();
    expect(await acceptQuote(titular, quoteId)).toMatchObject({
      ok: false,
      reason: "invalid_state",
      error: expect.stringMatching(/Primero envía/),
    });
    expect(await markQuoteSent(titular, quoteId)).toEqual({ ok: true });
    expect(await markQuoteSent(titular, quoteId)).toEqual({
      ok: true,
      repeated: true,
    });
    expect(await updateQuote(titular, quoteId, input)).toMatchObject({
      ok: false,
      reason: "not_draft",
    });
    expect(await acceptQuote(titular, quoteId)).toEqual({ ok: true });
    expect(await getQuote(titular, quoteId)).toMatchObject({
      status: "ACCEPTED",
      statusLabel: "Aceptada",
      decision: { rejectReason: null },
    });
    expect(await rejectQuote(titular, quoteId, "Ya no")).toMatchObject({
      ok: false,
      error: "Esta cotización ya se aceptó.",
    });
    expect((await actions(quoteId)).map((event) => event.action)).toEqual([
      "sales.quote_created",
      "sales.quote_sent",
      "sales.quote_accepted",
    ]);
  });

  it("rejected with its reason", async () => {
    const { titular, quoteId } = await draft();
    await markQuoteSent(titular, quoteId);
    expect(await rejectQuote(titular, quoteId, "")).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(await rejectQuote(titular, quoteId, "Compró en otro lado")).toEqual({
      ok: true,
    });
    const quote = await getQuote(titular, quoteId);
    expect(quote).toMatchObject({
      status: "REJECTED",
      decision: { rejectReason: "Compró en otro lado" },
    });
    expect(quote!.decision!.by).toBeTruthy();
    expect(await acceptQuote(titular, quoteId)).toMatchObject({
      ok: false,
      error: "Esta cotización ya se rechazó.",
    });
  });

  it("expired: not accepted, still rejected; a past draft is not sent", async () => {
    const { titular, quoteId } = await draft();
    await expire(quoteId);
    expect(await markQuoteSent(titular, quoteId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/vigencia/),
    });
    await db.salesQuote.update({
      where: { id: quoteId },
      data: { status: "SENT", sentAt: new Date() },
    });
    expect((await getQuote(titular, quoteId))?.status).toBe("EXPIRED");
    expect(await acceptQuote(titular, quoteId)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/venció/),
    });
    expect(await rejectQuote(titular, quoteId, "Se le pasó la fecha")).toEqual({
      ok: true,
    });
  });

  it("the database follows the same table", async () => {
    const { titular, quoteId } = await draft();
    await markQuoteSent(titular, quoteId);
    await expect(
      db.salesQuote.update({
        where: { id: quoteId },
        data: { status: "DRAFT", sentAt: null },
      }),
    ).rejects.toThrow(/not allowed/);
    await acceptQuote(titular, quoteId);
    await expect(
      db.salesQuote.update({
        where: { id: quoteId },
        data: {
          status: "REJECTED",
          rejectReason: "Cambio",
        },
      }),
    ).rejects.toThrow(/not allowed/);
  });

  it("two answers at once: one wins", async () => {
    const { titular, quoteId } = await draft();
    await markQuoteSent(titular, quoteId);
    const answers = await Promise.all([
      acceptQuote(titular, quoteId),
      rejectQuote(titular, quoteId, "No le convenció"),
    ]);
    expect(answers.filter((answer) => answer.ok)).toHaveLength(1);
    expect(answers.filter((answer) => !answer.ok)).toMatchObject([
      { reason: "invalid_state" },
    ]);
  });

  it("only who may quote, and only in the company", async () => {
    const { titular, quoteId } = await draft();
    const consulta = await salesMember(titular.organizationId, "viewer");
    await expect(markQuoteSent(consulta, quoteId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(rejectQuote(consulta, quoteId, "")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const cajera = await salesMember(titular.organizationId, "cashier");
    expect(await markQuoteSent(cajera, quoteId)).toEqual({ ok: true });
    const other = await salesCompany();
    expect(await acceptQuote(other, quoteId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });
});
