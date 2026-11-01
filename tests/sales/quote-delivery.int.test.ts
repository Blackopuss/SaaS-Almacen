import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { jobHandlers } from "@/modules/registry/jobs";
import {
  QUOTE_DELIVERY_JOB_TYPE,
  buildQuotePdf,
  createQuote,
  getQuote,
  getQuoteDeliveries,
  requestQuoteDelivery,
  setSalePrices,
} from "@/modules/sales";
import { createPresentation, createProduct } from "@/platform/catalog";
import { createCustomer, setCustomerEmail } from "@/platform/contacts";
import { memoryOutboxFor } from "@/platform/email";
import { invalidateEntitlements } from "@/platform/entitlements";
import { runNextJob, settleFailedJobs, type RunOutcome } from "@/platform/jobs";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// COT-03 (ADR 0030): the quote as a PDF headed with the business, and
// mailed to its customer from the worker; asking for it sends the quote.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

type Actor = { organizationId: string; userId: string };

const stamp = Date.now();
let mails = 0;
const address = () => `cliente.${++mails}.${stamp}@obra.example`;

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

async function quoted(email?: string) {
  const titular = await salesCompany();
  const created = await createProduct(titular, {
    sku: `PDF-${newId().slice(-6)}`,
    name: "Tornillo hexagonal",
  });
  if (!created.ok) throw new Error("product setup failed");
  const box = await createPresentation(titular, created.productId, {
    name: "Caja",
    factor: "500",
  });
  if (!box.ok) throw new Error("presentation setup failed");
  await setSalePrices(titular, created.productId, {
    unitPrice: "1.50",
    presentations: { [box.presentationId]: "500" },
  });
  const customer = await createCustomer(titular, {
    name: "Constructora Ruiz",
    rfc: "CRU010203AB1",
  });
  if (!customer.ok) throw new Error("customer setup failed");
  if (email) await setCustomerEmail(titular, customer.customer.id, email);
  const quote = await createQuote(titular, {
    customerId: customer.customer.id,
    notes: "Entrega en obra el lunes",
    lines: [
      {
        productId: created.productId,
        capture: `p:${box.presentationId}`,
        quantity: "2",
      },
      { productId: created.productId, capture: "base", quantity: "3" },
    ],
  });
  if (!quote.ok) throw new Error("quote setup failed");
  return { titular, quoteId: quote.quoteId, customerId: customer.customer.id };
}

let clock = Date.now();
async function work(jobId: string): Promise<RunOutcome> {
  clock += 60 * 60 * 1000;
  const now = new Date(clock);
  for (let round = 0; round < 200; round++) {
    const outcome = await runNextJob(jobHandlers, {
      workerId: "test",
      now: () => now,
    });
    if (outcome.kind === "idle") return outcome;
    if (outcome.jobId === jobId) return outcome;
  }
  throw new Error("the job never came up");
}

async function request(actor: Actor, quoteId: string) {
  const result = await requestQuoteDelivery(actor, quoteId);
  if (!result.ok) throw new Error(`request refused: ${result.message}`);
  const row = await db.salesQuoteDelivery.findUniqueOrThrow({
    where: { id: result.deliveryId },
  });
  return { ...result, jobId: row.jobId };
}

const audits = (quoteId: string, action: string) =>
  db.auditEvent.findMany({ where: { action, targetId: quoteId } });

