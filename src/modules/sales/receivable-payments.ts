import "server-only";

import { dec, newId } from "@/lib";
import { assertModulePermission } from "@/platform/billing";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { readPayments, type PaymentInput } from "./payments";
import type { SalesActor } from "./prices";
import { formatMoney, parsePrice } from "./pricing";
import { NO_CASH_SESSION, SALE_KEY_REUSED, lockOwnCashSession } from "./sales";

/**
 * Payments to an account (PAG-05, ADR 0030): taken at the register of who
 * receives it, like a sale, and applied to the oldest installment still
 * due (derived, `applyPayments`). Never more than what is owed; the
 * payment that settles it marks the account paid. A retry with the same
 * key answers with the same payment.
 */

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,64}$/;

export type ReceivablePaymentInput = {
  /** As typed: «1,466.66». */
  amount: string;
  method: string;
  /** Cash: what was handed over; empty = exact. */
  received?: string;
  /** Card or transfer. */
  reference?: string;
  idempotencyKey: string;
};

export type ReceivablePaymentResult =
  | {
      ok: true;
      paymentId: string;
      /** Receipt number. */
      number: number;
      amount: string;
      change: string | null;
      /** What is still owed after it. */
      balance: string;
      settled: boolean;
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed";
      fieldErrors: Partial<
        Record<"amount" | "method" | "received" | "reference", string>
      >;
      formError?: string;
    };

type Failure = Extract<ReceivablePaymentResult, { ok: false }>;

const failure = (patch: Partial<Failure>): Failure => ({
  ok: false,
  reason: "invalid",
  fieldErrors: {},
  ...patch,
});

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("payment rejected");
  }
}

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

