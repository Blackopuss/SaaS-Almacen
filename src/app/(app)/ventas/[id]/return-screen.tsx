import { ChevronLeft, Undo2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { newId } from "@/lib";
import { getReturnableSale } from "@/modules/sales";
import type { getModuleAccess } from "@/platform/billing";

import { ReturnForm } from "./return-form";

/**
 * «Devolver productos» and «Cancelar venta» (VEN-19..21): the same screen,
 * one with what comes back of each line, the other with all that is left.
 */
export async function ReturnScreen({
  access,
  saleId,
  mode,
}: {
  access: Awaited<ReturnType<typeof getModuleAccess>>;
  saleId: string;
  mode: "return" | "cancel";
}) {
  const back = (
    <Link
      href={`/ventas/${encodeURIComponent(saleId)}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Venta
    </Link>
  );
  const permission =
    mode === "cancel" ? "sales.sale.cancel" : "sales.return.create";
  if (!access.can(permission)) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const state = access.moduleState("sales");
  if (state === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const sale = await getReturnableSale(
    { organizationId: access.organization.id, userId: access.user.id },
    saleId,
  );
  if (!sale) notFound();
  const title = mode === "cancel" ? "Cancelar venta" : "Devolver productos";
  const nothingLeft = sale.lines.every((line) => line.returnable === "0");

  return (
    <PageContainer>
      {back}
      <PageHeader title={`${title} · Venta ${sale.number}`} />
      {state === "read_only" ? (
        <ReadOnlyNotice module="Ventas" />
      ) : sale.cancelled ? (
        <EmptyState
          icon={Undo2}
          title="Esta venta ya está cancelada"
          description={`Se devolvieron ${sale.refunded}.`}
        />
      ) : nothingLeft ? (
        <EmptyState
          icon={Undo2}
          title="De esta venta ya regresó todo"
          description={`Se devolvieron ${sale.refunded}.`}
        />
      ) : (
        <ReturnForm
          mode={mode}
          saleId={sale.saleId}
          lines={sale.lines}
          left={sale.left}
          defaultMethod={sale.paidWith[0] ?? "CASH"}
          idempotencyKey={newId()}
        />
      )}
    </PageContainer>
  );
}
