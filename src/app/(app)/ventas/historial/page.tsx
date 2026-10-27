import {
  ChevronLeft,
  ChevronRight,
  Filter,
  Receipt,
  Search,
} from "lucide-react";
import type { Metadata } from "next";
import Form from "next/form";
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
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib";
import { SALE_PAGE_SIZE, listSaleCashiers, listSales } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { FilterSelect } from "../../inventario/filter-select";

export const metadata: Metadata = { title: "Historial de ventas" };

/**
 * History of sales (VEN-22): newest first, one page at a time, filtered by
 * dates, who charged and the customer or number. The filters live in the
 * address; each row opens the sale with its ticket.
 */
export default async function HistorialVentasPage({
  searchParams,
}: PageProps<"/ventas/historial">) {
  const access = await getModuleAccess();
  if (!access.can("sales.sale.read")) {
    return (
      <PageContainer>
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState === "none") {
    return (
      <PageContainer>
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const { desde, hasta, cajero, q, pagina } = await searchParams;
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim().slice(0, 100) : "";
  const [history, cashiers] = await Promise.all([
    listSales(actor, {
      from: text(desde),
      to: text(hasta),
      cashierId: text(cajero),
      search: text(q),
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : 1,
    }),
    listSaleCashiers(actor),
  ]);
  const { applied, items: sales } = history;
  const narrowed = Boolean(
    applied.from || applied.to || applied.cashierId || applied.search,
  );
  const count = (n: number) => n.toLocaleString("es-MX");
  const first = (history.page - 1) * SALE_PAGE_SIZE + 1;
  const last = first + sales.length - 1;
  /** Address of a page of this same history, with its filters. */
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (applied.search) params.set("q", applied.search);
    if (applied.from) params.set("desde", applied.from);
    if (applied.to) params.set("hasta", applied.to);
    if (applied.cashierId) params.set("cajero", applied.cashierId);
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/ventas/historial?${query}` : "/ventas/historial";
  };
  const timeZone = access.organization.timeZone;
  const back = access.allows("sales.sale.create") && (
    <Link
      href="/ventas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Ventas
    </Link>
  );

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Ventas" />}
      <PageHeader title="Historial de ventas" />
      {(history.total > 0 || narrowed) && (
        <Form
          action="/ventas/historial"
          role="search"
          aria-label="Filtrar ventas"
          className="flex max-w-4xl flex-wrap items-center gap-2"
        >
          <div className="min-w-48 flex-[2_1_12rem]">
            <label htmlFor="q" className="sr-only">
              Número de venta o cliente
            </label>
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={applied.search ?? ""}
              key={applied.search ?? ""}
              placeholder="Número de venta o cliente"
              maxLength={100}
              autoComplete="off"
              enterKeyHint="search"
            />
          </div>
          <Button type="submit" variant="outline">
            <Search aria-hidden="true" data-icon="inline-start" />
            Buscar
          </Button>
          <details
            className="group w-full"
            open={Boolean(applied.from || applied.to || applied.cashierId)}
          >
            <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <Filter aria-hidden="true" className="size-4" />
              Más filtros
            </summary>
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-1">
                <label
                  htmlFor="desde"
                  className="text-sm text-muted-foreground"
                >
                  Desde
                </label>
                <Input
                  id="desde"
                  name="desde"
                  type="date"
                  defaultValue={applied.from ?? ""}
                  key={applied.from ?? ""}
                  max={applied.to ?? undefined}
                />
              </div>
              <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-1">
                <label
                  htmlFor="hasta"
                  className="text-sm text-muted-foreground"
                >
                  Hasta
                </label>
                <Input
                  id="hasta"
                  name="hasta"
                  type="date"
                  defaultValue={applied.to ?? ""}
                  key={applied.to ?? ""}
                  min={applied.from ?? undefined}
                />
              </div>
              <div className="flex w-full flex-wrap gap-2">
                {cashiers.length > 0 && (
                  <FilterSelect
                    id="cajero"
                    name="cajero"
                    label="Filtrar por quién cobró"
                    value={
                      cashiers.some((c) => c.userId === applied.cashierId)
                        ? (applied.cashierId ?? "")
                        : ""
                    }
                    allLabel="Quién cobró"
                    options={cashiers.map((c) => ({
                      id: c.userId,
                      name: c.name,
                    }))}
                  />
                )}
                <Button type="submit" variant="outline">
                  Aplicar
                </Button>
              </div>
            </div>
          </details>
        </Form>
      )}
      {narrowed && (
        <p className="text-sm" role="status">
          {history.total === 0
            ? "Sin resultados"
            : history.total === 1
              ? "1 venta"
              : `${count(history.total)} ventas`}
          .{" "}
          <Link
            href="/ventas/historial"
            className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Quitar filtros
          </Link>
        </p>
      )}
      {sales.length === 0 && narrowed ? (
        <EmptyState
          icon={Search}
          title="Ninguna venta coincide"
          description="Prueba con otras fechas o quita algún filtro."
        />
      ) : sales.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Todavía no hay ventas"
          description="Aquí verás cada venta cobrada, con su ticket."
        />
      ) : (
        <section
          aria-labelledby="ventas-encontradas"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="ventas-encontradas" className="font-medium">
              {narrowed ? "Ventas encontradas" : "Ventas"}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {history.total === 1
                ? "1 venta"
                : `${count(first)}–${count(last)} de ${count(history.total)} ventas`}
            </p>
          </div>
          <ul className="divide-y">
            {sales.map((sale) => (
              <li
                key={sale.id}
                className="relative flex items-start justify-between gap-3 p-4 hover:bg-muted/40 sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/ventas/${sale.id}`}
                      className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Venta {sale.number}
                    </Link>
                    {sale.cancelled && (
                      <Badge variant="destructive">Cancelada</Badge>
                    )}
                    {sale.refunded && (
                      <Badge variant="outline">
                        Devolución de {sale.refunded}
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm [overflow-wrap:anywhere]">
                    {sale.customer}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={sale.createdAt.toISOString()}>
                      {formatDateTime(sale.createdAt, timeZone)}
                    </time>
                    {" · "}
                    {sale.cashier ?? "Alguien que ya no está en el equipo"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p
                    className={
                      sale.cancelled
                        ? "font-medium text-muted-foreground tabular-nums line-through"
                        : "font-medium tabular-nums"
                    }
                  >
                    {sale.total}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {sale.paidWith}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {history.pageCount > 1 && (
            <nav
              aria-label="Páginas del historial"
              className="flex items-center justify-between gap-3 border-t p-4 sm:px-5"
            >
              {history.page > 1 ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(history.page - 1)} rel="prev">
                    <ChevronLeft aria-hidden="true" data-icon="inline-start" />
                    Anterior
                  </Link>
                </Button>
              ) : (
                <span aria-hidden="true" />
              )}
              <p className="text-sm text-muted-foreground tabular-nums">
                Página {count(history.page)} de {count(history.pageCount)}
              </p>
              {history.page < history.pageCount ? (
                <Button asChild variant="outline">
                  <Link href={pageHref(history.page + 1)} rel="next">
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
