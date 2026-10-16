import "server-only";

import { forOrganization } from "@/server";

import { formatOrderNumber } from "./orders";

/**
 * What would be left halfway if Compras is taken away from a company
 * (CMP-17): drafts, orders waiting for goods and mails still on their way.
 * The platform console shows it before removing the module; nothing is
 * cancelled or closed — the orders stay as they are, readable, and go on
 * if the module comes back.
 *
 * Not a service a person calls: the console of the platform asks for it,
 * for any company, after checking that the caller is platform staff.
 */
export async function purchasingOpenWork(
  organizationId: string,
): Promise<string[]> {
  const client = forOrganization(organizationId);
  const open = await client.purchaseOrder.findMany({
    where: { status: { in: ["DRAFT", "SENT", "PARTIAL"] } },
    orderBy: { number: "asc" },
    take: 500,
    select: { number: true, status: true },
  });
  const numbers = (status: string) =>
    open
      .filter((order) => order.status === status)
      .map((order) => formatOrderNumber(order.number));
  const listed = (values: string[]) =>
    values.length <= 5
      ? values.join(", ")
      : `${values.slice(0, 5).join(", ")} y ${values.length - 5} más`;
  const lines: string[] = [];
  const sent = numbers("SENT");
  if (sent.length > 0) {
    lines.push(
      `${sent.length === 1 ? "1 orden enviada espera" : `${sent.length} órdenes enviadas esperan`} mercancía (${listed(sent)}): ya no se podrá recibir por Compras.`,
    );
  }
  const partial = numbers("PARTIAL");
  if (partial.length > 0) {
    lines.push(
      `${partial.length === 1 ? "1 orden recibida en parte" : `${partial.length} órdenes recibidas en parte`} (${listed(partial)}): lo que falta ya no se podrá recibir ni cerrar.`,
    );
  }
  const drafts = numbers("DRAFT");
  if (drafts.length > 0) {
    lines.push(
      `${drafts.length === 1 ? "1 borrador" : `${drafts.length} borradores`} (${listed(drafts)}) sin confirmar.`,
    );
  }
  const mails = await client.purchaseOrderDelivery.count({
    where: { status: "QUEUED" },
  });
  if (mails > 0) {
    lines.push(
      `${mails === 1 ? "1 envío por correo" : `${mails} envíos por correo`} en camino: no saldrá${mails === 1 ? "" : "n"}.`,
    );
  }
  return lines;
}
