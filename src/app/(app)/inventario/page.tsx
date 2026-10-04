import { CircleCheck, Package, Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { getModuleAccess } from "@/platform/billing";
import { listRecentProducts } from "@/platform/catalog";

export const metadata: Metadata = { title: "Inventario" };

/** Catalog of the company. The paginated list and search arrive with INV-10/11. */
export default async function InventarioPage({
  searchParams,
}: PageProps<"/inventario">) {
  const access = await getModuleAccess();
  if (!access.can("inventory.product.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }

  const { creado } = await searchParams;
  const created = typeof creado === "string" ? creado.slice(0, 64) : "";
  const products = await listRecentProducts({
    organizationId: access.organization.id,
    userId: access.user.id,
  });
  // Shown only to who may add products, and only while the plan allows it.
  const addButton = access.allows("inventory.product.create") ? (
    <Button asChild>
      <Link href="/inventario/nuevo">
        <Plus aria-hidden="true" data-icon="inline-start" />
        Agregar producto
      </Link>
    </Button>
  ) : undefined;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Inventario"
        description="Qué hay, cuánto y dónde está."
        actions={addButton}
      />
      {created && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            Producto <span className="font-medium">{created}</span> guardado.
            Sus existencias se registran con una entrada.
          </p>
        </div>
      )}
      {products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Todavía no hay productos"
          description="Agrega tu primer producto para empezar a controlar tu inventario."
          action={addButton}
        />
      ) : (
        <section
          aria-labelledby="recientes"
          className="rounded-xl border bg-card"
        >
          <h2 id="recientes" className="border-b p-4 font-medium sm:px-5">
            Productos agregados recientemente
          </h2>
          <ul className="divide-y">
            {products.map((product) => (
              <li key={product.id} className="p-4 sm:px-5">
                <p className="font-medium">{product.name}</p>
                <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {[product.sku, product.category, product.brand]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageContainer>
  );
}
