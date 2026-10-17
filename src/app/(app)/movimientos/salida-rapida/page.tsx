import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { newId } from "@/lib";
import { QUICK_EXIT_MAX_LINES } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { loadExitProduct } from "./exit-product";
import { QuickExitForm } from "./quick-exit-form";

export const metadata: Metadata = { title: "Salida rápida" };

/**
 * Quick exit of several products (INV-28): what a sale takes from the
 * shelves, in one confirmation. No prices, charges or tickets.
 */
export default async function SalidaRapidaPage({
  searchParams,
}: PageProps<"/movimientos/salida-rapida">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/movimientos"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Movimientos
    </Link>
  );
  if (!access.can("inventory.exit.create")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
          <NoModuleState module="Inventario" />
        ) : (
          <ReadOnlyNotice module="Inventario" />
        )}
      </PageContainer>
    );
  }
  const { producto } = await searchParams;
  const initial =
    typeof producto === "string" && producto
      ? await loadExitProduct(
          { organizationId: access.organization.id, userId: access.user.id },
          producto,
          access.can("inventory.presentation.read"),
        )
      : null;

  return (
    <PageContainer>
      {back}
      <PageHeader
        title="Salida rápida"
        description="Varios productos en una sola confirmación. Solo registra lo que sale: no cobra ni genera ticket."
      />
      <QuickExitForm
        idempotencyKey={newId()}
        initial={initial}
        maxLines={QUICK_EXIT_MAX_LINES}
      />
    </PageContainer>
  );
}
