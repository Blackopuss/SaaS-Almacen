import "server-only";

import { z } from "zod";

import { newId } from "@/lib";
import { db } from "@/server";

import { isPlatformStaff } from "../provisioning";
import { endOfMexicoDay } from "../validity";

/**
 * Discount codes (ADR 0028). Only platform staff create them, from the
 * internal console; a customer can only type one at checkout. A code of
 * 100% makes the purchase free without any provider (how the founder
 * tries a plan on a demo account). Uses are counted when an order is
 * PAID, with a conditional UPDATE that never passes the maximum.
 */

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/** "pepito gratis" → "PEPITOGRATIS"; null when it cannot be a code. */
export function normalizeCode(text: string): string | null {
  const code = text.replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9-]{4,40}$/.test(code) ? code : null;
}

const createSchema = z.object({
  code: z.string().transform((value, context) => {
    const code = normalizeCode(value);
    if (code === null) {
      context.addIssue({
        code: "custom",
        message:
          "El código lleva de 4 a 40 letras, números o guiones, sin espacios.",
      });
      return z.NEVER;
    }
    return code;
  }),
  percentOff: z.coerce
    .number("Escribe el descuento.")
    .int("El descuento es un porcentaje entero.")
    .min(1, "El descuento es al menos 1%.")
    .max(100, "El descuento es como máximo 100% (gratis)."),
  maxRedemptions: z.coerce
    .number("Escribe cuántas veces se puede usar.")
    .int("Las veces deben ser un número entero.")
    .min(1, "Debe poder usarse al menos una vez.")
    .max(10_000, "Son demasiadas veces."),
  /** Last day it works, YYYY-MM-DD in central Mexico; empty = no end. */
  validUntil: z
    .string()
    .trim()
    .transform((value, context) => {
      if (value === "") return null;
      const day = /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? new Date(`${value}T00:00:00.000Z`)
        : null;
      if (
        !day ||
        Number.isNaN(day.getTime()) ||
        day.toISOString().slice(0, 10) !== value
      ) {
        context.addIssue({ code: "custom", message: "Elige un día válido." });
        return z.NEVER;
      }
      const end = endOfMexicoDay(day);
      if (end <= new Date()) {
        context.addIssue({
          code: "custom",
          message: "La caducidad debe ser hoy o después.",
        });
        return z.NEVER;
      }
      return end;
    }),
  note: z
    .string()
    .trim()
    .max(200, "La nota es demasiado larga.")
    .transform((value) => value || null),
});

export type PromoCodeInput = {
  code: string;
  percentOff: number | string;
  maxRedemptions: number | string;
  validUntil: string;
  note: string;
};
export type PromoCodeField = keyof PromoCodeInput;
export type PromoCodeResult =
  | { ok: true; id: string; code: string }
  | {
      ok: false;
      fieldErrors: Partial<Record<PromoCodeField, string>>;
      formError?: string;
    };

const NOT_STAFF = "No tienes permiso para hacer esto.";

export async function createPromoCode(
  staffUserId: string,
  input: PromoCodeInput,
): Promise<PromoCodeResult> {
  if (!(await isPlatformStaff(staffUserId))) {
    return { ok: false, fieldErrors: {}, formError: NOT_STAFF };
  }
  const parsed = createSchema.safeParse({
    code: String(input.code ?? ""),
    percentOff: input.percentOff,
    maxRedemptions: input.maxRedemptions,
    validUntil: String(input.validUntil ?? ""),
    note: String(input.note ?? ""),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<PromoCodeField, string>> = {};
    for (const issue of parsed.error.issues) {
      fieldErrors[issue.path[0] as PromoCodeField] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  const id = newId();
  try {
    await db.promoCode.create({
      data: { id, ...parsed.data, createdByUserId: staffUserId },
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") {
      return {
        ok: false,
        fieldErrors: { code: "Ya existe un código con ese texto." },
      };
    }
    throw error;
  }
  return { ok: true, id, code: parsed.data.code };
}

/** Turns a code off for good (it stays in the history of its orders). */
export async function disablePromoCode(
  staffUserId: string,
  promoCodeId: string,
): Promise<{ ok: true } | { ok: false; formError: string }> {
  if (!(await isPlatformStaff(staffUserId))) {
    return { ok: false, formError: NOT_STAFF };
  }
  const { count } = await db.promoCode.updateMany({
    where: { id: String(promoCodeId), disabledAt: null },
    data: { disabledAt: new Date() },
  });
  return count === 1
    ? { ok: true }
    : { ok: false, formError: "Ese código no existe o ya está desactivado." };
}

export type PromoCodeRow = {
  id: string;
  code: string;
  percentOff: number;
  maxRedemptions: number;
  redemptions: number;
  validUntil: Date | null;
  disabledAt: Date | null;
  note: string | null;
  createdAt: Date;
};

/** Every code, newest first (staff only). */
export async function listPromoCodes(
  staffUserId: string,
): Promise<PromoCodeRow[]> {
  if (!(await isPlatformStaff(staffUserId))) return [];
  return db.promoCode.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      id: true,
      code: true,
      percentOff: true,
      maxRedemptions: true,
      redemptions: true,
      validUntil: true,
      disabledAt: true,
      note: true,
      createdAt: true,
    },
  });
}

/** Why a typed code does not apply, in words for the customer. */
export const CODE_REJECTED = "Ese código no es válido o ya no está vigente.";

/**
 * The code a customer typed, if it can be used now. Every failure gives
 * the same answer, so trying codes tells nothing about which exist.
 */
export async function findUsableCode(
  client: Pick<Tx, "promoCode">,
  text: string,
  now = new Date(),
): Promise<{ id: string; code: string; percentOff: number } | null> {
  const code = normalizeCode(text);
  if (code === null) return null;
  const row = await client.promoCode.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      percentOff: true,
      maxRedemptions: true,
      redemptions: true,
      validUntil: true,
      disabledAt: true,
    },
  });
  if (
    !row ||
    row.disabledAt !== null ||
    (row.validUntil !== null && row.validUntil <= now) ||
    row.redemptions >= row.maxRedemptions
  ) {
    return null;
  }
  return { id: row.id, code: row.code, percentOff: row.percentOff };
}

/**
 * Counts one use when an order is paid. False when the last use was
 * already taken (by a free order: it must then be refused); a provider
 * order that was already charged is honoured anyway.
 */
export async function redeemCode(
  tx: Pick<Tx, "promoCode">,
  promoCodeId: string,
): Promise<boolean> {
  const { count } = await tx.promoCode.updateMany({
    where: {
      id: promoCodeId,
      redemptions: { lt: db.promoCode.fields.maxRedemptions },
    },
    data: { redemptions: { increment: 1 } },
  });
  return count === 1;
}
