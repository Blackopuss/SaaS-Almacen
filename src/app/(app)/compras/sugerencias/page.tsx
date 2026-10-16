import { ChevronLeft, PackageSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import { getPurchaseSuggestions } from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";

import { SuggestButton } from "./suggest-button";

export const metadata: Metadata = { title: "Qué pedir" };

const textLink =
  "rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * What to order (CMP-14): products at or below their minimum that what is
 * on its way does not cover, by the supplier they are bought from, with a
 * button that turns each group into a draft to review.
 */
export default async function SugerenciasPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/compras"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Compras
    </Link>
  );
  if (!access.can("purchasing.suggestion.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("purchasing");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Compras" />
      </PageContainer>
    );
  }
  const suggestions = await getPurchaseSuggestions({
    organizationId: access.organization.id,
    userId: access.user.id,
  });
  const canGenerate =
    moduleState === "active" &&
    access.allows("purchasing.suggestion.generate") &&
    access.allows("purchasing.order.create");
  const canLink = access.can("inventory.product.read");

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Compras" />}
      <PageHeader
        title="Qué pedir"
        description="Lo que está en su mínimo o por debajo y no viene en camino, agrupado por proveedor. Cada grupo se vuelve un borrador que revisas antes de confirmar."
      />
      {suggestions.groups.length === 0 ? (
        <EmptyState
          icon={PackageSearch}
          title="No hace falta pedir nada"
          description={
            suggestions.covered.length > 0
              ? "Lo que está bajo ya viene en camino en tus órdenes."
              : "Ningún producto está en su mínimo o por debajo. Los mínimos se ponen en la ficha de cada producto."
          }
        />
      ) : (
        suggestions.groups.map((group) => (
          <section
            key={group.supplierId ?? "sin-proveedor"}
            aria-label={group.supplierName ?? "Sin proveedor"}
            className="max-w-3xl rounded-xl border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5">
              <h2 className="font-medium [overflow-wrap:anywhere]">
                {group.supplierName ?? "Sin proveedor"}
                <span className="font-normal text-muted-foreground tabular-nums">
                  {" "}
                  · {group.items.length}
                </span>
              </h2>
              {canGenerate && group.supplierId && (
                <SuggestButton
                  productIds={group.items.map((item) => item.productId)}
                  label="Crear borrador"
                />
              )}
            </div>
            {!group.supplierId && (
              <p className="border-b px-4 py-3 text-sm text-muted-foreground sm:px-5">
                Estos productos no tienen proveedor. Lígalos a uno desde su
                ficha para poder pedirlos.
              </p>
            )}
            <ul className="divide-y">
              {group.items.map((item) => (
                <li
                  key={item.productId}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 p-4 sm:px-5"
                >
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium [overflow-wrap:anywhere]">
                      {canLink ? (
                        <Link
                          href={`/inventario/${item.productId}`}
                          className={textLink}
                        >
                          {item.name}
                        </Link>
                      ) : (
                        item.name
                      )}
                      <span className="font-normal text-muted-foreground">
                        {" "}
                        · {item.sku}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground tabular-nums">
                      Hay {item.stockText} · mínimo {item.minimumText}
                      {item.incomingText && ` · en camino ${item.incomingText}`}
                    </p>
                  </div>
                  <p className="text-sm font-medium tabular-nums">
                    Pedir {item.quantityText}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {suggestions.covered.length > 0 && (
        <section
          aria-labelledby="ya-en-camino"
          className="max-w-3xl rounded-xl border bg-card"
        >
          <h2
            id="ya-en-camino"
            className="border-b px-4 py-3 font-medium sm:px-5"
          >
            Ya vienen en camino
          </h2>
          <ul className="divide-y">
            {suggestions.covered.map((item) => (
              <li
                key={item.productId}
                className="flex flex-wrap justify-between gap-x-4 gap-y-1 p-4 text-sm sm:px-5"
              >
                <span className="[overflow-wrap:anywhere]">
                  {item.name}{" "}
                  <span className="text-muted-foreground">· {item.sku}</span>
                </span>
                <span className="text-muted-foreground tabular-nums">
                  {item.incomingText} en órdenes
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
