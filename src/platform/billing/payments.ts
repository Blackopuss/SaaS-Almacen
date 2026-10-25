import "server-only";

import { z } from "zod";

import { dec, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { invalidateEntitlements } from "@/platform/entitlements";
import { LOCKING_TRANSACTION, db, forOrganization } from "@/server";

import { isPlatformStaff } from "./provisioning";
import { extendValidity, mexicoDay, shortenValidity } from "./validity";

/**
 * Manual payments (PIL-11, ADR 0027). While billing is assisted, a pilot
 * pays by SPEI and platform staff register the transfer here. The payment
 * moves the end of the plan that provisioning assigned (MOD-09) and the
 * entitlements follow, in one transaction with the audit event: when the
 * plan had ended, the company leaves read-only (MOD-11) at once.
 *
 * The plan end is the end of the `active_products` limit, which
 * provisioning always writes; every entitlement that ends at that same
 * moment is the plan and moves with it. Modules removed earlier end at
 * another moment and stay closed.
 *
 * Payments are immutable: a mistake is reversed (same months back) and
 * registered again. The SPEI reference cannot repeat among payments of a
 * company that are not reversed; that check, under the company lock, also
 * makes a repeated submit register once.
 */

const MAX_AMOUNT = dec("9999999999.99");

/** "$12,500.50" → "12500.50"; null when it is not an amount. */
function parseAmount(text: string): string | null {
  const value = text
    .trim()
    .replace(/^\$\s*/, "")
    .replace(/,(?=\d{3}(\D|$))/g, "");
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(value)) return null;
  const amount = dec(value);
  return amount.isZero() || amount.greaterThan(MAX_AMOUNT)
    ? null
    : amount.toFixed(2);
}

/** "2026-10-03" → that day (UTC midnight); null when it is not a real day. */
function parseDay(text: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === text &&
    date.getUTCFullYear() >= 2020
    ? date
    : null;
}

const paymentSchema = z.object({
  amount: z.string().transform((value, context) => {
    const amount = parseAmount(value);
    if (amount === null) {
      context.addIssue({
        code: "custom",
        message: "Escribe el importe como 1250.50, mayor que cero.",
      });
      return z.NEVER;
    }
    return amount;
  }),
  paidOn: z.string().transform((value, context) => {
    const day = parseDay(value.trim());
    if (!day) {
      context.addIssue({ code: "custom", message: "Elige el día del pago." });
      return z.NEVER;
    }
    if (day > mexicoDay(new Date())) {
      context.addIssue({
        code: "custom",
        message: "El día del pago no puede ser posterior a hoy.",
      });
      return z.NEVER;
    }
    return day;
  }),
  reference: z
    .string()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .pipe(
      z
        .string()
        .min(1, "Escribe la clave de rastreo del SPEI.")
        .max(40, "La clave de rastreo es demasiado larga.")
        .regex(
          /^[A-Z0-9-]+$/,
          "La clave de rastreo solo lleva letras, números y guiones.",
        ),
    ),
  months: z.coerce
    .number("Elige cuántos meses paga.")
    .int("Los meses deben ser un número entero.")
    .min(1, "Paga al menos 1 mes.")
    .max(12, "Registra como máximo 12 meses por pago."),
  notes: z
    .string()
    .trim()
    .max(500, "Las notas son demasiado largas.")
    .transform((value) => value || null),
});

export type PaymentInput = {
  amount: string;
  /** Day of the transfer, YYYY-MM-DD. */
  paidOn: string;
  reference: string;
  months: number | string;
  notes: string;
};
export type PaymentField = keyof PaymentInput;

export type PaymentResult =
  | { ok: true; paymentId: string; validUntil: Date }
  | {
      ok: false;
      fieldErrors: Partial<Record<PaymentField, string>>;
      formError?: string;
    };

const NOT_STAFF = "No tienes permiso para hacer esto.";

class Rejected extends Error {
  constructor(readonly result: Extract<PaymentResult, { ok: false }>) {
    super("rejected");
  }
}

