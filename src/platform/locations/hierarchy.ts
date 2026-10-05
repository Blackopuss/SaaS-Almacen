import "server-only";

import { z } from "zod";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization, type TenantDb } from "@/server";

import {
  LOCATION_KIND_LABELS,
  canContain,
  compareLocationNames,
  formatLocationPath,
  isLocationKind,
  type AnyLocationKind,
} from "./kinds";
import type { LocationActor } from "./locations";

/**
 * Zones, aisles and shelves of the facility (INV-14). The business names
 * them; the kind fixes where each one can go (see ./kinds), so the tree
 * never has a cycle. Nothing is deleted: a location is archived.
 *
 * Every change locks the facility first, so two people reorganizing at
 * once are applied one after the other and each one sees the other's
 * result. The database repeats the rules it can (keys, CHECK, triggers).
 */

/** Locations a company may have, archived included: the tree is shown whole. */
export const MAX_LOCATIONS = 1_000;

const nameSchema = z
  .string()
  .trim()
  .regex(
    /^[^\u0000-\u001f\u007f]*$/,
    "Quita los saltos de línea o tabuladores.",
  )
  .min(1, "Escribe el nombre de la ubicación.")
  .max(60, "El nombre es demasiado largo (máximo 60 caracteres).");

export type LocationField = "name" | "kind" | "parentId";

export type LocationResult =
  | { ok: true; locationId: string }
  | {
      ok: false;
      reason:
        | "invalid"
        | "duplicate"
        | "not_found"
        | "not_allowed"
        | "limit_reached"
        | "unchanged";
      fieldErrors: Partial<Record<LocationField, string>>;
      formError?: string;
    };

type Failure = Extract<LocationResult, { ok: false }>;

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("location rejected");
  }
}

const reject = (
  reason: Failure["reason"],
  error: string,
  field?: LocationField,
): never => {
  throw new Rejected({
    ok: false,
    reason,
    fieldErrors: field ? { [field]: error } : {},
    formError: field ? undefined : error,
  });
};

type Tx = Pick<TenantDb, "facility" | "location" | "auditEvent">;

type Row = {
  id: string;
  name: string;
  kind: AnyLocationKind;
  parentId: string | null;
  isDefault: boolean | null;
  archivedAt: Date | null;
};

const ROW = {
  id: true,
  name: true,
  kind: true,
  parentId: true,
  isDefault: true,
  archivedAt: true,
} as const;

/**
 * Runs a change to the tree with the facility locked. Touching its row is
 * the lock: the scoped client has no raw SQL, and an update keeps the row
 * until the transaction ends.
 */
