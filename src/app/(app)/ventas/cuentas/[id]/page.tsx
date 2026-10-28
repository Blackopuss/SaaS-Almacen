import { ChevronLeft, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Badge } from "@/components/ui/badge";
import { newId } from "@/lib";
import {
  getMyCashSession,
  getAccountReminders,
  getReceivable,
  getReceivablePayment,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { PrintButton } from "../../../../ticket/print-button";
import { PaymentForm } from "./payment-form";

export const metadata: Metadata = { title: "Cuenta por cobrar" };

const quietLink =
  "inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

const BADGE = {
  PAID: "success",
  PARTIAL: "secondary",
  DUE: "outline",
  OVERDUE: "destructive",
  CREDITED: "outline",
} as const;

/**
 * An account of a sale on installments (PAG-05): what is owed, its
 * calendar with what each payment covered, its payments, and taking a new
 * one at the register, with its receipt.
 */
export default async function CuentaPage({
  params,
  searchParams,
}: PageProps<"/ventas/cuentas/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas/cuentas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 print:hidden"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Cuentas por cobrar
    </Link>
  );
  if (!access.can("sales.receivable.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const { id } = await params;
  const account = await getReceivable(actor, id);
  if (!account) notFound();
  const { abono } = await searchParams;
  const [receipt, reminders] = await Promise.all([
    typeof abono === "string" ? getReceivablePayment(actor, abono) : null,
    getAccountReminders(actor, account.id),
  ]);
  const mayCharge =
    account.status === "OPEN" &&
    moduleState === "active" &&
    access.allows("sales.sale.create");
  const cash =
    mayCharge && access.allows("sales.cash.operate")
      ? await getMyCashSession(actor)
      : null;
  const next = account.installments.find((i) => i.left !== "$0.00");
  const plain = (money: string) => money.replace(/[$,]/g, "");

  return (
    <PageContainer>
      {back}
      <div className="space-y-2 print:hidden">
        <PageHeader
          title={`Cuenta ${account.number}`}
          description={account.customer.name}
        />
        <p className="-mt-2 flex flex-wrap gap-x-6">
          <Link href={`/ventas/${account.sale.id}`} className={quietLink}>
            Venta {account.sale.number}
          </Link>
          <Link
            href={`/ventas/cuentas/cliente/${account.customer.id}`}
            className={quietLink}
          >
            Estado de cuenta
          </Link>
        </p>
      </div>
      {receipt && receipt.account.id === account.id && (
        <section
          aria-labelledby="recibo"
          className="max-w-sm space-y-3 rounded-xl border bg-card p-4 text-sm sm:p-5 print:max-w-[80mm] print:border-0 print:p-0"
        >
          <p role="status" className="flex items-start gap-2 print:hidden">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-success"
            />
            <span>
              <span className="font-medium">Abono registrado.</span>
              {receipt.change && ` Entrega ${receipt.change} de cambio.`}
            </span>
          </p>
          <h2 id="recibo" className="font-medium">
            {receipt.companyName} · Recibo {receipt.number}
          </h2>
          <dl className="space-y-1 tabular-nums">
            <div className="flex justify-between gap-3">
              <dt>Cliente</dt>
              <dd className="text-right">{receipt.customer}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Cuenta</dt>
              <dd>{receipt.account.number}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>Fecha</dt>
              <dd>{receipt.createdAtText}</dd>
            </div>
            <div className="flex justify-between gap-3 font-medium">
              <dt>Abono</dt>
              <dd>{receipt.amount}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt>{receipt.methodLabel}</dt>
              <dd>{receipt.received ?? receipt.reference ?? receipt.amount}</dd>
            </div>
            {receipt.change && (
              <div className="flex justify-between gap-3">
                <dt>Cambio</dt>
                <dd>{receipt.change}</dd>
              </div>
            )}
            <div className="flex justify-between gap-3 border-t pt-1 font-medium">
              <dt>Saldo después del abono</dt>
              <dd>{receipt.balanceAfter}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            Le atendió {receipt.by ?? "alguien que ya no está"}. Este recibo no
            es un comprobante fiscal.
          </p>
          <div className="print:hidden">
            <PrintButton label="Imprimir recibo" />
          </div>
        </section>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start print:hidden">
        <div className="min-w-0 space-y-6">
          <section
            aria-label="Saldo"
            className="space-y-1 rounded-xl border bg-card p-4 sm:p-5"
          >
            <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge
                variant={account.status === "OPEN" ? "secondary" : "success"}
              >
                {account.statusLabel}
              </Badge>
              {account.months} mensualidades, {account.interestText}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              Debe {account.balance}
            </p>
            {account.overdue !== "$0.00" && (
              <p className="text-sm font-medium text-destructive">
                Vencido: {account.overdue}
              </p>
            )}
            <p className="text-sm text-muted-foreground tabular-nums">
              Enganche {account.downPayment} · Financiado {account.financed} ·
              Interés {account.interest} · Pagado {account.paid}
              {account.credited !== "$0.00" &&
                ` · Descontado por devoluciones ${account.credited}`}
            </p>
          </section>
          <section
            aria-labelledby="mensualidades"
            className="rounded-xl border bg-card"
          >
            <h2 id="mensualidades" className="border-b p-4 font-medium sm:px-5">
              Mensualidades
            </h2>
            <ol className="divide-y">
              {account.installments.map((installment) => (
                <li
                  key={installment.number}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 text-sm sm:px-5"
                >
                  <span>
                    {installment.number}. Vence el {installment.dueText}
                  </span>
                  <span className="flex items-center gap-3 tabular-nums">
                    <Badge variant={BADGE[installment.status]}>
                      {installment.statusLabel}
                    </Badge>
                    <span className="font-medium">{installment.amount}</span>
                    {installment.status !== "PAID" &&
                      installment.left !== installment.amount && (
                        <span className="text-muted-foreground">
                          falta {installment.left}
                        </span>
                      )}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          {account.payments.length > 0 && (
            <section
              aria-labelledby="abonos"
              className="rounded-xl border bg-card"
            >
              <h2 id="abonos" className="border-b p-4 font-medium sm:px-5">
                Abonos
              </h2>
              <ul className="divide-y">
                {account.payments.map((payment) => (
                  <li
                    key={payment.id}
                    className="relative flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 text-sm hover:bg-muted/40 sm:px-5"
                  >
                    <Link
                      href={`/ventas/cuentas/${account.id}?abono=${payment.id}`}
                      className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Recibo {payment.number}
                    </Link>
                    <span className="text-muted-foreground">
                      {payment.createdAtText}
                      {payment.by && ` · ${payment.by}`}
                    </span>
                    <span className="font-medium tabular-nums">
                      {payment.amount}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {reminders.length > 0 && (
            <section
              aria-labelledby="recordatorios"
              className="rounded-xl border bg-card print:hidden"
            >
              <h2
                id="recordatorios"
                className="border-b p-4 font-medium sm:px-5"
              >
                Recordatorios por correo
              </h2>
              <ul className="divide-y">
                {reminders.map((reminder) => (
                  <li
                    key={reminder.id}
                    className="space-y-1 p-4 text-sm sm:px-5"
                  >
                    <p className="flex flex-wrap justify-between gap-x-4">
                      <span>
                        Mensualidad {reminder.installmentNumber} ·{" "}
                        {reminder.requestedAtText}
                      </span>
                      <span
                        className={
                          reminder.status === "FAILED"
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }
                      >
                        {reminder.statusLabel}
                      </span>
                    </p>
                    {reminder.failureReason && (
                      <p className="text-muted-foreground">
                        {reminder.failureReason}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {mayCharge &&
          (cash ? (
            <PaymentForm
              receivableId={account.id}
              suggested={next ? plain(next.left) : ""}
              balance={plain(account.balance)}
              idempotencyKey={newId()}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Para cobrar un abono abre tu caja en{" "}
              <Link href="/ventas/caja" className={quietLink}>
                Caja
              </Link>
              .
            </p>
          ))}
      </div>
    </PageContainer>
  );
}
