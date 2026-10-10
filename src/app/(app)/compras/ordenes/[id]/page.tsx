import { ChevronLeft, Pencil, Plus } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib";
import { getPurchaseOrder } from "@/modules/purchasing";
import { getModuleAccess } from "@/platform/billing";

import { RemoveLine } from "./remove-line";

export const metadata: Metadata = { title: "Orden de compra" };

const textLink =
  "rounded text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * A purchase order with its lines (CMP-04). Each line shows what was
 * asked for and what it amounts to in the product's unit; costs and the
 * total appear only for who may see them.
 */
export default async function OrdenPage({
  params,
}: PageProps<"/compras/ordenes/[id]">) {
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
  if (!access.can("purchasing.order.read")) {
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
  const { id } = await params;
  const order = await getPurchaseOrder(
    { organizationId: access.organization.id, userId: access.user.id },
    id,
  );
  if (!order) notFound();
  const canEdit =
    order.editable &&
    moduleState === "active" &&
    access.allows("purchasing.order.update");
  const addHref = `/compras/ordenes/${order.id}/linea`;
  const expected = order.expectedOn
    ? formatDate(new Date(`${order.expectedOn}T12:00:00.000Z`), "UTC")
    : null;

  return (
    <PageContainer>
      {back}
      {moduleState === "read_only" && <ReadOnlyNotice module="Compras" />}
      <PageHeader
        title={`Orden ${order.numberText}`}
        description={order.supplierName}
        actions={
          canEdit ? (
            <Button asChild variant="outline">
              <Link href={`/compras/ordenes/${order.id}/editar`}>
                <Pencil aria-hidden="true" data-icon="inline-start" />
                Editar datos
              </Link>
            </Button>
          ) : undefined
        }
      />

      <section
        aria-label="Datos de la orden"
        className="max-w-3xl rounded-xl border bg-card"
      >
        <dl className="divide-y">
          {(
            [
              [
                "Estado",
                <Badge
                  key="status"
                  variant={order.status === "DRAFT" ? "secondary" : "default"}
                >
                  {order.statusLabel}
                </Badge>,
              ],
              [
                "Proveedor",
                access.can("purchasing.supplier.read") ? (
                  <Link
                    key="supplier"
                    href={`/compras/proveedores/${order.supplierId}`}
                    className={textLink}
                  >
                    {order.supplierName}
                  </Link>
                ) : (
                  order.supplierName
                ),
              ],
              ["Se espera", expected ?? "—"],
              ["Notas", order.notes ?? "—"],
              [
                "Empezada",
                formatDate(order.createdAt, access.organization.timeZone),
              ],
            ] as const
          ).map(([term, value]) => (
            <div
              key={term}
              className="grid gap-1 p-4 sm:grid-cols-[10rem_1fr] sm:gap-4 sm:px-5"
            >
              <dt className="text-sm text-muted-foreground">{term}</dt>
              <dd className="[overflow-wrap:anywhere] whitespace-pre-line">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section
        aria-labelledby="lineas-orden"
        className="max-w-3xl rounded-xl border bg-card"
      >
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-2 sm:px-5">
          <h2 id="lineas-orden" className="font-medium">
            Productos
            {order.lines.length > 0 && (
              <span className="font-normal text-muted-foreground tabular-nums">
                {" "}
                · {order.lines.length}
              </span>
            )}
          </h2>
          {canEdit && (
            <Button asChild>
              <Link href={addHref}>
                <Plus aria-hidden="true" data-icon="inline-start" />
                Agregar producto
              </Link>
            </Button>
          )}
        </div>
        {order.lines.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground sm:px-5">
            {canEdit
              ? "Esta orden todavía no pide nada. Agrega el primer producto."
              : "Esta orden no tiene productos."}
          </p>
        ) : (
          <ol className="divide-y">
            {order.lines.map((line) => (
              <li
                key={line.id}
                className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 p-4 sm:px-5"
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium [overflow-wrap:anywhere]">
                    <span className="font-normal text-muted-foreground tabular-nums">
                      {line.lineNumber}.{" "}
                    </span>
                    {line.productName}
                    <span className="font-normal text-muted-foreground">
                      {" "}
                      · {line.sku}
                      {line.supplierSku && ` · su código: ${line.supplierSku}`}
                    </span>
                  </p>
                  {/* What was asked and what it amounts to, always visible. */}
                  <p className="tabular-nums">{line.quantityText}</p>
                  {order.costsVisible && (
                    <p className="text-sm tabular-nums">
                      {line.unitCostText ? (
                        <>
                          {line.unitCostText}{" "}
                          <span className="font-medium">
                            = {line.amountText}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">Sin costo</span>
                      )}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex flex-wrap gap-1">
                    <Button asChild variant="ghost">
                      <Link
                        href={`${addHref}?linea=${line.id}`}
                        aria-label={`Editar ${line.productName} en la orden`}
                      >
                        <Pencil aria-hidden="true" data-icon="inline-start" />
                        Editar
                      </Link>
                    </Button>
                    <RemoveLine
                      orderId={order.id}
                      lineId={line.id}
                      productName={line.productName}
                    />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        {order.costsVisible && order.lines.length > 0 && (
          <p className="flex flex-wrap items-baseline justify-between gap-x-4 border-t p-4 sm:px-5">
            <span className="text-sm text-muted-foreground">
              Total antes de impuestos
              {(order.linesWithoutCost ?? 0) > 0 &&
                ` (${order.linesWithoutCost === 1 ? "falta el costo de 1 producto" : `falta el costo de ${order.linesWithoutCost} productos`})`}
            </span>
            <span className="text-lg font-semibold tabular-nums">
              {order.totalText ?? "—"}
            </span>
          </p>
        )}
      </section>
      {order.editable && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          Es un borrador: puedes cambiarlo las veces que haga falta. Enviarlo al
          proveedor y recibirlo llegan en los siguientes pasos.
        </p>
      )}
    </PageContainer>
  );
}
