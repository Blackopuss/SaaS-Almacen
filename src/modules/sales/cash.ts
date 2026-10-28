import "server-only";

import { dec, newId, type Decimal } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { listTeamMembers } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import type { SalesActor } from "./prices";
import { formatMoney, parsePrice } from "./pricing";

/**
 * The cash register (VEN-16..18, ADR 0030). Each person who charges opens
 * their register with a float; sales and payments land in it; money put in
 * or taken out goes with its reason; a cash manager closes it counting
 * cash, card vouchers and transfers against what there should be.
 */

type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

export type CashTotals = {
  float: Decimal;
  cashSales: Decimal;
  cashIn: Decimal;
  cashOut: Decimal;
  /** Cash handed back for returns from this register (VEN-19). */
  cashRefunds: Decimal;
  /** Cash received as payments to accounts (PAG-05). */
  cashOnAccounts: Decimal;
  /** Card and transfer, from sales and payments to accounts. */
  card: Decimal;
  transfer: Decimal;
  /** float + cash sales + cash on accounts + in − out − cash refunds. */
  expectedCash: Decimal;
};

/** What a register should hold, from its sales, payments and movements. */
export async function cashTotals(
  client: Client,
  sessionId: string,
): Promise<CashTotals> {
  const [session, payments, movements, refunds, accounts] = await Promise.all([
    client.cashSession.findFirst({
      where: { id: sessionId },
      select: { openingFloat: true },
    }),
    client.salePayment.groupBy({
      by: ["method"],
      where: { sale: { cashSessionId: sessionId } },
      _sum: { amount: true },
    }),
    client.cashMovement.groupBy({
      by: ["direction"],
      where: { sessionId },
      _sum: { amount: true },
    }),
    client.saleReturn.aggregate({
      where: { cashSessionId: sessionId, refundMethod: "CASH" },
      _sum: { refund: true },
    }),
    client.salesReceivablePayment.groupBy({
      by: ["method"],
      where: { cashSessionId: sessionId },
      _sum: { amount: true },
    }),
  ]);
  const paid = (method: string) =>
    dec(
      payments.find((p) => p.method === method)?._sum.amount?.toString() ?? 0,
    );
  const onAccounts = (method: string) =>
    dec(
      accounts.find((p) => p.method === method)?._sum.amount?.toString() ?? 0,
    );
  const moved = (direction: string) =>
    dec(
      movements
        .find((m) => m.direction === direction)
        ?._sum.amount?.toString() ?? 0,
    );
  const float = dec(session?.openingFloat.toString() ?? 0);
  const cashSales = paid("CASH");
  const cashIn = moved("IN");
  const cashOut = moved("OUT");
  const cashRefunds = dec(refunds._sum.refund?.toString() ?? 0);
  const cashOnAccounts = onAccounts("CASH");
  return {
    float,
    cashSales,
    cashIn,
    cashOut,
    cashRefunds,
    cashOnAccounts,
    card: paid("CARD").plus(onAccounts("CARD")),
    transfer: paid("TRANSFER").plus(onAccounts("TRANSFER")),
    expectedCash: float
      .plus(cashSales)
      .plus(cashOnAccounts)
      .plus(cashIn)
      .minus(cashOut)
      .minus(cashRefunds),
  };
}

export type CashSessionView = {
  id: string;
  /** Who opened it. */
  cashier: string;
  openedByUserId: string;
  /** «27 oct 2026, 9:00 a.m.» is formatted by the screen. */
  openedAt: Date;
  open: boolean;
  totals: {
    float: string;
    cashSales: string;
    cashIn: string;
    cashOut: string;
    cashRefunds: string;
    cashOnAccounts: string;
    card: string;
    transfer: string;
    expectedCash: string;
  };
  movements: {
    direction: "IN" | "OUT";
    amount: string;
    reason: string;
    createdAt: Date;
  }[];
  /** At the close: counted − expected, per method. */
  close: {
    closedAt: Date;
    closedBy: string;
    countedCash: string;
    countedCard: string;
    countedTransfer: string;
    differenceCash: string;
    differenceCard: string;
    differenceTransfer: string;
    note: string | null;
  } | null;
};

const money = (value: Decimal) => formatMoney(value);
const signed = (value: Decimal) =>
  value.isZero()
    ? "$0.00"
    : value.isNegative()
      ? `-${formatMoney(value.negated())}`
      : `+${formatMoney(value)}`;

