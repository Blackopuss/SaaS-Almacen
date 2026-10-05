import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  TriangleAlert,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LOW_STOCK_PAGE_SIZE, listLowStock } from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Existencias bajas" };

/**
 * Products at or below their minimum (INV-30), the emptiest first. The
 * list is worked out from the real balances every time it is opened.
 */
export default async function ExistenciasBajasPage({
  searchParams,
}: PageProps<"/inventario/bajas">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/inventario"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Inventario
    </Link>
  );
  if (
    !access.can("inventory.minimum.read") ||
    !access.can("inventory.stock.read")
  ) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("inventory");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Inventario" />
      </PageContainer>
    );
  }
  const { pagina } = await searchParams;
  const list = await listLowStock(
    { organizationId: access.organization.id, userId: access.user.id },
    {
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : 1,
    },
  );
  const count = (n: number) => n.toLocaleString("es-MX");
  const first = (list.page - 1) * LOW_STOCK_PAGE_SIZE + 1;
  const last = first + list.items.length - 1;
  const pageHref = (page: number) =>
    page > 1 ? `/inventario/bajas?pagina=${page}` : "/inventario/bajas";
  const canEnter = access.allows("inventory.entry.create");

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Existencias bajas"
        description="Productos que llegaron a su mínimo o están por debajo, según lo que hay hoy."
      />
      {list.total === 0 ? (
        list.withMinimum === 0 ? (
          <EmptyState
            icon={TriangleAlert}
            title="Ningún producto tiene mínimo"
            description="Abre un producto y escribe su mínimo: cuando sus existencias lleguen a esa cantidad aparecerá aquí."
            action={
              <Button asChild variant="outline">
                <Link href="/inventario">Ir a Inventario</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={CircleCheck}
            title="Todo está por encima de su mínimo"
            description={
              list.withMinimum === 1
                ? "Tu producto con mínimo tiene existencias suficientes."
                : `Tus ${count(list.withMinimum)} productos con mínimo tienen existencias suficientes.`
            }
          />
        )
      ) : (
        <section
          aria-labelledby="productos-bajos"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="productos-bajos" className="font-medium">
              Por reponer
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.total === 1
                ? "1 producto"
                : `${count(first)}–${count(last)} de ${count(list.total)} productos`}
            </p>
          </div>
          <ul className="divide-y">
            {list.items.map((item) => (
              <li
                key={item.productId}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4 sm:px-5"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <Link
                    href={`/inventario/${item.productId}`}
                    className="inline-flex min-h-11 items-center rounded-lg font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {item.name}
                  </Link>
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {item.sku} · Mínimo {item.minimumLabel}
                  </p>
                </div>
                <div className="text-sm">
                  <p className="flex flex-wrap items-center gap-2">
                    <Badge variant={item.empty ? "destructive" : "warning"}>
                      {item.empty ? "Agotado" : "Bajo"}
                    </Badge>
                    <span className="font-medium tabular-nums">
                      Hay {item.stockLabel}
                    </span>
                  </p>
                  <p className="text-muted-foreground tabular-nums">
                    Faltan {item.missingLabel} para el mínimo
                  </p>
                </div>
                {canEnter && (
                  <Button asChild variant="outline">
                    <Link
                      href={`/movimientos/entrada?producto=${item.productId}`}
                      aria-label={`Registrar entrada de ${item.name}`}
                    >
                      <ArrowDownToLine
                        aria-hidden="true"
                        data-icon="inline-start"
                      />
                      Entrada
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {list.pageCount > 1 && (
            <nav
              aria-label="Páginas de la lista"
              className="flex items-center justify-between gap-3 border-t p-4 sm:px-5"
            >
              {list.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(list.page - 1)} rel="prev">
                    <ChevronLeft aria-hidden="true" data-icon="inline-start" />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                Página {count(list.page)} de {count(list.pageCount)}
              </p>
              {list.page < list.pageCount ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(list.page + 1)} rel="next">
                    Siguiente
                    <ChevronRight aria-hidden="true" data-icon="inline-end" />
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
            </nav>
          )}
        </section>
      )}
    </PageContainer>
  );
}
