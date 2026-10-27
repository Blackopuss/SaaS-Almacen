import "server-only";

import { db, forOrganization } from "@/server";

import { listAuditEvents } from "./events";

/**
 * Company audit trail for people (USR-11): each event with a sentence in
 * Spanish, who did it and to whom. Names are read at display time; the
 * event itself keeps only ids, so the record never changes.
 */

/** What each company action means, as shown in the audit screen. */
export const AUDIT_ACTION_LABELS: Record<string, string> = {
  "organization.created": "Creó la empresa",
  "ownership.transfer_offered": "Ofreció transferir la titularidad",
  "ownership.transfer_cancelled": "Canceló la transferencia de titularidad",
  "ownership.transferred": "Aceptó la titularidad de la empresa",
  "inventory.adjusted": "Ajustó existencias",
  "inventory.count_applied": "Aplicó un conteo físico",
  "inventory.import_confirmed": "Confirmó una importación de productos",
  "inventory.import_applied": "Se aplicó una importación de productos",
  "inventory.import_cancelled": "Canceló una importación de productos",
  "inventory.exit_import_confirmed": "Confirmó una importación de salidas",
  "inventory.exit_import_applied": "Se registraron las salidas de un archivo",
  "inventory.exit_import_cancelled": "Canceló una importación de salidas",
  "inventory.exit_import_failed":
    "Una importación de salidas se detuvo antes de terminar",
  "inventory.import_failed":
    "Una importación de productos se detuvo antes de terminar",
  "inventory.export_created": "Exportó información a un archivo",
  "inventory.reversed": "Reversó un movimiento",
  "product_supplier.created": "Vinculó un producto con un proveedor",
  "product_supplier.updated":
    "Cambió el vínculo de un producto con un proveedor",
  "purchase_order.created": "Empezó una orden de compra",
  "purchase_order.sent": "Confirmó una orden de compra como enviada",
  "purchase_order.cancelled": "Canceló una orden de compra",
  "purchase_order.closed": "Cerró una orden de compra con faltante",
  "purchase_order.exported": "Descargó el PDF de una orden de compra",
  "purchase_order.received": "Recibió mercancía de una orden de compra",
  "purchase_order.returned": "Devolvió mercancía al proveedor",
  "purchasing.report_exported": "Exportó un reporte de compras a un archivo",
  "sales.prices_changed": "Cambió precios de venta",
  "purchase_order.delivery_requested":
    "Pidió enviar una orden de compra por correo",
  "purchase_order.delivered": "Se envió una orden de compra por correo",
  "purchase_order.delivery_failed":
    "No se pudo enviar una orden de compra por correo",
  "supplier.created": "Agregó un proveedor",
  "supplier.updated": "Cambió los datos de un proveedor",
  "product.created": "Creó un producto",
  "product.updated": "Cambió la ficha de un producto",
  "presentation.created": "Agregó una presentación a un producto",
  "presentation.updated": "Cambió el contenido de una presentación",
  "product.archived": "Archivó un producto",
  "product.reactivated": "Reactivó un producto",
  "location.created": "Creó una ubicación",
  "location.renamed": "Cambió el nombre de una ubicación",
  "location.moved": "Movió una ubicación",
  "location.archived": "Archivó una ubicación",
  "location.restored": "Reactivó una ubicación",
  "plan.provisioned": "Se asignó el plan de la empresa",
  "payment.recorded": "Se registró un pago",
  "plan.purchased": "Compró el plan en línea",
  "payment.reversed": "Se anuló un pago",
  "support.granted": "Permitió el acceso de soporte",
  "support.revoked": "Quitó el acceso de soporte",
  "support.entered": "Soporte entró a la empresa (solo lectura)",
  "support.left": "Soporte salió de la empresa",
  "module.activated": "Se activó un módulo",
  "module.deactivated": "Se desactivó un módulo",
  "team.invitation_created": "Invitó a una persona",
  "team.invitation_resent": "Reenvió una invitación",
  "team.invitation_cancelled": "Canceló una invitación",
  "team.invitation_accepted": "Aceptó la invitación y entró al equipo",
  "team.roles_changed": "Cambió los roles de una persona",
  "team.member_disabled": "Desactivó a una persona",
  "team.member_reactivated": "Reactivó a una persona",
};

export function describeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export type AuditTrailEntry = {
  id: string;
  action: string;
  label: string;
  /** Null when the system made the change or the account no longer exists. */
  actorName: string | null;
  /** Person the change was about, when there is one. */
  targetName: string | null;
  /** Invited address, for invitation events. */
  email: string | null;
  /** Role ids involved: previous and resulting, or the invited ones. */
  rolesFrom: string[];
  rolesTo: string[];
  reason: string | null;
  /**
   * What the event was about, from its metadata: «Clave: TOR-001»,
   * «Archivo: catalogo.xlsx», «Precio: 10 → 12». Only known keys, in a
   * fixed order; internal ids and codes are never shown.
   */
  facts: string[];
  createdAt: Date;
};

