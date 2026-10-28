import "server-only";

import { formatDateTime, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertOwnerAction } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import {
  InvalidEmailError,
  overdueReminderEmail,
  sendEmail,
} from "@/platform/email";
import { getFreshEntitlements } from "@/platform/entitlements";
import { enqueueJob, type JobHandler } from "@/platform/jobs";
import { LOCKING_TRANSACTION, forOrganization, type TenantDb } from "@/server";

import { dayOf, salesNow, timeZoneOf } from "./calendar";
import { usableEmail } from "./email-address";
import type { SalesActor } from "./prices";
import { formatMoney } from "./pricing";
import { findOverdue, formatDueDay, overdueOf } from "./receivables";

/**
 * Reminders of overdue payments (PAG-07, ADR 0030): when the titular turns
 * them on, the worker mails a customer once for each installment that
 * falls due unpaid — what is overdue and since when — to the address of
 * their card. Never at night, at most so many a day per company, and not
 * when it was paid by the time the worker gets to it.
 */

export const REMINDER_JOB_TYPE = "sales.send_reminder";
const MAX_ATTEMPTS = 4;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000];
export const REMINDERS_PER_DAY = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Reminders go out from 9:00 to 19:59, the company's time. */
const FIRST_HOUR = 9;
const LAST_HOUR = 19;

const FAILED_AFTER_RETRIES =
  "No se pudo entregar el correo después de varios intentos. Revisa el correo del cliente.";

/** The company client or a transaction of it. */
type Client = TenantDb | Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

/** Whether the company mails reminders (off until the titular turns them on). */
export async function readOverdueReminders(client: Client): Promise<boolean> {
  const row = await client.salesSettings.findFirst({
    select: { overdueReminders: true },
  });
  return row?.overdueReminders ?? false;
}

/** Whether the reminders are on, for the titular's settings screen. */
export async function getOverdueReminders(actor: SalesActor): Promise<boolean> {
  await assertOwnerAction(
    actor.organizationId,
    actor.userId,
    "sales.settings.update",
  );
  return readOverdueReminders(forOrganization(actor.organizationId));
}

/** Turns the reminders on or off. Only the titular. */
export async function setOverdueReminders(
  actor: SalesActor,
  on: boolean,
): Promise<{ ok: true; changed: boolean }> {
  await assertOwnerAction(
    actor.organizationId,
    actor.userId,
    "sales.settings.update",
  );
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.settings.update",
  );
  const wanted = on === true;
  const save = () =>
    forOrganization(actor.organizationId).$transaction(async (tx) => {
      const current = await tx.salesSettings.findFirst({
        select: { id: true, overdueReminders: true },
      });
      if ((current?.overdueReminders ?? false) === wanted) {
        return { ok: true as const, changed: false };
      }
      if (current) {
        await tx.salesSettings.updateMany({
          where: { id: current.id },
          data: { overdueReminders: wanted, updatedByUserId: actor.userId },
        });
      } else {
        // Two saves at once: the second fails on the unique company and
        // is retried below, then it finds the row.
        await tx.salesSettings.create({
          data: {
            id: newId(),
            organizationId: actor.organizationId,
            overdueReminders: wanted,
            updatedByUserId: actor.userId,
          },
        });
      }
      await recordAuditEvent(tx, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: "sales.reminders_changed",
        target: { type: "organization", id: actor.organizationId },
        metadata: { recordatorios: wanted ? "encendidos" : "apagados" },
      });
      return { ok: true as const, changed: true };
    }, LOCKING_TRANSACTION);
  try {
    return await save();
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") return save();
    throw error;
  }
}

const hourIn = (moment: Date, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      hourCycle: "h23",
      timeZone,
    }).format(moment),
  );

async function remindersMayGo(organizationId: string): Promise<boolean> {
  const entitlements = await getFreshEntitlements(organizationId);
  if (entitlements.moduleState("sales") !== "active") return false;
  return readOverdueReminders(forOrganization(organizationId));
}