async function changeTree(
  organizationId: string,
  change: (tx: Tx, facilityId: string) => Promise<string>,
): Promise<LocationResult> {
  try {
    const locationId = await forOrganization(organizationId).$transaction(
      async (tx) => {
        await tx.facility.updateMany({
          where: {},
          data: { updatedAt: new Date() },
        });
        const facility = await tx.facility.findFirst({ select: { id: true } });
        if (!facility) {
          throw new Error(`Company ${organizationId} has no facility`);
        }
        return change(tx, facility.id);
      },
    );
    return { ok: true, locationId };
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

const GONE = "Esta ubicación ya no existe.";

async function findLocation(tx: Tx, id: string): Promise<Row> {
  const row = await tx.location.findFirst({
    where: { id: String(id) },
    select: ROW,
  });
  return row ?? reject("not_found", GONE);
}

/** The location others will go into; `null` = directly in the facility. */
async function findParent(tx: Tx, parentId: string | null) {
  if (parentId === null) return null;
  const parent = await tx.location.findFirst({
    where: { id: parentId },
    select: ROW,
  });
  if (!parent) {
    return reject(
      "not_found",
      "La ubicación que elegiste ya no existe.",
      "parentId",
    );
  }
  if (parent.archivedAt) {
    return reject(
      "not_allowed",
      `«${parent.name}» está archivada. Reactívala o elige otra.`,
      "parentId",
    );
  }
  return parent;
}

/** Explains why `kind` cannot go inside `parent`, or nothing when it can. */
function checkFit(
  kind: AnyLocationKind,
  parent: Row | null,
  field: LocationField,
) {
  if (parent === null || canContain(parent.kind, kind)) return;
  const child = LOCATION_KIND_LABELS[kind].toLowerCase();
  const holder = LOCATION_KIND_LABELS[parent.kind].toLowerCase();
  const a = (noun: string) => (noun === "zona" ? "una zona" : `un ${noun}`);
  const the = (noun: string) => (noun === "zona" ? "la zona" : `el ${noun}`);
  const other = (noun: string) =>
    noun === "zona" ? "otra zona" : `otro ${noun}`;
  const capital = (text: string) => text[0]?.toUpperCase() + text.slice(1);
  reject(
    "not_allowed",
    parent.kind === "GENERAL"
      ? "«General» no contiene otras ubicaciones."
      : parent.kind === "SHELF"
        ? "Un estante no contiene otras ubicaciones."
        : parent.kind === kind
          ? `${capital(a(child))} no puede ir dentro de ${other(holder)}.`
          : `${capital(a(child))} no puede ir dentro de ${a(holder)}: ${the(holder)} va dentro de ${the(child)}.`,
    field,
  );
}

async function checkFreeName(
  tx: Tx,
  name: string,
  parentId: string | null,
  exceptId?: string,
) {
  const taken = await tx.location.findFirst({
    where: { parentId, name, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { archivedAt: true },
  });
  if (!taken) return;
  reject(
    "duplicate",
    taken.archivedAt
      ? "Ya hay una ubicación archivada con ese nombre en el mismo lugar. Reactívala o usa otro nombre."
      : "Ya hay una ubicación con ese nombre en el mismo lugar. Usa otro nombre.",
    "name",
  );
}

/** Names from the root down to the location. */
async function pathOf(tx: Tx, row: Row): Promise<string> {
  const names = [row.name];
  let parentId = row.parentId;
  // Kinds bound the depth; the counter only guards against bad data.
  for (let level = 0; parentId && level < 8; level++) {
    const parent = await tx.location.findFirst({
      where: { id: parentId },
      select: { name: true, parentId: true },
    });
    if (!parent) break;
    names.unshift(parent.name);
    parentId = parent.parentId;
  }
  return formatLocationPath(names);
}

function parseName(value: unknown): string {
  const parsed = nameSchema.safeParse(typeof value === "string" ? value : "");
  if (parsed.success) return parsed.data;
  return reject(
    "invalid",
    parsed.error.issues[0]?.message ?? "Nombre inválido.",
    "name",
  );
}

const parentIdOf = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== ""
    ? value.trim().slice(0, 36)
    : null;

const GENERAL_FIXED =
  "«General» es la ubicación inicial de tu inventario: no se renombra, no se mueve y no se archiva.";

/** Creates a zone, aisle or shelf, inside another location or in the facility. */
export async function createLocation(
  actor: LocationActor,
  input: { name?: unknown; kind?: unknown; parentId?: unknown },
): Promise<LocationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.location.create",
  );
  return changeTree(organizationId, async (tx, facilityId) => {
    const name = parseName(input.name);
    const kind = isLocationKind(input.kind)
      ? input.kind
      : reject("invalid", "Elige si es zona, pasillo o estante.", "kind");
    const parent = await findParent(tx, parentIdOf(input.parentId));
    checkFit(kind, parent, "kind");
    await checkFreeName(tx, name, parent?.id ?? null);
    if ((await tx.location.count()) >= MAX_LOCATIONS) {
      reject(
        "limit_reached",
        `Llegaste al máximo de ${MAX_LOCATIONS.toLocaleString("es-MX")} ubicaciones.`,
      );
    }
    const id = newId();
    await tx.location.create({
      data: {
        id,
        organizationId,
        facilityId,
        name,
        kind,
        parentId: parent?.id ?? null,
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "location.created",
      target: { type: "location", id },
      metadata: {
        name,
        kind,
        path: await pathOf(tx, {
          id,
          name,
          kind,
          parentId: parent?.id ?? null,
          isDefault: null,
          archivedAt: null,
        }),
      },
    });
    return id;
  });
}

/** Changes the name of a location; where it is and its kind stay. */
export async function renameLocation(
  actor: LocationActor,
  locationId: string,
  input: { name?: unknown },
): Promise<LocationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.location.update",
  );
  return changeTree(organizationId, async (tx) => {
    const location = await findLocation(tx, locationId);
    if (location.isDefault) reject("not_allowed", GENERAL_FIXED);
    const name = parseName(input.name);
    if (name === location.name) {
      reject("unchanged", "Ese ya es su nombre.", "name");
    }
    await checkFreeName(tx, name, location.parentId, location.id);
    await tx.location.updateMany({
      where: { id: location.id },
      data: { name },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "location.renamed",
      target: { type: "location", id: location.id },
      metadata: { before: location.name, after: name },
    });
    return location.id;
  });
}

/** Moves a location, with everything inside it, into another one or to the facility. */
export async function moveLocation(
  actor: LocationActor,
  locationId: string,
  input: { parentId?: unknown },
): Promise<LocationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.location.update",
  );
  return changeTree(organizationId, async (tx) => {
    const location = await findLocation(tx, locationId);
    if (location.isDefault) reject("not_allowed", GENERAL_FIXED);
    if (location.archivedAt) {
      reject("not_allowed", "Reactiva la ubicación antes de moverla.");
    }
    const parentId = parentIdOf(input.parentId);
    if (parentId === location.id) {
      reject(
        "not_allowed",
        "Una ubicación no puede ir dentro de sí misma.",
        "parentId",
      );
    }
    const parent = await findParent(tx, parentId);
    if ((parent?.id ?? null) === location.parentId) {
      reject("unchanged", "La ubicación ya está ahí.", "parentId");
    }
    // The kinds make a cycle impossible: what is inside this location is
    // finer than it, and it only goes into something coarser.
    checkFit(location.kind, parent, "parentId");
    await checkFreeName(tx, location.name, parent?.id ?? null, location.id);
    const before = await pathOf(tx, location);
    await tx.location.updateMany({
      where: { id: location.id },
      data: { parentId: parent?.id ?? null },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "location.moved",
      target: { type: "location", id: location.id },
      metadata: {
        before,
        after: await pathOf(tx, { ...location, parentId: parent?.id ?? null }),
      },
    });
    return location.id;
  });
}

