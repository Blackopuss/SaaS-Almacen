import { TicketPercent } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib";
import { listPromoCodes, requirePlatformStaff } from "@/platform/billing";

import { CreateCodeForm, DisableCodeButton } from "./code-forms";

export const metadata: Metadata = { title: "Códigos" };

/** Discount codes for the online purchase (ADR 0028). */
export default async function CodesPage() {
  const staff = await requirePlatformStaff();
  const codes = await listPromoCodes(staff.userId);
  const now = new Date();

  return (
    <PageContainer>
      <PageHeader
        title="Códigos"
        description="Códigos de descuento para la compra del plan. Uno de 100% activa el plan sin pago."
      />
      <CreateCodeForm />

      {codes.length === 0 ? (
        <EmptyState
          icon={TicketPercent}
          title="Sin códigos"
          description="Los códigos que crees aparecen aquí con sus usos."
        />
      ) : (
        <section aria-label="Códigos" className="rounded-xl border bg-card">
          <ul className="divide-y">
            {codes.map((code) => {
              const state = code.disabledAt
                ? { label: "Desactivado", variant: "outline" as const }
                : code.validUntil && code.validUntil <= now
                  ? { label: "Caducó", variant: "outline" as const }
                  : code.redemptions >= code.maxRedemptions
                    ? { label: "Agotado", variant: "secondary" as const }
                    : { label: "Vigente", variant: "success" as const };
              return (
                <li
                  key={code.id}
                  className="flex flex-wrap items-center gap-3 p-4 sm:px-5"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono font-medium [overflow-wrap:anywhere]">
                        {code.code}
                      </span>
                      <Badge variant={state.variant}>{state.label}</Badge>
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      {code.percentOff === 100
                        ? "Gratis (100%)"
                        : `${code.percentOff}% de descuento`}
                      {" · "}
                      {code.redemptions}/{code.maxRedemptions} usos
                      {" · "}
                      {code.validUntil
                        ? `válido hasta el ${formatDate(code.validUntil)}`
                        : "sin caducidad"}
                    </p>
                    {code.note && (
                      <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                        {code.note}
                      </p>
                    )}
                  </div>
                  {!code.disabledAt && (
                    <DisableCodeButton id={code.id} code={code.code} />
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