/**
 * One round of the worker for a company: asks a reminder for each account
 * whose latest installment due is unpaid and was not reminded yet. Does
 * nothing when the reminders are off, the module is not in force, or it
 * is not daytime for the company.
 */
export async function scheduleOverdueReminders(
  organizationId: string,
): Promise<{ queued: number }> {
  const now = salesNow();
  if (!(await remindersMayGo(organizationId))) return { queued: 0 };
  const client = forOrganization(organizationId);
  const timeZone = await timeZoneOf(organizationId);
  const hour = hourIn(now, timeZone);
  if (hour < FIRST_HOUR || hour > LAST_HOUR) return { queued: 0 };
  const overdue = await findOverdue(client, dayOf(now, timeZone));
  if (overdue.length === 0) return { queued: 0 };
  const reminded = await client.salesReceivableReminder.findMany({
    where: { receivableId: { in: overdue.map((row) => row.receivableId) } },
    select: { receivableId: true, installmentNumber: true },
  });
  const done = new Set(
    reminded.map((row) => `${row.receivableId}:${row.installmentNumber}`),
  );
  const pending = overdue.filter(
    (row) => !done.has(`${row.receivableId}:${row.latestDue}`),
  );
  if (pending.length === 0) return { queued: 0 };
  const sentToday = await client.salesReceivableReminder.count({
    where: { requestedAt: { gte: new Date(now.getTime() - DAY_MS) } },
  });
  const room = Math.max(0, REMINDERS_PER_DAY - sentToday);
  const accounts = await client.salesReceivable.findMany({
    where: { id: { in: pending.map((row) => row.receivableId) } },
    select: { id: true, customer: { select: { email: true } } },
  });
  const emailOf = new Map(
    accounts.map((account) => [
      account.id,
      usableEmail(account.customer.email),
    ]),
  );
  let queued = 0;
  for (const row of pending) {
    if (queued >= room) break;
    const recipient = emailOf.get(row.receivableId);
    // No address: nothing to send; it is looked at again next round.
    if (!recipient) continue;
    try {
      await client.$transaction(async (tx) => {
        const reminderId = newId();
        const { jobId } = await enqueueJob(tx, organizationId, {
          type: REMINDER_JOB_TYPE,
          payload: { reminderId },
          maxAttempts: MAX_ATTEMPTS,
        });
        // Unique by account and installment: a second round at the same
        // time fails here and takes its job back with it.
        await tx.salesReceivableReminder.create({
          data: {
            id: reminderId,
            organizationId,
            receivableId: row.receivableId,
            installmentNumber: row.latestDue,
            recipient,
            jobId,
          },
        });
      });
      queued += 1;
    } catch (error) {
      // Another round asked it at the same time: it is already on its way.
      if ((error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }
  return { queued };
}

export type AccountReminder = {
  id: string;
  installmentNumber: number;
  recipient: string;
  status: "QUEUED" | "SENT" | "FAILED";
  statusLabel: string;
  requestedAt: Date;
  /** «28 oct 2026, 10:05», the company's time. */
  requestedAtText: string;
  failureReason: string | null;
};

const REMINDER_STATUS_LABELS = {
  QUEUED: "Enviando",
  SENT: "Enviado",
  FAILED: "No se envió",
} as const;

/** The latest reminders of an account. */
export async function getAccountReminders(
  actor: SalesActor,
  receivableId: string,
): Promise<AccountReminder[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "sales.receivable.read",
  );
  const timeZone = await timeZoneOf(actor.organizationId);
  const rows = await forOrganization(
    actor.organizationId,
  ).salesReceivableReminder.findMany({
    where: { receivableId: String(receivableId).slice(0, 36) },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
    take: 5,
    select: {
      id: true,
      installmentNumber: true,
      recipient: true,
      status: true,
      requestedAt: true,
      failureReason: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    statusLabel: REMINDER_STATUS_LABELS[row.status],
    requestedAtText: formatDateTime(row.requestedAt, timeZone),
  }));
}

type Tenant = ReturnType<typeof forOrganization>;

async function failReminder(
  client: Tenant,
  organizationId: string,
  reminderId: string,
  reason: string,
): Promise<void> {
  await client.$transaction(async (tx) => {
    const closed = await tx.salesReceivableReminder.updateMany({
      where: { id: reminderId, status: "QUEUED" },
      data: { status: "FAILED", failedAt: new Date(), failureReason: reason },
    });
    if (closed.count === 0) return;
    const reminder = await tx.salesReceivableReminder.findFirst({
      where: { id: reminderId },
      select: { receivableId: true, recipient: true },
    });
    if (reminder) {
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: null,
        action: "sales.reminder_failed",
        target: { type: "sales_receivable", id: reminder.receivableId },
        metadata: { correo: reminder.recipient, motivo: reason },
      });
    }
  });
}

