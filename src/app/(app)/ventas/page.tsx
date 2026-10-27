import type { Metadata } from "next";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { SALE_MAX_LINES } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { SaleForm } from "./sale-form";

export const metadata: Metadata = { title: "Ventas" };

/** The counter (VEN-06, ADR 0030): search or scan, and the cart adds up. */
export default async function VentasPage() {
  const access = await getModuleAccess();
  if (!access.can("sales.sale.create")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
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

  return (
    <PageContainer>
      <PageHeader title="Ventas" />
      <SaleForm maxLines={SALE_MAX_LINES} />
    </PageContainer>
  );
}