describe("the quote as a PDF", () => {
  it("headed with the business, with customer, lines, totals and validity", async () => {
    const { titular, quoteId } = await quoted();
    const pdf = await buildQuotePdf(titular, quoteId);
    if (!pdf) throw new Error("no pdf");
    expect(pdf).toMatchObject({
      name: "cotizacion-1.pdf",
      contentType: "application/pdf",
    });
    expectWellFormed(pdf.bytes);
    const [page] = pagesOf(pdf.bytes);
    const company = await db.organization.findUniqueOrThrow({
      where: { id: titular.organizationId },
    });
    for (const text of [
      company.name,
      "COTIZACIÓN",
      "BORRADOR · todavía no se envía",
      "Constructora Ruiz",
      "RFC CRU010203AB1",
      "Vale hasta:",
      "Tornillo hexagonal",
      "2 cajas de 500 piezas",
      "$1,004.50",
      "IVA incluido (16 %)",
      "Entrega en obra el lunes",
    ]) {
      expect(page, text).toContain(text);
    }
    expect(page).toContain("No es un comprobante fiscal.");
    expect(await audits(quoteId, "sales.quote_exported")).toHaveLength(1);
  });

  it("Consulta downloads it; Almacén and other companies do not", async () => {
    const { titular, quoteId } = await quoted();
    const consulta = await salesMember(titular.organizationId, "viewer");
    expect(await buildQuotePdf(consulta, quoteId)).not.toBeNull();
    const almacen = await salesMember(titular.organizationId, "warehouse");
    await expect(buildQuotePdf(almacen, quoteId)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    const other = await salesCompany();
    expect(await buildQuotePdf(other, quoteId)).toBeNull();
  });
});

describe("mailing a quote", () => {
  it("to the mail of the customer's card, from the worker; the draft becomes sent", async () => {
    const to = address();
    const { titular, quoteId } = await quoted(to);
    const asked = await request(titular, quoteId);
    expect(asked.recipient).toBe(to);
    expect(memoryOutboxFor(to)).toHaveLength(0);
    expect((await getQuote(titular, quoteId))?.status).toBe("SENT");
    const job = await db.job.findUniqueOrThrow({ where: { id: asked.jobId } });
    expect(job).toMatchObject({ type: QUOTE_DELIVERY_JOB_TYPE });
    expect(job.payload).toEqual({ deliveryId: asked.deliveryId });

    // While it is on its way, asking again answers with the same one.
    expect(await requestQuoteDelivery(titular, quoteId)).toMatchObject({
      ok: true,
      deliveryId: asked.deliveryId,
      repeated: true,
    });

    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    const [mail] = memoryOutboxFor(to);
    expect(memoryOutboxFor(to)).toHaveLength(1);
    const company = await db.organization.findUniqueOrThrow({
      where: { id: titular.organizationId },
    });
    expect(mail!.subject).toBe(`Cotización 1 de ${company.name}`);
    expect(mail!.text).toContain("Hola, Constructora Ruiz:");
    expect(mail!.text).toContain("$1,004.50");
    const sender = await db.user.findUniqueOrThrow({
      where: { id: titular.userId },
    });
    expect(mail!.replyTo).toBe(sender.email);
    expect(mail!.attachments![0]).toMatchObject({
      name: "cotizacion-1.pdf",
      contentType: "application/pdf",
    });
    const sentPdf = Buffer.from(mail!.attachments![0]!.content, "base64");
    // Sent, it no longer says it is a draft.
    expect(pagesOf(sentPdf)[0]).not.toContain("BORRADOR");

    const panel = await getQuoteDeliveries(titular, quoteId);
    expect(panel).toMatchObject({
      inProgress: false,
      send: { ok: true, recipient: to },
    });
    expect(panel!.deliveries[0]).toMatchObject({
      status: "SENT",
      statusLabel: "Enviado",
    });
    expect(await audits(quoteId, "sales.quote_sent")).toHaveLength(1);
    expect(await audits(quoteId, "sales.quote_delivered")).toHaveLength(1);
  });

  it("without a mail it says so, and the mail is written in the card first", async () => {
    const { titular, quoteId, customerId } = await quoted();
    expect(await requestQuoteDelivery(titular, quoteId)).toMatchObject({
      ok: false,
      reason: "no_recipient",
      message: expect.stringMatching(/no tiene correo/),
    });
    // Nothing changed: it is still a draft.
    expect((await getQuote(titular, quoteId))?.status).toBe("DRAFT");
    expect(await getQuoteDeliveries(titular, quoteId)).toMatchObject({
      send: { ok: false, missingEmail: { customerId } },
    });
    expect(
      await setCustomerEmail(titular, customerId, "no es correo"),
    ).toMatchObject({ ok: false, reason: "invalid" });
    const to = address();
    expect(
      await setCustomerEmail(titular, customerId, `  ${to.toUpperCase()} `),
    ).toEqual({ ok: true, email: to });
    expect((await request(titular, quoteId)).recipient).toBe(to);
    const cajera = await salesMember(titular.organizationId, "viewer");
    await expect(
      setCustomerEmail(cajera, customerId, address()),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a failed mail is seen and can be asked for again", async () => {
    const dead = `cliente.${stamp}@obra-caida.invalid`;
    const { titular, quoteId } = await quoted(dead);
    const asked = await request(titular, quoteId);
    for (let attempt = 1; attempt < 4; attempt++) {
      expect(await work(asked.jobId)).toMatchObject({ kind: "retry" });
    }
    expect(await work(asked.jobId)).toMatchObject({ kind: "failed" });
    await settleFailedJobs(jobHandlers);
    const failed = await db.salesQuoteDelivery.findUniqueOrThrow({
      where: { id: asked.deliveryId },
    });
    expect(failed.status).toBe("FAILED");
    expect(failed.failureReason).toMatch(/No se pudo entregar el correo/);
    expect(await audits(quoteId, "sales.quote_delivery_failed")).toHaveLength(
      1,
    );
    const again = await requestQuoteDelivery(titular, quoteId);
    expect(again).toMatchObject({ ok: true });
    if (again.ok) expect(again.deliveryId).not.toBe(asked.deliveryId);
  });

  it("not once rejected or expired, and only with permission", async () => {
    const { titular, quoteId } = await quoted(address());
    const consulta = await salesMember(titular.organizationId, "viewer");
    await expect(
      requestQuoteDelivery(consulta, quoteId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await db.salesQuote.update({
      where: { id: quoteId },
      data: { validUntil: new Date("2020-01-31T00:00:00.000Z") },
    });
    expect(await requestQuoteDelivery(titular, quoteId)).toMatchObject({
      ok: false,
      reason: "invalid_state",
      message: expect.stringMatching(/venció/),
    });
    const other = await salesCompany();
    expect(await requestQuoteDelivery(other, quoteId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("whoever asked must still be allowed when the worker sends it", async () => {
    const { titular, quoteId } = await quoted(address());
    const cajera = await salesMember(titular.organizationId, "cashier");
    const asked = await request(cajera, quoteId);
    await db.membershipRole.deleteMany({
      where: {
        organizationId: titular.organizationId,
        membership: { userId: cajera.userId },
      },
    });
    invalidateEntitlements();
    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    const row = await db.salesQuoteDelivery.findUniqueOrThrow({
      where: { id: asked.deliveryId },
    });
    expect(row.status).toBe("FAILED");
    expect(row.failureReason).toMatch(/ya no puede enviar cotizaciones/);
  });
});