/** Takes a payment to an account at the register of who receives it. */
export async function registerReceivablePayment(
  actor: SalesActor,
  receivableId: string,
  input: ReceivablePaymentInput,
): Promise<ReceivablePaymentResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(organizationId, userId, "sales.sale.create");
  const key = text(input?.idempotencyKey, 64).trim();
  if (!IDEMPOTENCY_KEY.test(key)) {
    return failure({
      formError:
        "No pudimos identificar este abono. Recarga la página e inténtalo de nuevo.",
    });
  }
  const amount = parsePrice(text(input?.amount, 20));
  if (amount === null || dec(amount).isZero()) {
    return failure({
      fieldErrors: { amount: "Escribe cuánto abona, por ejemplo 500." },
    });
  }
  const sent: PaymentInput = {
    method: text(input?.method, 16),
    received: text(input?.received, 20),
    reference: text(input?.reference, 60),
  };

  const attempt = () =>
    forOrganization(organizationId).$transaction(async (tx) => {
      // The register, then the account: one payment after the other.
      const cashSession = await lockOwnCashSession(tx, userId);
      const replay = await tx.salesReceivablePayment.findFirst({
        where: { idempotencyKey: key },
        select: {
          id: true,
          number: true,
          receivableId: true,
          receivedByUserId: true,
          amount: true,
          changeGiven: true,
        },
      });
      if (replay) {
        if (
          replay.receivedByUserId !== userId ||
          replay.receivableId !== String(receivableId).slice(0, 36) ||
          !dec(replay.amount.toString()).equals(amount)
        ) {
          throw new Rejected(
            failure({ reason: "not_allowed", formError: SALE_KEY_REUSED }),
          );
        }
        const state = await balanceOf(tx, replay.receivableId);
        return {
          ok: true as const,
          paymentId: replay.id,
          number: replay.number,
          amount: formatMoney(replay.amount.toString()),
          change:
            replay.changeGiven && !replay.changeGiven.isZero()
              ? formatMoney(replay.changeGiven.toString())
              : null,
          balance: formatMoney(state.balance),
          settled: state.balance.isZero(),
          repeated: true as const,
        };
      }
      if (!cashSession) {
        throw new Rejected(
          failure({ reason: "not_allowed", formError: NO_CASH_SESSION }),
        );
      }
      const [id] = await lockRows(tx, "salesReceivable", [
        String(receivableId).slice(0, 36),
      ]);
      const account = id
        ? await tx.salesReceivable.findFirst({
            where: { id },
            select: { id: true, status: true },
          })
        : null;
      if (!account) {
        throw new Rejected(
          failure({ reason: "not_found", formError: "Esa cuenta no existe." }),
        );
      }
      if (account.status !== "OPEN") {
        throw new Rejected(
          failure({
            reason: "not_allowed",
            formError:
              account.status === "PAID"
                ? "Esta cuenta ya está pagada."
                : "Esta cuenta está cancelada.",
          }),
        );
      }
      const { balance } = await balanceOf(tx, account.id);
      if (dec(amount).greaterThan(balance)) {
        throw new Rejected(
          failure({
            fieldErrors: {
              amount: `Solo debe ${formatMoney(balance)}: no se abona más.`,
            },
          }),
        );
      }
      const paid = readPayments([sent], dec(amount));
      if (!paid.ok) {
        const fieldError = paid.paymentErrors[0];
        throw new Rejected(
          failure({
            fieldErrors: fieldError
              ? {
                  [sent.method === "CASH" ? "received" : "reference"]:
                    fieldError,
                }
              : {},
            formError: paid.formError,
          }),
        );
      }
      const payment = paid.payments[0]!;
      const last = await tx.salesReceivablePayment.findFirst({
        orderBy: { number: "desc" },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;
      const paymentId = newId();
      await tx.salesReceivablePayment.create({
        data: {
          id: paymentId,
          organizationId,
          number,
          receivableId: account.id,
          cashSessionId: cashSession.id,
          method: payment.method,
          amount: payment.amount.toFixed(2),
          received: payment.received?.toFixed(2) ?? null,
          changeGiven: payment.change?.toFixed(2) ?? null,
          reference: payment.reference,
          idempotencyKey: key,
          receivedByUserId: userId,
        },
      });
      const after = balance.minus(amount);
      if (after.isZero()) {
        await tx.salesReceivable.update({
          where: { id: account.id },
          data: { status: "PAID" },
        });
      }
      return {
        ok: true as const,
        paymentId,
        number,
        amount: formatMoney(payment.amount),
        change:
          payment.change && !payment.change.isZero()
            ? formatMoney(payment.change)
            : null,
        balance: formatMoney(after),
        settled: after.isZero(),
      };
    }, LOCKING_TRANSACTION);

  for (let round = 1; ; round++) {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof Rejected) return error.result;
      // Two receipts took the same number, or a retry raced the first.
      if ((error as { code?: string }).code === "P2002" && round < 4) continue;
      throw error;
    }
  }
}

/** What is still owed of an account: owed − its payments. */
async function balanceOf(
  tx: Parameters<
    Parameters<ReturnType<typeof forOrganization>["$transaction"]>[0]
  >[0],
  receivableId: string,
) {
  const [account, payments] = await Promise.all([
    tx.salesReceivable.findFirstOrThrow({
      where: { id: receivableId },
      select: { owed: true },
    }),
    tx.salesReceivablePayment.aggregate({
      where: { receivableId },
      _sum: { amount: true },
    }),
  ]);
  return {
    balance: dec(account.owed.toString()).minus(
      payments._sum.amount?.toString() ?? 0,
    ),
  };
}

/** After a lost answer: this person's payment with that key, if any. */
export async function findReceivablePaymentByKey(
  actor: SalesActor,
  key: string,
): Promise<{ paymentId: string; receivableId: string } | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.sale.create",
  );
  const value = text(key, 64);
  if (!IDEMPOTENCY_KEY.test(value)) return null;
  const payment = await forOrganization(
    actor.organizationId,
  ).salesReceivablePayment.findFirst({
    where: { idempotencyKey: value, receivedByUserId: actor.userId },
    select: { id: true, receivableId: true },
  });
  return payment
    ? { paymentId: payment.id, receivableId: payment.receivableId }
    : null;
}
