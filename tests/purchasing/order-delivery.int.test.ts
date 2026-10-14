import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  ORDER_DELIVERY_JOB_TYPE,
  ORDER_DELIVERY_MAX_ATTEMPTS,
  addOrderLine,
  cancelPurchaseOrder,
  createPurchaseOrder,
  getOrderDeliveries,
  requestOrderDelivery,
  submitPurchaseOrder,
  type PurchasingActor,
} from "@/modules/purchasing";
import { moduleRegistry } from "@/modules/registry";
import { jobHandlers } from "@/modules/registry/jobs";
import { provisionCompany } from "@/platform/billing";
import { createProduct } from "@/platform/catalog";
import { createSupplier, updateSupplier } from "@/platform/contacts";
import {
  InvalidEmailError,
  memoryOutboxFor,
  purchaseOrderEmail,
  sendEmail,
} from "@/platform/email";
import { invalidateEntitlements } from "@/platform/entitlements";
import { runNextJob, settleFailedJobs, type RunOutcome } from "@/platform/jobs";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// CMP-06B: the order goes to its supplier by mail from the worker; a
// failure is seen and can be tried again.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  const user = await db.user.create({
    data: {
      id: newId(),
      name,
      email: `envio.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(name = "Ferretería El Tornillo Feliz") {
  const owner = await newUser("Ana Dueña");
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
      productLimit: 50,
      users: 10,
      modules: ["inventory", "purchasing"],
      validUntil: null,
      reason: "Prueba del envío de órdenes",
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
  const assigned = await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId, roleId: assigned.id };
}

let suppliers = 0;
const address = () => `ventas.${++suppliers}.${stamp}@proveedor.example`;

/** An order for a supplier with that address; confirmed unless told not to. */
async function order(
  actor: PurchasingActor,
  email: string | undefined,
  options: { confirm?: boolean; contactPerson?: string } = {},
) {
  const supplier = await createSupplier(actor, {
    name: `Ferretera del Norte ${newId().slice(-6)}`,
    contactPerson: options.contactPerson,
    email,
  });
  if (!supplier.ok) throw new Error("supplier setup failed");
  const created = await createPurchaseOrder(actor, {
    supplierId: supplier.supplierId,
    expectedOn: "2026-10-20",
  });
  if (!created.ok) throw new Error("order setup failed");
  const product = await createProduct(actor, {
    sku: `ENV-${newId().slice(-8)}`,
    name: "Tornillo hexagonal",
  });
  if (!product.ok) throw new Error("product setup failed");
  const line = await addOrderLine(actor, created.orderId, {
    productId: product.productId,
    capture: "base",
    quantity: "25",
    unitCost: "1.50",
  });
  if (!line.ok) throw new Error("line setup failed");
  if (options.confirm !== false) {
    const sent = await submitPurchaseOrder(actor, created.orderId);
    if (!sent.ok) throw new Error("confirm setup failed");
  }
  return { orderId: created.orderId, supplierId: supplier.supplierId };
}

const deliveryOf = (id: string) =>
  db.purchaseOrderDelivery.findUniqueOrThrow({ where: { id } });

const statusOf = async (orderId: string) =>
  (await db.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })).status;

const audits = (orderId: string, action: string) =>
  db.auditEvent.findMany({ where: { action, targetId: orderId } });

/**
 * Runs the worker until it has dealt with that job once, at a moment far
 * enough ahead for any wait between tries to be over. Other jobs left in
 * the queue by other tests are simply run on the way.
 */
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

async function request(actor: PurchasingActor, orderId: string) {
  const result = await requestOrderDelivery(actor, orderId);
  if (!result.ok) throw new Error(`request refused: ${result.message}`);
  const row = await deliveryOf(result.deliveryId);
  return { ...result, jobId: row.jobId };
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("requestOrderDelivery and its worker", () => {
  it("sends the order to the supplier with its PDF and says so on the order", async () => {
    const actor = await company();
    const to = address();
    const { orderId } = await order(actor, to, {
      contactPerson: "Laura Méndez",
    });

    const asked = await request(actor, orderId);
    expect(asked.recipient).toBe(to);
    // Nothing leaves in the request of the person: the worker sends it.
    expect(memoryOutboxFor(to)).toHaveLength(0);
    expect(await deliveryOf(asked.deliveryId)).toMatchObject({
      status: "QUEUED",
      recipient: to,
      requestedByUserId: actor.userId,
      sentAt: null,
    });
    const job = await db.job.findUniqueOrThrow({ where: { id: asked.jobId } });
    expect(job).toMatchObject({
      organizationId: actor.organizationId,
      type: ORDER_DELIVERY_JOB_TYPE,
      createdByUserId: actor.userId,
      maxAttempts: ORDER_DELIVERY_MAX_ATTEMPTS,
    });
    // Ids only: neither the company nor the address travel in the job.
    expect(job.payload).toEqual({ deliveryId: asked.deliveryId });

    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });

    const [mail] = memoryOutboxFor(to);
    expect(memoryOutboxFor(to)).toHaveLength(1);
    expect(mail!.subject).toBe(
      "Orden de compra OC-0001 de Ferretería El Tornillo Feliz",
    );
    expect(mail!.text).toContain("Hola, Laura Méndez:");
    expect(mail!.text).toContain("orden de compra OC-0001");
    expect(mail!.text).toContain("20 oct 2026");
    // Answers go to the person who sent it, not to the system.
    const sender = await db.user.findUniqueOrThrow({
      where: { id: actor.userId },
    });
    expect(mail!.replyTo).toBe(sender.email);
    expect(mail!.text).toContain(`Ana Dueña (${sender.email})`);
    expect(mail!.attachments).toHaveLength(1);
    const pdf = mail!.attachments![0]!;
    expect(pdf).toMatchObject({
      name: "OC-0001.pdf",
      contentType: "application/pdf",
    });
    const bytes = Buffer.from(pdf.content, "base64");
    expect(bytes.byteLength).toBe(pdf.size);
    const text = bytes.toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text).toContain("(ORDEN DE COMPRA) Tj");
    expect(text).toContain("(Tornillo hexagonal) Tj");

    const closed = await deliveryOf(asked.deliveryId);
    expect(closed.status).toBe("SENT");
    expect(closed.sentAt).toBeInstanceOf(Date);
    // Mailing it does not move the order.
    expect(await statusOf(orderId)).toBe("SENT");

    expect(
      await audits(orderId, "purchase_order.delivery_requested"),
    ).toHaveLength(1);
    const [delivered] = await audits(orderId, "purchase_order.delivered");
    expect(delivered).toMatchObject({
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
    });
    expect(delivered!.metadata).toMatchObject({ orden: "OC-0001", correo: to });

    const panel = await getOrderDeliveries(actor, orderId);
    expect(panel).toMatchObject({
      inProgress: false,
      send: { ok: true, recipient: to },
    });
    expect(panel!.deliveries).toHaveLength(1);
    expect(panel!.deliveries[0]).toMatchObject({
      status: "SENT",
      statusLabel: "Enviado",
      recipient: to,
    });
  });

  it("shows a failure, tries again by itself and lets a person retry", async () => {
    const actor = await company();
    // `.invalid` never exists: the test driver cannot deliver there.
    const dead = `ventas.${stamp}@proveedor-caido.invalid`;
    const { orderId, supplierId } = await order(actor, dead);
    const asked = await request(actor, orderId);

    for (let attempt = 1; attempt < ORDER_DELIVERY_MAX_ATTEMPTS; attempt++) {
      expect(await work(asked.jobId)).toMatchObject({
        kind: "retry",
        attempt,
      });
      // Between tries the screen says it did not leave and that it will
      // be tried again; the request is still open.
      const panel = await getOrderDeliveries(actor, orderId);
      expect(panel!.inProgress).toBe(true);
      expect(panel!.deliveries[0]).toMatchObject({
        status: "QUEUED",
        attempts: attempt,
        maxAttempts: ORDER_DELIVERY_MAX_ATTEMPTS,
        retrying: true,
      });
    }
    expect(await work(asked.jobId)).toMatchObject({ kind: "failed" });
    // The job ended; the request is closed when the failed ones are settled.
    expect((await deliveryOf(asked.deliveryId)).status).toBe("QUEUED");
    await settleFailedJobs(jobHandlers);

    const failed = await deliveryOf(asked.deliveryId);
    expect(failed.status).toBe("FAILED");
    expect(failed.failedAt).toBeInstanceOf(Date);
    expect(failed.failureReason).toMatch(/No se pudo entregar el correo/);
    // What people read never carries the answer of the mail server.
    expect(failed.failureReason).not.toContain(dead);
    expect(memoryOutboxFor(dead)).toHaveLength(0);
    const [event] = await audits(orderId, "purchase_order.delivery_failed");
    expect(event).toMatchObject({ actorUserId: null });
    expect(event!.metadata).toMatchObject({ pedidoPor: actor.userId });
    // Settling again does not close it twice.
    await settleFailedJobs(jobHandlers);
    expect(
      await audits(orderId, "purchase_order.delivery_failed"),
    ).toHaveLength(1);
    expect(await statusOf(orderId)).toBe("SENT");

    const panel = await getOrderDeliveries(actor, orderId);
    expect(panel).toMatchObject({ inProgress: false, send: { ok: true } });
    expect(panel!.deliveries[0]).toMatchObject({
      status: "FAILED",
      statusLabel: "No se envió",
    });

    // The address is corrected and the person asks again: a new request,
    // to the address of now; the failed one stays as history.
    const good = address();
    const fixed = await updateSupplier(
      actor,
      supplierId,
      {
        name: "Ferretera del Norte corregida",
        email: good,
      },
      { acceptDuplicates: true },
    );
    expect(fixed.ok).toBe(true);
    const again = await request(actor, orderId);
    expect(again.deliveryId).not.toBe(asked.deliveryId);
    expect(again.recipient).toBe(good);
    expect(await work(again.jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(good)).toHaveLength(1);
    expect((await deliveryOf(again.deliveryId)).status).toBe("SENT");
    expect((await deliveryOf(asked.deliveryId)).status).toBe("FAILED");
    const history = await getOrderDeliveries(actor, orderId);
    expect(history!.deliveries.map((row) => row.status)).toEqual([
      "SENT",
      "FAILED",
    ]);
  });

  it("asks once when the button is pressed twice", async () => {
    const actor = await company();
    const to = address();
    const { orderId } = await order(actor, to);
    const [first, second] = await Promise.all([
      requestOrderDelivery(actor, orderId),
      requestOrderDelivery(actor, orderId),
    ]);
    if (!first.ok || !second.ok) throw new Error("request refused");
    expect(second.deliveryId).toBe(first.deliveryId);
    expect([first.repeated, second.repeated].filter(Boolean)).toHaveLength(1);
    expect(await db.purchaseOrderDelivery.count({ where: { orderId } })).toBe(
      1,
    );
    expect(
      await db.job.count({
        where: {
          organizationId: actor.organizationId,
          type: ORDER_DELIVERY_JOB_TYPE,
        },
      }),
    ).toBe(1);
    const { jobId } = await deliveryOf(first.deliveryId);
    expect(await work(jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(to)).toHaveLength(1);
  });

  it("sends once even when the job runs again", async () => {
    const actor = await company();
    const to = address();
    const { orderId } = await order(actor, to);
    const asked = await request(actor, orderId);
    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    // The same job, taken again as if its worker had disappeared.
    const handler = jobHandlers[ORDER_DELIVERY_JOB_TYPE]!;
    const context = {
      jobId: asked.jobId,
      organizationId: actor.organizationId,
      createdByUserId: actor.userId,
      payload: { deliveryId: asked.deliveryId },
      attempt: 2,
      maxAttempts: ORDER_DELIVERY_MAX_ATTEMPTS,
    };
    expect(await handler.handle(context)).toMatchObject({ sent: false });
    // Nor does a late settlement turn a sent one into a failed one.
    await handler.onFailed!(context);
    expect(memoryOutboxFor(to)).toHaveLength(1);
    expect((await deliveryOf(asked.deliveryId)).status).toBe("SENT");
    expect(await audits(orderId, "purchase_order.delivered")).toHaveLength(1);
    expect(
      await audits(orderId, "purchase_order.delivery_failed"),
    ).toHaveLength(0);
  });

  it("sends only what is an order: not a draft, not a cancelled one", async () => {
    const actor = await company();
    const to = address();
    const draft = await order(actor, to, { confirm: false });
    expect(await requestOrderDelivery(actor, draft.orderId)).toMatchObject({
      ok: false,
      reason: "invalid_state",
      message: expect.stringMatching(/borrador/),
    });
    expect(await getOrderDeliveries(actor, draft.orderId)).toMatchObject({
      deliveries: [],
      send: { ok: false },
    });

    const cancelled = await order(actor, to);
    await cancelPurchaseOrder(actor, cancelled.orderId, {
      reason: "Ya no se necesita",
    });
    expect(await requestOrderDelivery(actor, cancelled.orderId)).toMatchObject({
      ok: false,
      reason: "invalid_state",
      message: expect.stringMatching(/cancelada/),
    });

    expect(await requestOrderDelivery(actor, newId())).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(
      await db.purchaseOrderDelivery.count({
        where: {
          orderId: { in: [draft.orderId, cancelled.orderId] },
        },
      }),
    ).toBe(0);
    expect(memoryOutboxFor(to)).toHaveLength(0);
  });

  it("does not send an order cancelled while it waited", async () => {
    const actor = await company();
    const to = address();
    const { orderId } = await order(actor, to);
    const asked = await request(actor, orderId);
    await cancelPurchaseOrder(actor, orderId, { reason: "Cambió el pedido" });

    // The job ends well: there is nothing to try again.
    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(to)).toHaveLength(0);
    const closed = await deliveryOf(asked.deliveryId);
    expect(closed.status).toBe("FAILED");
    expect(closed.failureReason).toMatch(/se canceló antes de mandarse/);
  });

  it("needs a supplier with an address, and uses only that one", async () => {
    const actor = await company();
    const { orderId, supplierId } = await order(actor, undefined);
    const refused = await requestOrderDelivery(actor, orderId);
    expect(refused).toMatchObject({ ok: false, reason: "no_recipient" });
    expect(await getOrderDeliveries(actor, orderId)).toMatchObject({
      send: { ok: false, problem: expect.stringMatching(/no tiene correo/) },
    });

    // The address of the request is the one the supplier had then, even
    // if the card changes before the worker gets to it.
    const first = address();
    await updateSupplier(
      actor,
      supplierId,
      {
        name: "Proveedor con correo",
        email: first,
      },
      { acceptDuplicates: true },
    );
    const asked = await request(actor, orderId);
    const later = address();
    await updateSupplier(
      actor,
      supplierId,
      {
        name: "Proveedor con correo",
        email: later,
      },
      { acceptDuplicates: true },
    );
    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(first)).toHaveLength(1);
    expect(memoryOutboxFor(later)).toHaveLength(0);
  });

  it("stops after five requests of an order in a day", async () => {
    const actor = await company();
    const to = address();
    const { orderId } = await order(actor, to);
    for (let sent = 0; sent < 5; sent++) {
      const asked = await request(actor, orderId);
      expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    }
    expect(await requestOrderDelivery(actor, orderId)).toMatchObject({
      ok: false,
      reason: "limit",
    });
    expect(memoryOutboxFor(to)).toHaveLength(5);
  });
});

describe("who may send orders", () => {
  it("is for owner, administrator and buyer; not for warehouse or viewer (NEG-01)", async () => {
    const owner = await company();
    const to = address();
    const { orderId } = await order(owner, to);
    for (const role of ["warehouse", "viewer"] as const) {
      const person = await member(owner.organizationId, role);
      await expect(requestOrderDelivery(person, orderId)).rejects.toMatchObject(
        { kind: "forbidden" },
      );
    }
    // A viewer sees what was sent, but is not offered to send.
    const viewer = await member(owner.organizationId, "viewer");
    const seen = await getOrderDeliveries(viewer, orderId);
    expect(seen).not.toBeNull();
    expect(seen).not.toHaveProperty("send");
    // Warehouse does not read orders at all.
    const warehouse = await member(owner.organizationId, "warehouse");
    await expect(getOrderDeliveries(warehouse, orderId)).rejects.toMatchObject({
      kind: "forbidden",
    });
    expect(await db.purchaseOrderDelivery.count({ where: { orderId } })).toBe(
      0,
    );

    for (const role of ["administrator", "buyer"] as const) {
      const person = await member(owner.organizationId, role);
      const asked = await request(person, orderId);
      expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    }
    expect(memoryOutboxFor(to)).toHaveLength(2);
  });

  it("does not send for someone who lost the permission meanwhile (NEG-20)", async () => {
    const owner = await company();
    const to = address();
    const { orderId } = await order(owner, to);
    const buyer = await member(owner.organizationId, "buyer");
    const asked = await request(buyer, orderId);

    // Before the worker gets to it, the person is left as a viewer.
    await db.membershipRole.update({
      where: { id: buyer.roleId },
      data: { role: "viewer" },
    });

    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(to)).toHaveLength(0);
    const closed = await deliveryOf(asked.deliveryId);
    expect(closed.status).toBe("FAILED");
    expect(closed.failureReason).toMatch(/ya no puede enviar órdenes/);
    expect(await audits(orderId, "purchase_order.delivered")).toHaveLength(0);
    // Someone who still may can send it.
    const again = await request(owner, orderId);
    expect(await work(again.jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(to)).toHaveLength(1);
  });

  it("does not send once the module is only for reading", async () => {
    const owner = await company();
    const to = address();
    const { orderId } = await order(owner, to);
    const asked = await request(owner, orderId);
    await db.entitlement.updateMany({
      where: { organizationId: owner.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * 86_400_000),
        validUntil: new Date(Date.now() - 86_400_000),
      },
    });
    invalidateEntitlements(owner.organizationId);

    await expect(requestOrderDelivery(owner, orderId)).rejects.toMatchObject({
      kind: "forbidden",
    });
    expect(await work(asked.jobId)).toMatchObject({ kind: "done" });
    expect(memoryOutboxFor(to)).toHaveLength(0);
    expect((await deliveryOf(asked.deliveryId)).status).toBe("FAILED");
  });

  it("never reaches the order of another company", async () => {
    const a = await company("Empresa A");
    const b = await company("Empresa B");
    const to = address();
    const { orderId } = await order(b, to);

    expect(await requestOrderDelivery(a, orderId)).toMatchObject({
      ok: false,
      reason: "not_found",
    });
    expect(await getOrderDeliveries(a, orderId)).toBeNull();

    // A job of A naming a request of B finds nothing: the company is the
    // one of the job.
    const asked = await request(b, orderId);
    const handler = jobHandlers[ORDER_DELIVERY_JOB_TYPE]!;
    const forged = {
      jobId: newId(),
      organizationId: a.organizationId,
      createdByUserId: a.userId,
      payload: { deliveryId: asked.deliveryId },
      attempt: 1,
      maxAttempts: ORDER_DELIVERY_MAX_ATTEMPTS,
    };
    expect(await handler.handle(forged)).toMatchObject({ sent: false });
    await handler.onFailed!(forged);
    expect(memoryOutboxFor(to)).toHaveLength(0);
    expect((await deliveryOf(asked.deliveryId)).status).toBe("QUEUED");
    expect(
      await forOrganization(a.organizationId).purchaseOrderDelivery.count(),
    ).toBe(0);
  });
});

describe("the table of deliveries", () => {
  it("keeps a finished delivery as it ended, and never loses one", async () => {
    const actor = await company();
    const { orderId } = await order(actor, address());
    const asked = await request(actor, orderId);
    await work(asked.jobId);

    await expect(
      db.purchaseOrderDelivery.update({
        where: { id: asked.deliveryId },
        data: { status: "QUEUED", sentAt: null },
      }),
    ).rejects.toThrow();
    await expect(
      db.purchaseOrderDelivery.delete({ where: { id: asked.deliveryId } }),
    ).rejects.toThrow();
    expect((await deliveryOf(asked.deliveryId)).status).toBe("SENT");
  });

  it("refuses a delivery of a draft and an address that is not one", async () => {
    const actor = await company();
    const draft = await order(actor, address(), { confirm: false });
    const row = (orderId: string, recipient: string) =>
      db.purchaseOrderDelivery.create({
        data: {
          id: newId(),
          organizationId: actor.organizationId,
          orderId,
          recipient,
          jobId: newId(),
          requestedByUserId: actor.userId,
        },
      });
    await expect(
      row(draft.orderId, "ventas@proveedor.example"),
    ).rejects.toThrow();
    const sent = await order(actor, address());
    await expect(
      row(sent.orderId, "ventas@proveedor.example\nBcc: otro@x.example"),
    ).rejects.toThrow();
    await expect(row(sent.orderId, "sin-arroba")).rejects.toThrow();
  });
});

describe("sendEmail", () => {
  const pdf = {
    name: "OC-0001.pdf",
    contentType: "application/pdf",
    content: Buffer.from("%PDF-1.4\n"),
  };

  it("refuses a message whose headers carry a line break", async () => {
    const to = address();
    for (const message of [
      { to: `${to}\r\nBcc: otro@x.example`, subject: "Hola", text: "x" },
      { to, subject: "Hola\r\nBcc: otro@x.example", text: "x" },
      { to, subject: "Hola Bcc: otro@x.example", text: "x" },
      {
        to,
        replyTo: `ana@x.example\nBcc: otro@x.example`,
        subject: "Hola",
        text: "x",
      },
      { to: `${to}, otro@x.example`, subject: "Hola", text: "x" },
      {
        to,
        subject: "Hola",
        text: "x",
        attachments: [{ ...pdf, name: "a\r\nb.pdf" }],
      },
      {
        to,
        subject: "Hola",
        text: "x",
        attachments: [{ ...pdf, name: "../a.pdf" }],
      },
      {
        to,
        subject: "Hola",
        text: "x",
        attachments: [{ ...pdf, contentType: "text/html\r\nX: y" }],
      },
    ]) {
      await expect(sendEmail(message)).rejects.toBeInstanceOf(
        InvalidEmailError,
      );
    }
    expect(memoryOutboxFor(to)).toHaveLength(0);
  });

  it("keeps the names of a company and a supplier inside the subject and the text", () => {
    const mail = purchaseOrderEmail({
      to: "ventas@proveedor.example",
      greeting: "Laura\r\nBcc: otro@x.example",
      organizationName: "Tornillo\r\nBcc: otro@x.example",
      orderNumber: "OC-0001",
      sender: { name: "Ana", email: "ana@negocio.example" },
      pdf,
    });
    expect(mail.subject).toBe(
      "Orden de compra OC-0001 de Tornillo Bcc: otro@x.example",
    );
    expect(mail.text.split("\n")[0]).toBe("Hola, Laura Bcc: otro@x.example:");
    expect(mail.replyTo).toBe("ana@negocio.example");
  });
});
