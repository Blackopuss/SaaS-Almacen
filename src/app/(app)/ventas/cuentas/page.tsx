import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  EmptyState,
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
} from "@/components";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RECEIVABLE_PAGE_SIZE, listReceivables } from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

export const metadata: Metadata = { title: "Cuentas por cobrar" };

/**
 * Accounts of sales on installments (PAG-05): the open ones by default,
 * newest first; each row opens the account.
 */
export default async function CuentasPage({
  searchParams,
}: PageProps<"/ventas/cuentas">) {
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
  if (!access.can("sales.receivable.read")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  if (access.moduleState("sales") === "none") {
    return (
      <PageContainer>
        {back}
        <NoModuleState module="Ventas" />
      </PageContainer>
    );
  }
  const { pagina, todas } = await searchParams;
  const all = todas === "1";
  const list = await listReceivables(
    { organizationId: access.organization.id, userId: access.user.id },
    {
      open: !all,
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : 1,
    },
  );
  const count = (n: number) => n.toLocaleString("es-MX");
  const first = (list.page - 1) * RECEIVABLE_PAGE_SIZE + 1;
  const last = first + list.items.length - 1;
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (all) params.set("todas", "1");
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/ventas/cuentas?${query}` : "/ventas/cuentas";
  };

  return (
    <PageContainer>
      {back}
      <PageHeader title="Cuentas por cobrar" />
      {list.items.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={all ? "Todavía no hay ventas a plazos" : "Nadie debe nada"}
          description="Una cuenta nace al cobrar el enganche de una venta a plazos."
        />
      ) : (
        <section
          aria-labelledby="lista-cuentas"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="lista-cuentas" className="font-medium">
              {all ? "Todas las cuentas" : "Cuentas abiertas"}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {list.total === 1
                ? "1 cuenta"
                : `${count(first)}–${count(last)} de ${count(list.total)} cuentas`}
            </p>
          </div>
          <ul className="divide-y">
            {list.items.map((item) => (
              <li
                key={item.id}
                className="relative flex items-start justify-between gap-3 p-4 hover:bg-muted/40 sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Link
                      href={`/ventas/cuentas/${item.id}`}
                      className="rounded font-medium outline-none after:absolute after:inset-0 focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {item.customer}
                    </Link>
                    {item.overdue && (
                      <Badge variant="destructive">Con atraso</Badge>
                    )}
                    {all && <Badge variant="outline">{item.statusLabel}</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Cuenta {item.number}
                    {item.nextDueText && ` · próxima el ${item.nextDueText}`}
                  </p>
                </div>
                <p className="shrink-0 font-medium tabular-nums">
                  {item.balance}
                </p>
              </li>
            ))}
          </ul>
          {list.pageCount > 1 && (
            <nav
              aria-label="Páginas de cuentas"
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
      <p>
        <Link
          href={all ? "/ventas/cuentas" : "/ventas/cuentas?todas=1"}
          className="inline-flex min-h-11 items-center rounded-lg text-sm text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {all ? "Ver solo las abiertas" : "Ver también las pagadas"}
        </Link>
      </p>
    </PageContainer>
  );
}
