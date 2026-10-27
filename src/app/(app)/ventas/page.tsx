import { History, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { newId } from "@/lib";
import {
  SALE_MAX_LINES,
  SALE_MAX_PAYMENTS,
  getMyCashSession,
  listDiscountAuthorizers,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { OpenCashForm } from "./caja/cash-forms";
import { SaleForm } from "./sale-form";

export const metadata: Metadata = { title: "Ventas" };

/**
 * The counter (VEN-06..13, ADR 0030): search or scan, the cart adds up and
 * the sale is charged; its stock leaves in the same confirmation.
 */
export default async function VentasPage() {
  const access = await getModuleAccess();
  if (!access.can("sales.sale.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  // Who only looks at sales (Consulta) lands on their history.
  if (!access.can("sales.sale.create")) redirect("/ventas/historial");
  const moduleState = access.moduleState("sales");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        <PageHeader title="Ventas" />
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
  const operatesCash = access.allows("sales.cash.operate");
  const [authorizers, cash] = await Promise.all([
    listDiscountAuthorizers(actor),
    operatesCash ? getMyCashSession(actor) : null,
  ]);
  const linkClass =
    "inline-flex min-h-11 items-center gap-1.5 rounded text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";
  const links = (
    <div className="-mt-3 flex flex-wrap gap-x-5">
      {operatesCash && (
        <Link href="/ventas/caja" className={linkClass}>
          <Wallet aria-hidden="true" className="size-4" />
          Caja
        </Link>
      )}
      <Link href="/ventas/historial" className={linkClass}>
        <History aria-hidden="true" className="size-4" />
        Historial de ventas
      </Link>
    </div>
  );
  // VEN-16: nobody charges without their register open.
  if (!cash) {
    return (
      <PageContainer>
        <PageHeader title="Ventas" />
        {links}
        {operatesCash ? (
          <OpenCashForm />
        ) : (
          <p className="text-sm text-muted-foreground">
            Para cobrar se necesita una caja abierta, y tu rol no abre caja.
          </p>
        )}
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title="Ventas" />
      {links}
      <SaleForm
        authorizers={authorizers}
        maxLines={SALE_MAX_LINES}
        maxPayments={SALE_MAX_PAYMENTS}
        idempotencyKey={newId()}
        canPickCustomer={access.allows("sales.customer.read")}
        canCreateCustomer={access.allows("sales.customer.create")}
      />
    </PageContainer>
  );
}
