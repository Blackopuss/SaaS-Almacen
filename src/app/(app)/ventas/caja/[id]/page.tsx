import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { formatDateTime } from "@/lib";
import { getCashSession } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { CloseCashForm } from "../cash-forms";
import { CashSummary } from "../cash-summary";

export const metadata: Metadata = { title: "Corte de caja" };

/**
 * The close of a register (VEN-18): counted blind — what there should be
 * shows only once it is saved, next to what was counted.
 */
export default async function CorteCajaPage({
  params,
}: PageProps<"/ventas/caja/[id]">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas/caja"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Caja
    </Link>
  );
  if (!access.can("sales.cash.close")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  if (access.moduleState("sales") === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const { id } = await params;
  const session = await getCashSession(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!session) notFound();
  const timeZone = access.organization.timeZone;

  return (
    <PageContainer>
      {back}
      <PageHeader
        title={`Caja de ${session.cashier}`}
        description={`Abierta el ${formatDateTime(session.openedAt, timeZone)}`}
      />
      {session.close ? (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <section
            aria-labelledby="resultado-corte"
            className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
          >
            <h2 id="resultado-corte" className="font-medium">
              Corte de {session.close.closedBy},{" "}
              {formatDateTime(session.close.closedAt, timeZone)}
            </h2>
            <table className="w-full text-sm tabular-nums">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 font-normal">Forma</th>
                  <th className="py-1 text-right font-normal">Contado</th>
                  <th className="py-1 text-right font-normal">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {[
                  [
                    "Efectivo",
                    session.close.countedCash,
                    session.close.differenceCash,
                  ],
                  [
                    "Tarjeta",
                    session.close.countedCard,
                    session.close.differenceCard,
                  ],
                  [
                    "Transferencias",
                    session.close.countedTransfer,
                    session.close.differenceTransfer,
                  ],
                ].map(([label, counted, difference]) => (
                  <tr key={label} className="border-t">
                    <td className="py-1.5">{label}</td>
                    <td className="py-1.5 text-right">{counted}</td>
                    <td
                      className={`py-1.5 text-right font-medium ${difference === "$0.00" ? "" : "text-destructive"}`}
                    >
                      {difference === "$0.00" ? "Cuadra" : difference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {session.close.note && (
              <p className="text-sm text-muted-foreground">
                {session.close.note}
              </p>
            )}
          </section>
          <CashSummary session={session} timeZone={timeZone} />
        </div>
      ) : (
        <div className="max-w-2xl">
          <CloseCashForm sessionId={session.id} />
        </div>
      )}
    </PageContainer>
  );
}
