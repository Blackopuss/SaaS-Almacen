import "server-only";

import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { companyToday, dayOfDate } from "./calendar";
import type { SalesActor } from "./prices";
import { quoteTransitionProblem, type StoredQuoteStatus } from "./quote-states";

/**
 * What the customer answered to a quote (COT-04): it was handed over,
 * accepted or rejected. Each change locks the quote, follows the one table
 * of `quote-states.ts` (the database repeats it) and goes to the trail.
 * Asking for the state it already has answers «repeated».
 */

export type QuoteStatusResult =
  | { ok: true; repeated?: true }
  | {
      ok: false;
      reason: "not_found" | "invalid_state" | "invalid";
      error: string;
    };

type Failure = Extract<QuoteStatusResult, { ok: false }>;

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("quote status rejected");
  }
}

const NO_CONTROL = /^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/;

const ACTIONS = {
  SENT: "sales.quote_sent",
  ACCEPTED: "sales.quote_accepted",
  REJECTED: "sales.quote_rejected",
} as const;

async function move(
  actor: SalesActor,
  quoteId: string,
  to: "SENT" | "ACCEPTED" | "REJECTED",
  rejectReason: string | null,
): Promise<QuoteStatusResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.quote.create");
  const today = await companyToday(organizationId);
  try {
    return await forOrganization(organizationId).$transaction(async (tx) => {
      const [id] = await lockRows(tx, "salesQuote", [
        String(quoteId).slice(0, 36),
      ]);
      const quote = id
        ? await tx.salesQuote.findFirst({
            where: { id },
            select: { id: true, number: true, status: true, validUntil: true },
          })
        : null;
      if (!quote) {
        throw new Rejected({
          ok: false,
          reason: "not_found",
          error: "Esa cotización no existe.",
        });
      }
      if (quote.status === to)
        return { ok: true as const, repeated: true as const };
      const expired = dayOfDate(quote.validUntil) < today;
      const problem = quoteTransitionProblem(
        quote.status as StoredQuoteStatus,
        to,
        expired,
      );
      if (problem) {
        throw new Rejected({
          ok: false,
          reason: "invalid_state",
          error: problem,
        });
      }
      const now = new Date();
      await tx.salesQuote.update({
        where: { id: quote.id },
        data:
          to === "SENT"
            ? { status: "SENT", sentAt: now }
            : {
                status: to,
                decidedAt: now,
                decidedByUserId: userId,
                rejectReason,
              },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: ACTIONS[to],
        target: { type: "sales_quote", id: quote.id },
        reason: rejectReason ?? undefined,
        metadata: { cotizacion: String(quote.number) },
      });
      return { ok: true as const };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

/** The quote was handed over without mail (in person, by WhatsApp). */
export function markQuoteSent(actor: SalesActor, quoteId: string) {
  return move(actor, quoteId, "SENT", null);
}

/** The customer accepted it, while it holds. */
export function acceptQuote(actor: SalesActor, quoteId: string) {
  return move(actor, quoteId, "ACCEPTED", null);
}

/** The customer said no, with why. */
export async function rejectQuote(
  actor: SalesActor,
  quoteId: string,
  reason: string,
): Promise<QuoteStatusResult> {
  const text = String(reason ?? "").trim();
  if (text.length < 3 || text.length > 500 || !NO_CONTROL.test(text)) {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "sales.quote.create",
    );
    return {
      ok: false,
      reason: "invalid",
      error: "Escribe por qué la rechazó (de 3 a 500 caracteres).",
    };
  }
  return move(actor, quoteId, "REJECTED", text);
}
