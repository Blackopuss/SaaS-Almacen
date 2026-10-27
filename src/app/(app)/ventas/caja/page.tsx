import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { formatDateTime } from "@/lib";
import { getMyCashSession, listCashSessions } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { CashMovementForm, OpenCashForm } from "./cash-forms";
import { CashSummary } from "./cash-summary";

export const metadata: Metadata = { title: "Caja" };

/**
 * The cash register (VEN-16..18): your own, with money in and out, and —
 * for cash managers — every register open, to close it.
 */
export default async function CajaPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Ventas
    </Link>
  );
  if (!access.can("sales.cash.operate")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Ventas" />
        ) : (
          <ReadOnlyNotice module="Ventas" />
        )}
      </PageContainer>
    );
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const timeZone = access.organization.timeZone;
  const [mine, open] = await Promise.all([
    getMyCashSession(actor),
    access.allows("sales.cash.close") ? listCashSessions(actor) : null,
  ]);

  return (
    <PageContainer>
      {back}
      <PageHeader title="Caja" />
      {mine ? (
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <CashSummary session={mine} timeZone={timeZone} />
          <CashMovementForm />
        </div>
      ) : (
        <OpenCashForm />
      )}
      {open && (
        <section aria-labelledby="cajas-abiertas" className="space-y-3">
          <h2 id="cajas-abiertas" className="text-lg font-semibold">
            Cajas abiertas
          </h2>
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No hay cajas abiertas.
            </p>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {open.map((session) => (
                <li key={session.id} className="relative">
                  <Link
                    href={`/ventas/caja/${session.id}`}
                    className="flex min-h-14 items-center gap-3 p-4 outline-none after:absolute after:inset-0 hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-5"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {session.cashier}
                      </span>
                      <span className="block text-sm text-muted-foreground">
                        Abierta el {formatDateTime(session.openedAt, timeZone)}
                      </span>
                    </span>
                    <span className="text-sm font-medium text-primary">
                      Hacer corte
                    </span>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-5 text-muted-foreground"
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </PageContainer>
  );
}
