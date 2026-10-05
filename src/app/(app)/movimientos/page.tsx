import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  ClipboardList,
  Filter,
  Scale,
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
import { formatDateTime, newId } from "@/lib";
import {
  MOVEMENT_PAGE_SIZE,
  MOVEMENT_TYPE_LABELS,
  listMovementAuthors,
  listMovements,
  listRecentMovements,
} from "@/modules/inventory";
import { getModuleAccess } from "@/platform/billing";

import { FilterSelect } from "../inventario/filter-select";
import { ReverseMovement } from "./reverse-dialog";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const TYPE_OPTIONS = Object.entries(MOVEMENT_TYPE_LABELS).map(([id, name]) => ({
  id,
  name,
}));

export const metadata: Metadata = { title: "Movimientos" };

/**
 * History of stock movements (INV-16, INV-27): newest first, one page at a
 * time, filtered by dates, product, person and kind. The filters live in
 * the address, so a filtered view can be shared or reloaded.
 */
export default async function MovimientosPage({
  searchParams,
}: PageProps<"/movimientos">) {
  const access = await getModuleAccess();
  if (!access.can("inventory.movement.read")) {
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
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };
  const { registrado, desde, hasta, producto, persona, tipo, pagina } =
    await searchParams;
  const text = (value: unknown) =>
    typeof value === "string" ? value.trim().slice(0, 100) : "";
  const productText = text(producto);
  const [history, authors, registered] = await Promise.all([
    listMovements(actor, {
      from: text(desde),
      to: text(hasta),
      // The product card links here with the id; the box sends text.
      ...(UUID.test(productText)
        ? { productId: productText }
        : { productSearch: productText }),
      userId: text(persona),
      type: text(tipo),
      page:
        typeof pagina === "string" && /^\d{1,6}$/.test(pagina)
          ? Number(pagina)
          : 1,
    }),
    listMovementAuthors(actor),
    // The notice is built from the stored movement, never from the address.
    typeof registrado === "string" && registrado
      ? listRecentMovements(actor, { movementId: registrado.slice(0, 36) })
      : [],
  ]);
  const justRegistered = registered[0];
  const movements = history.items;
  const { applied } = history;
  const narrowed = Boolean(
    applied.from ||
    applied.to ||
    applied.productId ||
    applied.productSearch ||
    applied.userId ||
    applied.type,
  );
  const count = (n: number) => n.toLocaleString("es-MX");
  const first = (history.page - 1) * MOVEMENT_PAGE_SIZE + 1;
  const last = first + movements.length - 1;
  /** Address of a page of this same history, with its filters. */
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (applied.from) params.set("desde", applied.from);
    if (applied.to) params.set("hasta", applied.to);
    if (applied.productId) params.set("producto", applied.productId);
    if (applied.productSearch) params.set("producto", applied.productSearch);
    if (applied.userId) params.set("persona", applied.userId);
    if (applied.type) params.set("tipo", applied.type);
    if (page > 1) params.set("pagina", String(page));
    const query = params.toString();
    return query ? `/movimientos?${query}` : "/movimientos";
  };
  // Name of the product the card linked with, taken from what was found.
  const linkedProduct = applied.productId
    ? (movements
        .flatMap((movement) => movement.lines)
        .find((line) => line.productId === applied.productId)?.productName ??
      "el producto elegido")
    : null;
  // Shown only to who may register entries, and only while the plan allows it.
  const entryButton = access.allows("inventory.entry.create") ? (
    <Button asChild>
      <Link href="/movimientos/entrada">
        <ArrowDownToLine aria-hidden="true" data-icon="inline-start" />
        Registrar entrada
      </Link>
    </Button>
  ) : undefined;
  const exitButton = access.allows("inventory.exit.create") ? (
    <Button asChild variant="outline">
      <Link href="/movimientos/salida">
        <ArrowUpFromLine aria-hidden="true" data-icon="inline-start" />
        Registrar salida
      </Link>
    </Button>
  ) : undefined;
  const transferButton = access.allows("inventory.transfer.create") ? (
    <Button asChild variant="outline">
      <Link href="/movimientos/reubicar">
        <ArrowLeftRight aria-hidden="true" data-icon="inline-start" />
        Reubicar
      </Link>
    </Button>
  ) : undefined;
  const adjustmentButton = access.allows("inventory.adjustment.create") ? (
    <Button asChild variant="outline">
      <Link href="/movimientos/ajuste">
        <Scale aria-hidden="true" data-icon="inline-start" />
        Ajustar
      </Link>
    </Button>
  ) : undefined;
  const openingButton = access.allows("inventory.opening.create") ? (
    <Button asChild variant="outline">
      <Link href="/movimientos/saldo-inicial">
        <ClipboardList aria-hidden="true" data-icon="inline-start" />
        Saldo inicial
      </Link>
    </Button>
  ) : undefined;
  const canReverse = access.allows("inventory.movement.reverse");
  const actions =
    entryButton ||
    exitButton ||
    transferButton ||
    adjustmentButton ||
    openingButton ? (
      <>
        {entryButton}
        {exitButton}
        {transferButton}
        {adjustmentButton}
        {openingButton}
      </>
    ) : undefined;

  return (
    <PageContainer>
      {moduleState === "read_only" && <ReadOnlyNotice module="Inventario" />}
      <PageHeader
        title="Movimientos"
        description="Entradas, salidas, reubicaciones y ajustes."
        actions={actions}
      />
      {justRegistered && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          <p>
            {justRegistered.type === "ADJUSTMENT"
              ? "Ajuste registrado"
              : `${justRegistered.typeLabel} registrada`}
            :{" "}
            {justRegistered.type === "TRANSFER" &&
            justRegistered.lines.length === 2 ? (
              <span>
                <span className="font-medium">
                  {justRegistered.lines[0]!.quantity}
                </span>{" "}
                de {justRegistered.lines[0]!.productName}, de{" "}
                {justRegistered.lines[0]!.location} a{" "}
                {justRegistered.lines[1]!.location}
              </span>
            ) : (
              justRegistered.lines.map((line, index) => (
                <span key={index}>
                  {index > 0 && "; "}
                  <span className="font-medium">
                    {justRegistered.type === "ADJUSTMENT" &&
                      (line.direction === "IN" ? "+" : "−")}
                    {line.quantity}
                  </span>{" "}
                  de {line.productName} en {line.location}
                </span>
              ))
            )}
            .
          </p>
        </div>
      )}
      {(history.total > 0 || narrowed) && (
        <Form
          action="/movimientos"
          role="search"
          aria-label="Filtrar movimientos"
          className="flex max-w-4xl flex-wrap items-end gap-2"
        >
          {applied.productId ? (
            <input type="hidden" name="producto" value={applied.productId} />
          ) : (
            <div className="min-w-48 flex-[2_1_12rem]">
              <label htmlFor="producto" className="sr-only">
                Producto
              </label>
              <Input
                id="producto"
                name="producto"
                type="search"
                defaultValue={applied.productSearch ?? ""}
                key={applied.productSearch ?? ""}
                placeholder="Producto: nombre o clave"
                maxLength={100}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="search"
              />
            </div>
          )}
          <div className="flex min-w-0 flex-[1_1_9rem] flex-col gap-1">
            <label htmlFor="desde" className="text-sm text-muted-foreground">
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
            <label htmlFor="hasta" className="text-sm text-muted-foreground">
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
            <FilterSelect
              id="tipo"
              name="tipo"
              label="Filtrar por tipo de movimiento"
              value={applied.type ?? ""}
              allLabel="Tipo"
              options={TYPE_OPTIONS}
            />
            {authors.length > 0 && (
              <FilterSelect
                id="persona"
                name="persona"
                label="Filtrar por persona"
                value={
                  authors.some((author) => author.userId === applied.userId)
                    ? (applied.userId ?? "")
                    : ""
                }
                allLabel="Persona"
                options={authors.map((author) => ({
                  id: author.userId,
                  name: author.name,
                }))}
              />
            )}
            <Button type="submit" variant="outline">
              <Filter aria-hidden="true" data-icon="inline-start" />
              Filtrar
            </Button>
          </div>
        </Form>
      )}
      {narrowed && (
        <p className="text-sm" role="status">
          {history.total === 0
            ? "Sin resultados"
            : history.total === 1
              ? "1 movimiento"
              : `${count(history.total)} movimientos`}
          {linkedProduct && (
            <>
              {" "}
              de <span className="font-medium">{linkedProduct}</span>
            </>
          )}
          {applied.productSearch && (
            <>
              {" "}
              con producto{" "}
              <span className="font-medium">«{applied.productSearch}»</span>
            </>
          )}
          .{" "}
          <Link
            href="/movimientos"
            className="inline-flex min-h-11 items-center rounded-lg font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Quitar filtros
          </Link>
        </p>
      )}
      {movements.length === 0 && narrowed ? (
        <EmptyState
          icon={Search}
          title="Ningún movimiento coincide"
          description="Prueba con otras fechas o quita algún filtro."
        />
      ) : movements.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="Sin movimientos registrados"
          description="Cada entrada, salida o reubicación aparecerá aquí con su autor y motivo."
          action={
            actions && <div className="flex flex-wrap gap-2">{actions}</div>
          }
        />
      ) : (
        <section
          aria-labelledby="ultimos-movimientos"
          className="rounded-xl border bg-card"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
            <h2 id="ultimos-movimientos" className="font-medium">
              {narrowed ? "Movimientos encontrados" : "Historial"}
            </h2>
            <p className="text-sm text-muted-foreground tabular-nums">
              {history.total === 1
                ? "1 movimiento"
                : `${count(first)}–${count(last)} de ${count(history.total)} movimientos`}
            </p>
          </div>
          <ul className="divide-y">
            {movements.map((movement) => (
              <li key={movement.id} className="space-y-2 p-4 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Badge variant="secondary">{movement.typeLabel}</Badge>
                  {movement.reversedByMovementId && (
                    <Badge variant="outline">Reversado</Badge>
                  )}
                  <p className="text-sm text-muted-foreground">
                    <time dateTime={movement.createdAt.toISOString()}>
                      {formatDateTime(movement.createdAt)}
                    </time>
                    {" · "}
                    {movement.authorName ??
                      "Alguien que ya no está en el equipo"}
                  </p>
                </div>
                <ul className="space-y-1">
                  {movement.lines.map((line, index) => (
                    <li key={index} className="flex items-start gap-2">
                      {line.direction === "IN" ? (
                        <ArrowDownToLine
                          aria-hidden="true"
                          className="mt-1 size-4 shrink-0 text-success"
                        />
                      ) : (
                        <ArrowUpFromLine
                          aria-hidden="true"
                          className="mt-1 size-4 shrink-0 text-muted-foreground"
                        />
                      )}
                      <p className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="sr-only">
                          {line.direction === "IN" ? "Entran" : "Salen"}{" "}
                        </span>
                        <span className="font-medium tabular-nums">
                          {line.quantity}
                        </span>{" "}
                        {line.captured && (
                          <span className="text-muted-foreground">
                            ({line.captured}){" "}
                          </span>
                        )}
                        de {line.productName}{" "}
                        <span className="text-muted-foreground">
                          ({line.sku}) · {line.location}
                        </span>
                      </p>
                    </li>
                  ))}
                </ul>
                {canReverse &&
                  movement.type !== "REVERSAL" &&
                  !movement.reversedByMovementId && (
                    <ReverseMovement
                      movementId={movement.id}
                      idempotencyKey={newId()}
                      description={`${movement.typeLabel} de ${movement.lines[0]?.quantity ?? ""} de ${movement.lines[0]?.productName ?? ""}`}
                    />
                  )}
                {(movement.reference || movement.reason) && (
                  <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                    {[
                      movement.reference && `Referencia: ${movement.reference}`,
                      movement.reason,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                )}
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
