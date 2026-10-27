import type { Metadata } from "next";

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
  listDiscountAuthorizers,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { SaleForm } from "./sale-form";

export const metadata: Metadata = { title: "Ventas" };

/**
 * The counter (VEN-06..13, ADR 0030): search or scan, the cart adds up and
 * the sale is charged; its stock leaves in the same confirmation.
 */
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

  const authorizers = await listDiscountAuthorizers({
    organizationId: access.organization.id,
    userId: access.user.id,
  });

  return (
    <PageContainer>
      <PageHeader title="Ventas" />
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