const reject = (
  formError: string,
  fieldErrors: Partial<Record<PaymentField, string>> = {},
) => new Rejected({ ok: false, fieldErrors, formError });

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Locks the company and returns the end of its plan. Rejects when there is
 * nothing a payment can move: no company, a plan with automatic billing,
 * no plan, or a plan without end date.
 */
async function lockPlanEnd(tx: Tx, organizationId: string): Promise<Date> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT id FROM organization WHERE id = ${organizationId} FOR UPDATE`;
  if (rows.length === 0) throw reject("Esa empresa no existe.");
  if ((await tx.subscription.count({ where: { organizationId } })) > 0) {
    throw reject(
      "Esta empresa tiene una suscripción: sus pagos no se registran a mano.",
    );
  }
  const plan = await tx.entitlement.findUnique({
    where: {
      organizationId_kind_key: {
        organizationId,
        kind: "LIMIT",
        key: "active_products",
      },
    },
    select: { validUntil: true },
  });
  if (!plan) {
    throw reject(
      "Esta empresa no tiene plan. Asígnalo antes de registrar pagos.",
    );
  }
  if (plan.validUntil === null) {
    throw reject(
      "El plan no tiene fecha de término. Asígnale una vigencia antes de registrar pagos.",
    );
  }
  return plan.validUntil;
}

/** Moves every entitlement of the plan (those ending at `from`) to `to`. */
async function movePlanEnd(
  tx: Tx,
  organizationId: string,
  from: Date,
  to: Date,
) {
  await tx.entitlement.updateMany({
    where: { organizationId, validUntil: from },
    data: { validUntil: to },
  });
}

async function inTransaction(
  organizationId: string,
  work: (tx: Tx) => Promise<{ paymentId: string; validUntil: Date }>,
): Promise<PaymentResult> {
  try {
    const done = await db.$transaction(work, LOCKING_TRANSACTION);
    invalidateEntitlements(organizationId);
    return { ok: true, ...done };
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

/** Registers a SPEI payment of a company and extends its plan. */
export async function recordManualPayment(
  staffUserId: string,
  organizationId: string,
  input: PaymentInput,
): Promise<PaymentResult> {
  if (!(await isPlatformStaff(staffUserId))) {
    return { ok: false, fieldErrors: {}, formError: NOT_STAFF };
  }
  const parsed = paymentSchema.safeParse({
    ...input,
    amount: String(input.amount ?? ""),
    paidOn: String(input.paidOn ?? ""),
    reference: String(input.reference ?? ""),
    notes: String(input.notes ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<PaymentField, string>> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path[0] as PaymentField] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const payment = parsed.data;

  return inTransaction(organizationId, async (tx) => {
    const before = await lockPlanEnd(tx, organizationId);
    const repeated = await tx.manualPayment.findFirst({
      where: {
        organizationId,
        kind: "PAYMENT",
        reference: payment.reference,
        reversal: { is: null },
      },
      select: { id: true },
    });
    if (repeated) {
      throw reject("Ese pago ya está registrado.", {
        reference: "Ya hay un pago con esta clave de rastreo.",
      });
    }
    const after = extendValidity(before, new Date(), payment.months);
    const id = newId();
    await tx.manualPayment.create({
      data: {
        id,
        organizationId,
        amount: payment.amount,
        paidOn: payment.paidOn,
        reference: payment.reference,
        months: payment.months,
        notes: payment.notes,
        validUntilBefore: before,
        validUntilAfter: after,
        recordedByUserId: staffUserId,
      },
    });
    await movePlanEnd(tx, organizationId, before, after);
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: staffUserId,
      action: "payment.recorded",
      target: { type: "manual_payment", id },
      reason: payment.notes ?? undefined,
      metadata: {
        amount: payment.amount,
        currency: "MXN",
        paidOn: payment.paidOn.toISOString().slice(0, 10),
        reference: payment.reference,
        months: payment.months,
        validUntilBefore: before.toISOString(),
        validUntilAfter: after.toISOString(),
        byPlatformStaff: true,
      },
    });
    return { paymentId: id, validUntil: after };
  });
}

const reasonSchema = z
  .string()
  .trim()
  .min(5, "Escribe por qué se anula (por ejemplo, el importe correcto).")
  .max(500, "El motivo es demasiado largo.");

/**
 * Reverses a payment registered by mistake: takes its months back from
 * the current end of the plan. It can then be registered again correctly.
 */
export async function reverseManualPayment(
  staffUserId: string,
  organizationId: string,
  paymentId: string,
  reason: string,
): Promise<PaymentResult> {
  if (!(await isPlatformStaff(staffUserId))) {
    return { ok: false, fieldErrors: {}, formError: NOT_STAFF };
  }
  const parsedReason = reasonSchema.safeParse(String(reason ?? ""));
  if (!parsedReason.success) {
    return {
      ok: false,
      fieldErrors: { notes: parsedReason.error.issues[0]!.message },
    };
  }

  return inTransaction(organizationId, async (tx) => {
    const before = await lockPlanEnd(tx, organizationId);
    const original = await tx.manualPayment.findFirst({
      where: { organizationId, id: String(paymentId), kind: "PAYMENT" },
      select: {
        id: true,
        amount: true,
        paidOn: true,
        reference: true,
        months: true,
        validUntilBefore: true,
        validUntilAfter: true,
        reversal: { select: { id: true } },
      },
    });
    if (!original) throw reject("Ese pago no existe.");
    if (original.reversal) throw reject("Ese pago ya está anulado.");
    const after = shortenValidity(
      before,
      new Date(),
      original.months,
      // Nothing moved the plan since this payment: put it back exactly.
      original.validUntilAfter.getTime() === before.getTime()
        ? original.validUntilBefore
        : null,
    );
    const id = newId();
    await tx.manualPayment.create({
      data: {
        id,
        organizationId,
        kind: "REVERSAL",
        amount: original.amount,
        paidOn: original.paidOn,
        months: original.months,
        notes: parsedReason.data,
        reversesPaymentId: original.id,
        validUntilBefore: before,
        validUntilAfter: after,
        recordedByUserId: staffUserId,
      },
    });
    await movePlanEnd(tx, organizationId, before, after);
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: staffUserId,
      action: "payment.reversed",
      target: { type: "manual_payment", id: original.id },
      reason: parsedReason.data,
      metadata: {
        amount: original.amount.toFixed(2),
        reference: original.reference,
        months: original.months,
        validUntilBefore: before.toISOString(),
        validUntilAfter: after.toISOString(),
        byPlatformStaff: true,
      },
    });
    return { paymentId: id, validUntil: after };
  });
}

export type ManualPaymentRow = {
  id: string;
  kind: "PAYMENT" | "REVERSAL";
  /** Exact amount as text, "12500.50". */
  amount: string;
  paidOn: Date;
  reference: string | null;
  months: number;
  notes: string | null;
  validUntilAfter: Date;
  recordedBy: string;
  createdAt: Date;
  /** For payments: whether it was reversed. */
  reversed: boolean;
};

/**
 * Payments of a company for the console, newest first. The caller is
 * platform staff (the console page checks it).
 */
export async function listManualPayments(
  organizationId: string,
): Promise<ManualPaymentRow[]> {
  // shortcut: newest 100 without pages (about 12 a year per company); paginate if a company ever passes it.
  const rows = await forOrganization(
    String(organizationId),
  ).manualPayment.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 100,
    select: {
      id: true,
      kind: true,
      amount: true,
      paidOn: true,
      reference: true,
      months: true,
      notes: true,
      validUntilAfter: true,
      recordedByUserId: true,
      createdAt: true,
      reversal: { select: { id: true } },
    },
  });
  const people = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.recordedByUserId))] } },
    select: { id: true, name: true },
  });
  const names = new Map(people.map((p) => [p.id, p.name]));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    amount: row.amount.toFixed(2),
    paidOn: row.paidOn,
    reference: row.reference,
    months: row.months,
    notes: row.notes,
    validUntilAfter: row.validUntilAfter,
    recordedBy: names.get(row.recordedByUserId) ?? "—",
    createdAt: row.createdAt,
    reversed: row.reversal !== null,
  }));
}