/** Metadata keys shown in the audit screen, with their label, in order. */
const FACT_LABELS: readonly (readonly [string, string])[] = [
  ["orden", "Orden"],
  ["proveedor", "Proveedor"],
  ["correo", "Correo"],
  ["sku", "Clave"],
  ["producto", "Producto"],
  ["name", "Nombre"],
  ["nombre", "Nombre"],
  ["presentation", "Presentación"],
  ["content", "Contenido"],
  ["path", "Ruta"],
  ["before", "Antes"],
  ["after", "Ahora"],
  ["module", "Módulo"],
  ["modules", "Módulos"],
  ["productLimit", "Cupo de productos"],
  ["users", "Personas"],
  ["ubicacion", "Ubicación"],
  ["antes", "Había"],
  ["contado", "Contado"],
  ["diferencia", "Diferencia"],
  ["productosContados", "Productos contados"],
  ["productosAjustados", "Productos ajustados"],
  ["contenido", "Contenido"],
  ["formato", "Formato"],
  ["desde", "Desde"],
  ["hasta", "Hasta"],
  ["archivo", "Archivo"],
  ["filas", "Filas"],
  ["nuevos", "Nuevos"],
  ["actualizados", "Actualizados"],
  ["reactivados", "Reactivados"],
  ["productos", "Productos"],
  ["productosImportados", "Productos importados"],
  ["sinImportar", "Sin importar"],
  ["salidasRegistradas", "Salidas registradas"],
  ["yaImportadas", "Ya importadas antes"],
  ["conProblemas", "Con problemas"],
  ["lugaresApartados", "Lugares apartados del plan"],
  ["lugaresDevueltos", "Lugares devueltos al plan"],
  ["cambios", "Cambió"],
];

const shown = (value: unknown): string | null =>
  typeof value === "string"
    ? value.trim() || null
    : typeof value === "number" && Number.isFinite(value)
      ? value.toLocaleString("es-MX")
      : Array.isArray(value)
        ? strings(value).join(", ") || null
        : null;

/** The metadata of an event as short lines for people. */
export function describeAuditFacts(metadata: unknown): string[] {
  const data = record(metadata);
  const facts: string[] = [];
  for (const [key, label] of FACT_LABELS) {
    const value = shown(data[key]);
    if (value !== null) facts.push(`${label}: ${value}`);
  }
  // Field by field changes of a record: { Nombre: { antes, ahora } }.
  for (const [field, change] of Object.entries(record(data.changes))) {
    const { antes, ahora } = record(change);
    facts.push(
      `${field}: ${shown(antes) ?? "(vacío)"} → ${shown(ahora) ?? "(vacío)"}`,
    );
  }
  return facts;
}

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/** Newest events of the company first, ready to show. */
export async function listAuditTrail(
  organizationId: string,
  options: { limit?: number; before?: Date } = {},
): Promise<AuditTrailEntry[]> {
  const events = await listAuditEvents(
    forOrganization(organizationId),
    options,
  );
  const invitationIds = events
    .filter((e) => e.targetType === "invitation" && e.targetId)
    .map((e) => e.targetId!);
  const userIds = new Set<string>();
  for (const event of events) {
    if (event.actorUserId) userIds.add(event.actorUserId);
    if (event.targetType === "user" && event.targetId) {
      userIds.add(event.targetId);
    }
  }
  const [users, invitations] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true },
    }),
    forOrganization(organizationId).invitation.findMany({
      where: { id: { in: invitationIds } },
      select: { id: true, email: true, roles: true },
    }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const invited = new Map(invitations.map((i) => [i.id, i]));

  return events.map((event) => {
    const metadata = record(event.metadata);
    const invitation =
      event.targetType === "invitation" && event.targetId
        ? invited.get(event.targetId)
        : undefined;
    const rolesTo = strings(
      metadata.to ??
        metadata.roles ??
        metadata.previousOwnerRoles ??
        invitation?.roles,
    );
    return {
      id: event.id,
      action: event.action,
      label: describeAuditAction(event.action),
      actorName: event.actorUserId
        ? (names.get(event.actorUserId) ?? null)
        : null,
      targetName:
        event.targetType === "user" && event.targetId
          ? (names.get(event.targetId) ?? null)
          : null,
      email:
        typeof metadata.email === "string"
          ? metadata.email
          : (invitation?.email ?? null),
      rolesFrom: strings(metadata.from),
      rolesTo,
      reason: event.reason,
      facts: describeAuditFacts(metadata),
      createdAt: event.createdAt,
    };
  });
}