async function viewOf(
  organizationId: string,
  sessionId: string,
): Promise<CashSessionView | null> {
  const client = forOrganization(organizationId);
  const session = await client.cashSession.findFirst({
    where: { id: sessionId },
    include: { movements: { orderBy: { id: "asc" } } },
  });
  if (!session) return null;
  const [totals, members] = await Promise.all([
    cashTotals(client, session.id),
    listTeamMembers(organizationId),
  ]);
  const nameOf = (userId: string | null) =>
    members.find((m) => m.userId === userId)?.name ?? "";
  return {
    id: session.id,
    cashier: nameOf(session.openedByUserId),
    openedByUserId: session.openedByUserId,
    openedAt: session.openedAt,
    open: session.isOpen === true,
    totals: {
      float: money(totals.float),
      cashSales: money(totals.cashSales),
      cashIn: money(totals.cashIn),
      cashOut: money(totals.cashOut),
      cashRefunds: money(totals.cashRefunds),
      cashOnAccounts: money(totals.cashOnAccounts),
      card: money(totals.card),
      transfer: money(totals.transfer),
      expectedCash: money(totals.expectedCash),
    },
    movements: session.movements.map((movement) => ({
      direction: movement.direction,
      amount: formatMoney(movement.amount.toString()),
      reason: movement.reason,
      createdAt: movement.createdAt,
    })),
    close:
      session.closedAt && session.countedCash && session.expectedCash
        ? {
            closedAt: session.closedAt,
            closedBy: nameOf(session.closedByUserId),
            countedCash: formatMoney(session.countedCash.toString()),
            countedCard: formatMoney(session.countedCard!.toString()),
            countedTransfer: formatMoney(session.countedTransfer!.toString()),
            differenceCash: signed(
              dec(session.countedCash.toString()).minus(
                session.expectedCash.toString(),
              ),
            ),
            differenceCard: signed(
              dec(session.countedCard!.toString()).minus(
                session.expectedCard!.toString(),
              ),
            ),
            differenceTransfer: signed(
              dec(session.countedTransfer!.toString()).minus(
                session.expectedTransfer!.toString(),
              ),
            ),
            note: session.closeNote,
          }
        : null,
  };
}

/** The register this person has open, or null. */
export async function getMyCashSession(
  actor: SalesActor,
): Promise<CashSessionView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.operate",
  );
  const open = await forOrganization(
    actor.organizationId,
  ).cashSession.findFirst({
    where: { openedByUserId: actor.userId, isOpen: true },
    select: { id: true },
  });
  return open ? viewOf(actor.organizationId, open.id) : null;
}

/** A register, for a cash manager or for whoever opened it. */
export async function getCashSession(
  actor: SalesActor,
  sessionId: string,
): Promise<CashSessionView | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.operate",
  );
  const view = await viewOf(
    actor.organizationId,
    String(sessionId).slice(0, 36),
  );
  if (!view) return null;
  if (view.openedByUserId === actor.userId) return view;
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.close",
  );
  return view;
}

/** Registers open in the company, for the cash manager's close. */
export async function listCashSessions(
  actor: SalesActor,
): Promise<CashSessionView[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.close",
  );
  const client = forOrganization(actor.organizationId);
  const rows = await client.cashSession.findMany({
    where: { isOpen: true },
    orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    take: 50,
    select: { id: true },
  });
  const views = await Promise.all(
    rows.map((row) => viewOf(actor.organizationId, row.id)),
  );
  return views.flatMap((view) => (view ? [view] : []));
}

export type CashResult =
  | { ok: true; sessionId: string }
  | {
      ok: false;
      fieldErrors: Partial<Record<string, string>>;
      formError?: string;
    };

const AMOUNT_ERROR = "Escribe el importe como 500 o 1,250.50.";

/** Opens this person's register with its float (VEN-16). */
export async function openCashSession(
  actor: SalesActor,
  input: { openingFloat: string },
): Promise<CashResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.operate",
  );
  const typed = String(input.openingFloat ?? "")
    .trim()
    .slice(0, 20);
  const float = typed === "" ? "0.00" : parsePrice(typed);
  if (float === null) {
    return { ok: false, fieldErrors: { openingFloat: AMOUNT_ERROR } };
  }
  const id = newId();
  try {
    await forOrganization(actor.organizationId).$transaction(async (tx) => {
      await tx.cashSession.create({
        data: {
          id,
          organizationId: actor.organizationId,
          openedByUserId: actor.userId,
          openingFloat: float,
        },
      });
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "sales.cash_opened",
        target: { type: "cash_session", id },
        metadata: { fondo: formatMoney(float) },
      });
    });
  } catch (error) {
    // One open register per person: the unique index says it.
    if ((error as { code?: string }).code === "P2002") {
      return {
        ok: false,
        fieldErrors: {},
        formError: "Ya tienes una caja abierta.",
      };
    }
    throw error;
  }
  return { ok: true, sessionId: id };
}

