import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { getSalePrices } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";
import { getProduct } from "@/platform/catalog";

import { PricesForm } from "./prices-form";

export const metadata: Metadata = { title: "Cambiar precios" };

/** Sale prices of a product (VEN-03), with Ventas contracted. */
export default async function PreciosPage({
  params,
}: PageProps<"/inventario/[id]/precios">) {
  const access = await getModuleAccess();
  const { id } = await params;
  const back = (
    <Link
      href={`/inventario/${encodeURIComponent(id)}`}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Volver al producto
    </Link>
  );
  if (!access.can("sales.price.update")) {
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
  const [product, prices] = await Promise.all([
    getProduct(actor, id),
    getSalePrices(actor, id),
  ]);
  if (!product || !prices) notFound();

  return (
    <PageContainer>
      {back}
      <PageHeader title="Cambiar precios" description={product.name} />
      <PricesForm
        productId={product.id}
        rows={prices.rows.map((row) => ({
          key: row.presentationId ?? "unit",
          label:
            row.presentationId === null
              ? `Precio por ${row.label.toLowerCase()}`
              : row.label,
          price: row.price ?? "",
          hint:
            row.presentationId === null
              ? undefined
              : row.derived && row.sellsAt
                ? `Vacío = se vende por su contenido: ${row.sellsAt}.`
                : "Vacío = se vende por su contenido.",
        }))}
      />
    </PageContainer>
  );
}