/**
 * Sends a reminder (the worker). It may run more than once for the same
 * reminder: one that already ended is left as it ended.
 */
export async function deliverReminder(
  organizationId: string,
  reminderId: string,
): Promise<{ sent: boolean; reason?: string }> {
  const client = forOrganization(organizationId);
  const reminder = await client.salesReceivableReminder.findFirst({
    where: { id: String(reminderId).slice(0, 36) },
    select: { id: true, receivableId: true, recipient: true, status: true },
  });
  if (!reminder) return { sent: false, reason: "El aviso ya no existe." };
  if (reminder.status !== "QUEUED") {
    return { sent: false, reason: "El aviso ya había terminado." };
  }
  const stop = async (reason: string) => {
    await failReminder(client, organizationId, reminder.id, reason);
    return { sent: false, reason };
  };
  if (!(await remindersMayGo(organizationId))) {
    return stop("Los recordatorios se apagaron antes de enviarlo.");
  }
  const account = await client.salesReceivable.findFirst({
    where: { id: reminder.receivableId },
    select: {
      number: true,
      status: true,
      customer: { select: { name: true } },
      organization: {
        select: {
          name: true,
          timeZone: true,
          owner: { select: { name: true, email: true } },
        },
      },
    },
  });
  if (!account) return stop("La cuenta ya no existe.");
  const timeZone = account.organization.timeZone || "America/Mexico_City";
  const state = await overdueOf(
    client,
    reminder.receivableId,
    dayOf(salesNow(), timeZone),
  );
  if (!state) {
    return stop("Ya no tenía pagos vencidos cuando tocaba enviarlo.");
  }
  try {
    await sendEmail(
      overdueReminderEmail({
        to: reminder.recipient,
        greeting: account.customer.name,
        organizationName: account.organization.name,
        overdue: formatMoney(state.overdue),
        sinceText: formatDueDay(state.since),
        balance: formatMoney(state.balance),
        replyTo: account.organization.owner,
      }),
    );
  } catch (error) {
    if (error instanceof InvalidEmailError) {
      return stop(
        "El correo no se pudo armar con los datos del cliente. Revisa su correo.",
      );
    }
    throw error;
  }
  await client.$transaction(async (tx) => {
    const closed = await tx.salesReceivableReminder.updateMany({
      where: { id: reminder.id, status: "QUEUED" },
      data: { status: "SENT", sentAt: new Date() },
    });
    if (closed.count === 0) return;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: null,
      action: "sales.reminder_sent",
      target: { type: "sales_receivable", id: reminder.receivableId },
      metadata: {
        cuenta: account.number,
        cliente: account.customer.name,
        correo: reminder.recipient,
        vencido: formatMoney(state.overdue),
      },
    });
  });
  return { sent: true };
}

const reminderIdOf = (payload: unknown) =>
  String((payload as { reminderId?: unknown } | null)?.reminderId ?? "");

export const reminderJobHandler: JobHandler = {
  // The company is the one of the job, never one named in the payload.
  handle: (context) =>
    deliverReminder(context.organizationId, reminderIdOf(context.payload)),
  retryDelayMs: (attempt) =>
    RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length) - 1]!,
  onFailed: async (context) => {
    await failReminder(
      forOrganization(context.organizationId),
      context.organizationId,
      reminderIdOf(context.payload),
      FAILED_AFTER_RETRIES,
    );
  },
};
