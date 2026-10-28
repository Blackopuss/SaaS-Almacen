import { ChevronLeft, Download } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { getCustomerStatement, getStatementDeliveries } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { SendStatementButton } from "./send-button";

export const metadata: Metadata = { title: "Estado de cuenta" };

/**
 * The statement of account of a customer (PAG-06): balance, what is
 * overdue, the next payments, payments made and each account; to download
 * as PDF or mail to the customer.
 */
export default async function EstadoDeCuentaPage({
  params,
}: PageProps<"/ventas/cuentas/cliente/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas/cuentas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
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
  const statement = await getCustomerStatement(actor, id);
  if (!statement) notFound();
  const deliveries = await getStatementDeliveries(actor, id);
  const maySend =
    moduleState === "active" && access.allows("sales.customer.create");

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Estado de cuenta"
        description={statement.customer.name}
        actions={
          <Button asChild>
            <a
              href={`/api/ventas/clientes/${statement.customer.id}/estado-de-cuenta`}
            >
              <Download aria-hidden="true" data-icon="inline-start" />
              Descargar PDF
            </a>
          </Button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <section
            aria-label="Saldo"
            className="space-y-1 rounded-xl border bg-card p-4 sm:p-5"
          >
            <p className="text-sm text-muted-foreground">
              Al {statement.todayText}
            </p>
            <p className="text-2xl font-semibold tabular-nums">
              Debe {statement.balance}
            </p>
            {statement.overdue !== "$0.00" && (
              <p className="text-sm font-medium text-destructive">
                Vencido: {statement.overdue}
              </p>
            )}
          </section>
          {statement.upcoming.length > 0 && (
            <section
              aria-labelledby="proximos-pagos"
              className="rounded-xl border bg-card"
            >
              <h2
                id="proximos-pagos"
                className="border-b p-4 font-medium sm:px-5"
              >
                Próximos pagos
              </h2>
              <ul className="divide-y text-sm tabular-nums">
                {statement.upcoming.map((next) => (
                  <li
                    key={`${next.accountNumber}-${next.number}`}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
                  >
                    <span>
                      {next.dueText} · cuenta {next.accountNumber}, mensualidad{" "}
                      {next.number}
                    </span>
                    <span className="flex items-center gap-3">
                      {next.overdue && (
                        <Badge variant="destructive">Vencida</Badge>
                      )}
                      <span className="font-medium">{next.left}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section
            aria-labelledby="cuentas-cliente"
            className="rounded-xl border bg-card"
          >
            <h2
              id="cuentas-cliente"
              className="border-b p-4 font-medium sm:px-5"
            >
              Cuentas
            </h2>
            <ul className="divide-y">
              {statement.accounts.map((account) => (
                <li
                  key={account.id}
                  className="relative flex items-start justify-between gap-3 p-4 hover:bg-muted/40 sm:px-5"
                >
                  <div className="min-w-0 space-y-1">
                    <Link
                      href={`/ventas/cuentas/${account.id}`}
                      className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Cuenta {account.number}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {account.statusLabel} · venta {account.sale.number} ·{" "}
                      {account.months} mensualidades ({account.interestText})
                    </p>
                  </div>
                  <p className="shrink-0 font-medium tabular-nums">
                    {account.balance}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          {statement.payments.length > 0 && (
            <section
              aria-labelledby="pagos-cliente"
              className="rounded-xl border bg-card"
            >
              <h2
                id="pagos-cliente"
                className="border-b p-4 font-medium sm:px-5"
              >
                Pagos recibidos
              </h2>
              <ul className="divide-y text-sm tabular-nums">
                {statement.payments.map((payment) => (
                  <li
                    key={payment.number}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
                  >
                    <span>
                      Recibo {payment.number} · cuenta {payment.accountNumber} ·{" "}
                      {payment.createdAtText}
                    </span>
                    <span className="font-medium">{payment.amount}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
        {maySend && (
          <section
            aria-labelledby="envio-estado"
            className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
          >
            <h2 id="envio-estado" className="font-medium">
              Envío por correo
            </h2>
            <p className="text-sm text-muted-foreground">
              {statement.customer.email
                ? `Se manda a ${statement.customer.email}, con el PDF adjunto.`
                : `${statement.customer.name} no tiene correo en su ficha.`}
            </p>
            {statement.customer.email && (
              <SendStatementButton
                customerId={statement.customer.id}
                inProgress={deliveries.some((d) => d.status === "QUEUED")}
              />
            )}
            {deliveries.length > 0 && (
              <ul className="space-y-1 text-sm">
                {deliveries.map((delivery) => (
                  <li key={delivery.id}>
                    <Badge
                      variant={
                        delivery.status === "SENT"
                          ? "success"
                          : delivery.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {delivery.statusLabel}
                    </Badge>{" "}
                    {delivery.recipient}
                    {delivery.failureReason && (
                      <span className="block text-muted-foreground">
                        {delivery.failureReason}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </PageContainer>
  );
}
