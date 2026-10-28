import {
  ChevronLeft,
  ChevronRight,
  FilePlus,
  FileText,
  PackageCheck,
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
import { QUOTE_PAGE_SIZE, listQuotes, type QuoteStatus } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Cotizaciones" };

const BADGE: Record<
  QuoteStatus,
  "secondary" | "outline" | "success" | "destructive"
> = {
  DRAFT: "outline",
  SENT: "secondary",
  ACCEPTED: "success",
  REJECTED: "destructive",
  EXPIRED: "outline",
};

/**
 * Quotes of the company (COT-02): newest first; each row opens the quote.
 */
export default async function CotizacionesPage({
  searchParams,
}: PageProps<"/ventas/cotizaciones">) {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/ventas"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Ventas
    </Link>
  );
  if (!access.can("sales.quote.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const { pagina } = await searchParams;
  const list = await listQuotes(
    { organizationId: access.organization.id, userId: access.user.id },
    {
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : 1,
    },
  );
  const create = access.allows("sales.quote.create") ? (
    <Button asChild>
      <Link href="/ventas/cotizaciones/nueva">
        <FilePlus aria-hidden="true" data-icon="inline-start" />
        Nueva cotización
      </Link>
    </Button>
  ) : undefined;
  const count = (n: number) => n.toLocaleString("es-MX");
  const first = (list.page - 1) * QUOTE_PAGE_SIZE + 1;
  const last = first + list.items.length - 1;
  const pageHref = (page: number) =>
    page > 1 ? `/ventas/cotizaciones?pagina=${page}` : "/ventas/cotizaciones";

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Ventas" />}
      <PageHeader title="Cotizaciones" actions={create} />
      <p className="-mt-2 flex flex-wrap gap-x-6">
        <Link
          href="/ventas/pedidos"
          className="inline-flex min-h-11 items-center gap-1.5 rounded-lg text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <PackageCheck aria-hidden="true" className="size-4" />
          Pedidos
        </Link>
      </p>
      {list.items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Todavía no hay cotizaciones"
          description="Una cotización dice al cliente cuánto le costaría y hasta cuándo."
          action={create}
        />
      ) : (
        <section
          aria-labelledby="lista-cotizaciones"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="lista-cotizaciones" className="font-medium">
              Cotizaciones
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.total === 1
                ? "1 cotización"
                : `${count(first)}–${count(last)} de ${count(list.total)} cotizaciones`}
            </p>
          </div>
          <ul className="divide-y">
            {list.items.map((quote) => (
              <li
                key={quote.id}
                className="relative flex items-start justify-between gap-3 p-4 hover:bg-muted/40 sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/ventas/cotizaciones/${quote.id}`}
                      className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      Cotización {quote.number}
                    </Link>
                    <Badge variant={BADGE[quote.status]}>
                      {quote.statusLabel}
                    </Badge>
                  </div>
                  <p className="text-sm [overflow-wrap:anywhere]">
                    {quote.customer}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Vale hasta {quote.validUntil}
                  </p>
                </div>
                <p className="shrink-0 font-medium tabular-nums">
                  {quote.total}
                </p>
              </li>
            ))}
          </ul>
          {list.pageCount > 1 && (
            <nav
              aria-label="Páginas de cotizaciones"
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
