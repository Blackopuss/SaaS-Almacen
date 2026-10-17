import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { getPurchaseOrder } from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";

import { updatePurchaseOrderAction } from "../../actions";
import { OrderForm } from "../../order-form";

export const metadata: Metadata = { title: "Datos de la orden" };

/** Editing the expected day and the notes of a draft (CMP-04). */
export default async function EditarOrdenPage({
  params,
}: PageProps<"/compras/ordenes/[id]/editar">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const back = (
    <Link
      href={`/compras/ordenes/${id}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Orden
    </Link>
  );
  if (!access.can("purchasing.order.update")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("purchasing");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Compras" />
        ) : (
          <ReadOnlyNotice module="Compras" />
        )}
      </PageContainer>
    );
  }
  const order = await getPurchaseOrder(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!order) notFound();
  // Only a draft has data to change.
  if (!order.editable) redirect(`/compras/ordenes/${order.id}`);

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Datos de la orden"
        description={`${order.numberText} · ${order.supplierName}`}
      />
      <OrderForm
        action={updatePurchaseOrderAction.bind(null, order.id)}
        initial={{
          supplierId: order.supplierId,
          expectedOn: order.expectedOn ?? "",
          notes: order.notes ?? "",
        }}
        suppliers={null}
        submitLabel="Guardar cambios"
        cancelHref={`/compras/ordenes/${order.id}`}
      />
    </PageContainer>
  );
}