/** Money put into or taken out of this person's open register (VEN-17). */
export async function recordCashMovement(
  actor: SalesActor,
  input: { direction: string; amount: string; reason: string },
): Promise<CashResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.operate",
  );
  const fieldErrors: Partial<Record<string, string>> = {};
  const direction = String(input.direction ?? "");
  if (direction !== "IN" && direction !== "OUT") {
    fieldErrors.direction = "Elige si entra o sale dinero.";
  }
  const amount = parsePrice(
    String(input.amount ?? "")
      .trim()
      .slice(0, 20),
  );
  if (amount === null || dec(amount).isZero()) {
    fieldErrors.amount = AMOUNT_ERROR;
  }
  const reason = String(input.reason ?? "").trim();
  if (
    reason.length < 3 ||
    reason.length > 200 ||
    /[\u0000-\u001f]/.test(reason)
  ) {
    fieldErrors.reason = "Escribe el motivo (de 3 a 200 caracteres).";
  }
  if (Object.keys(fieldErrors).length > 0 || amount === null) {
    return { ok: false, fieldErrors };
  }
  return forOrganization(actor.organizationId).$transaction(async (tx) => {
    const open = await tx.cashSession.findFirst({
      where: { openedByUserId: actor.userId, isOpen: true },
      select: { id: true },
    });
    const [locked] = open ? await lockRows(tx, "cashSession", [open.id]) : [];
    const still = locked
      ? await tx.cashSession.findFirst({
          where: { id: locked, isOpen: true },
          select: { id: true },
        })
      : null;
    if (!still) {
      return {
        ok: false as const,
        fieldErrors: {},
        formError: "Tu caja ya no está abierta.",
      };
    }
    if (direction === "OUT") {
      const totals = await cashTotals(tx, still.id);
      if (totals.expectedCash.lessThan(amount)) {
        return {
          ok: false as const,
          fieldErrors: {
            amount: `En la caja debería haber ${formatMoney(totals.expectedCash)}: no pueden salir ${formatMoney(amount)}.`,
          },
        };
      }
    }
    await tx.cashMovement.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        sessionId: still.id,
        direction: direction as "IN" | "OUT",
        amount,
        reason,
        createdByUserId: actor.userId,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: direction === "IN" ? "sales.cash_in" : "sales.cash_out",
      target: { type: "cash_session", id: still.id },
      reason,
      metadata: { importe: formatMoney(amount) },
    });
    return { ok: true as const, sessionId: still.id };
  }, LOCKING_TRANSACTION);
}

/**
 * The close (VEN-18): a cash manager counts what there is, by method; what
 * there should be is computed under the register's lock, so no sale lands
 * in it after.
 */
export async function closeCashSession(
  actor: SalesActor,
  sessionId: string,
  input: {
    countedCash: string;
    countedCard: string;
    countedTransfer: string;
    note?: string;
  },
): Promise<CashResult> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.cash.close",
  );
  const fieldErrors: Partial<Record<string, string>> = {};
  const read = (field: string, text: string) => {
    const typed = String(text ?? "")
      .trim()
      .slice(0, 20);
    const value = typed === "" ? "0.00" : parsePrice(typed);
    if (value === null) fieldErrors[field] = AMOUNT_ERROR;
    return value ?? "0.00";
  };
  const counted = {
    cash: read("countedCash", input.countedCash),
    card: read("countedCard", input.countedCard),
    transfer: read("countedTransfer", input.countedTransfer),
  };
  const note =
    String(input.note ?? "")
      .trim()
      .slice(0, 500) || null;
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  return forOrganization(actor.organizationId).$transaction(async (tx) => {
    const [locked] = await lockRows(tx, "cashSession", [
      String(sessionId).slice(0, 36),
    ]);
    const session = locked
      ? await tx.cashSession.findFirst({
          where: { id: locked },
          select: { id: true, isOpen: true },
        })
      : null;
    if (!session) {
      return {
        ok: false as const,
        fieldErrors: {},
        formError: "Esa caja no existe.",
      };
    }
    if (session.isOpen !== true) {
      return {
        ok: false as const,
        fieldErrors: {},
        formError: "Esta caja ya se cerró.",
      };
    }
    const totals = await cashTotals(tx, session.id);
    await tx.cashSession.updateMany({
      where: { id: session.id, isOpen: true },
      data: {
        isOpen: null,
        closedAt: new Date(),
        closedByUserId: actor.userId,
        expectedCash: totals.expectedCash.toFixed(2),
        expectedCard: totals.card.toFixed(2),
        expectedTransfer: totals.transfer.toFixed(2),
        countedCash: counted.cash,
        countedCard: counted.card,
        countedTransfer: counted.transfer,
        closeNote: note,
      },
    });
    await recordAuditEvent(tx, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId,
      action: "sales.cash_closed",
      target: { type: "cash_session", id: session.id },
      reason: note ?? undefined,
      metadata: {
        efectivo: `${formatMoney(counted.cash)} (esperado ${money(totals.expectedCash)})`,
        tarjeta: `${formatMoney(counted.card)} (esperado ${money(totals.card)})`,
        transferencia: `${formatMoney(counted.transfer)} (esperado ${money(totals.transfer)})`,
      },
    });
    return { ok: true as const, sessionId: session.id };
  }, LOCKING_TRANSACTION);
}