/**
 * Archives an empty location: it leaves the lists but stays in the history.
 * What it contains must be archived or moved out first. From INV-15 on, a
 * location with stock will not be archived either (NEG-21).
 */
export async function archiveLocation(
  actor: LocationActor,
  locationId: string,
): Promise<LocationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.location.archive",
  );
  return changeTree(organizationId, async (tx) => {
    const location = await findLocation(tx, locationId);
    if (location.isDefault) reject("not_allowed", GENERAL_FIXED);
    if (location.archivedAt) {
      reject("unchanged", "Esta ubicación ya está archivada.");
    }
    const inside = await tx.location.count({
      where: { parentId: location.id, archivedAt: null },
    });
    if (inside > 0) {
      reject(
        "not_allowed",
        inside === 1
          ? "Tiene una ubicación dentro. Archívala o muévela primero."
          : `Tiene ${inside} ubicaciones dentro. Archívalas o muévelas primero.`,
      );
    }
    await tx.location.updateMany({
      where: { id: location.id },
      data: { archivedAt: new Date() },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "location.archived",
      target: { type: "location", id: location.id },
      metadata: { path: await pathOf(tx, location) },
    });
    return location.id;
  });
}

/** Brings an archived location back to where it was. */
export async function restoreLocation(
  actor: LocationActor,
  locationId: string,
): Promise<LocationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.location.archive",
  );
  return changeTree(organizationId, async (tx) => {
    const location = await findLocation(tx, locationId);
    if (!location.archivedAt) {
      reject("unchanged", "Esta ubicación ya está activa.");
    }
    if (location.parentId) {
      const parent = await findLocation(tx, location.parentId);
      if (parent.archivedAt) {
        reject(
          "not_allowed",
          `Está dentro de «${parent.name}», que sigue archivada. Reactiva esa primero.`,
        );
      }
    }
    await tx.location.updateMany({
      where: { id: location.id },
      data: { archivedAt: null },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "location.restored",
      target: { type: "location", id: location.id },
      metadata: { path: await pathOf(tx, location) },
    });
    return location.id;
  });
}

export type LocationNode = {
  id: string;
  name: string;
  kind: AnyLocationKind;
  parentId: string | null;
  /** General: the default location, fixed. */
  isDefault: boolean;
  archived: boolean;
  /** 0 = directly in the facility. */
  depth: number;
  /** «Zona A › Pasillo 2 › Estante 3», the location included. */
  path: string;
  /** Locations directly inside, among the ones listed. */
  children: number;
};

export type LocationTree = {
  facility: { id: string; name: string };
  /** In reading order: General first, then each branch with what it holds. */
  locations: LocationNode[];
};

/** The whole tree of the facility, ready to show or to offer in a select. */
export async function listLocations(
  actor: LocationActor,
  options: { includeArchived?: boolean } = {},
): Promise<LocationTree | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.location.read",
  );
  const client = forOrganization(actor.organizationId);
  const [facility, rows] = await Promise.all([
    client.facility.findFirst({ select: { id: true, name: true } }),
    client.location.findMany({
      where: options.includeArchived ? {} : { archivedAt: null },
      take: MAX_LOCATIONS,
      select: ROW,
    }),
  ]);
  if (!facility) return null;

  const byParent = new Map<string | null, Row[]>();
  for (const row of rows) {
    const siblings = byParent.get(row.parentId) ?? [];
    siblings.push(row);
    byParent.set(row.parentId, siblings);
  }
  const locations: LocationNode[] = [];
  const walk = (parentId: string | null, names: string[], depth: number) => {
    const siblings = (byParent.get(parentId) ?? []).sort(
      (a, b) =>
        Number(b.isDefault === true) - Number(a.isDefault === true) ||
        compareLocationNames(a.name, b.name),
    );
    for (const row of siblings) {
      const path = [...names, row.name];
      locations.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        parentId: row.parentId,
        isDefault: row.isDefault === true,
        archived: row.archivedAt !== null,
        depth,
        path: formatLocationPath(path),
        children: byParent.get(row.id)?.length ?? 0,
      });
      // Kinds bound the depth; the limit only guards against bad data.
      if (depth < 8) walk(row.id, path, depth + 1);
    }
  };
  walk(null, [], 0);
  return { facility, locations };
}
