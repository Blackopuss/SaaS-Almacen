import "server-only";

import { z } from "zod";

import { formatDecimal, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import type { CatalogActor } from "./products";
import { parseQuantity } from "./quantity";
import { getUnit } from "./units";

/**
 * Presentations of a product (INV-07): «Caja = 100 piezas», «Rollo = 100
 * metros». Each company defines them per product, always as a quantity of
 * the product's own unit, so stock is kept once, in that unit. The content
 * lives in versions: version 1 is written here.
 */

const nameSchema = z
  .string()
  .trim()
  .regex(
    /^[^\u0000-\u001f\u007f]*$/,
    "Quita los saltos de línea o tabuladores.",
  )
  .min(1, "Escribe el nombre de la presentación, por ejemplo Caja.")
  .max(40, "Máximo 40 caracteres.");

export type PresentationField = "name" | "factor";

export type PresentationResult =
  | { ok: true; presentationId: string }
  | {
      ok: false;
      reason: "invalid" | "duplicate" | "not_found" | "unchanged" | "conflict";
      fieldErrors: Partial<Record<PresentationField, string>>;
      formError?: string;
    };

class Rejected extends Error {
  constructor(readonly result: PresentationResult) {
    super("presentation rejected");
  }
}

const NOT_FOUND: PresentationResult = {
  ok: false,
  reason: "not_found",
  fieldErrors: {},
  formError: "Este producto ya no existe o está archivado.",
};

/**
 * Adds a presentation to a product: its name and how many units of the
 * product it contains. The content follows the product's own rule: whole
 * pieces, or meters in its increment.
 */
export async function createPresentation(
  actor: CatalogActor,
  productId: string,
  input: { name: string; factor: string },
): Promise<PresentationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.presentation.create",
  );
  const name = nameSchema.safeParse(input.name);

  const presentationId = newId();
  try {
    await forOrganization(organizationId).$transaction(async (tx) => {
      // The product is looked for only inside the company of the session.
      const product = await tx.product.findFirst({
        where: { id: String(productId), status: "ACTIVE" },
        select: { id: true, sku: true, unitCode: true, quantityStep: true },
      });
      if (!product) throw new Rejected(NOT_FOUND);

      const factor = parseQuantity(
        {
          unitCode: product.unitCode,
          quantityStep: product.quantityStep.toString(),
        },
        String(input.factor ?? ""),
      );
      const fieldErrors: Partial<Record<PresentationField, string>> = {};
      if (!name.success) fieldErrors.name = name.error.issues[0]!.message;
      if (!factor.ok) fieldErrors.factor = factor.error;
      if (!name.success || !factor.ok) {
        throw new Rejected({ ok: false, reason: "invalid", fieldErrors });
      }

      const same = await tx.productPresentation.findFirst({
        where: { productId: product.id, name: name.data },
        select: { id: true },
      });
      if (same) {
        throw new Rejected({
          ok: false,
          reason: "duplicate",
          fieldErrors: {
            name: "Este producto ya tiene una presentación con ese nombre.",
          },
        });
      }

      await tx.productPresentation.create({
        data: {
          id: presentationId,
          organizationId,
          productId: product.id,
          name: name.data,
        },
      });
      await tx.presentationVersion.create({
        data: {
          id: newId(),
          organizationId,
          presentationId,
          version: 1,
          factor: factor.quantity.toString(),
          createdByUserId: userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "presentation.created",
        target: { type: "product", id: product.id },
        metadata: {
          sku: product.sku,
          presentation: name.data,
          content: `${formatDecimal(factor.quantity)} ${getUnit(product.unitCode).plural}`,
        },
      });
    });
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // Two requests with the same name at once: the database kept one.
    if ((error as { code?: string }).code === "P2002") {
      return {
        ok: false,
        reason: "duplicate",
        fieldErrors: {
          name: "Este producto ya tiene una presentación con ese nombre.",
        },
      };
    }
    throw error;
  }
  return { ok: true, presentationId };
}

export type Presentation = {
  id: string;
  name: string;
  /** Units of the product in one presentation, in its current version. */
  factor: string;
  version: number;
  /** «Caja = 100 piezas». */
  label: string;
};

/** Presentations of a product with their current content, by name. */
export async function listPresentations(
  actor: CatalogActor,
  productId: string,
): Promise<Presentation[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.presentation.read",
  );
  const client = forOrganization(actor.organizationId);
  const product = await client.product.findFirst({
    where: { id: String(productId) },
    select: { id: true, unitCode: true },
  });
  if (!product) return [];
  const rows = await client.productPresentation.findMany({
    where: { productId: product.id },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, factor: true },
      },
    },
  });
  const unit = getUnit(product.unitCode);
  return rows
    .filter((row) => row.versions.length > 0)
    .map((row) => {
      const current = row.versions[0]!;
      const factor = current.factor.toString();
      return {
        id: row.id,
        name: row.name,
        factor,
        version: current.version,
        label: `${row.name} = ${formatDecimal(factor)} ${Number(factor) === 1 ? unit.name : unit.plural}`,
      };
    });
}

/**
 * Changes the content of a presentation (INV-08): «Caja» goes from 100 to
 * 120 piezas. Nothing is overwritten: a new version is added and becomes
 * the current one. Movements already recorded keep the version they used,
 * so their quantities and their reversals never change.
 */
export async function changePresentationFactor(
  actor: CatalogActor,
  presentationId: string,
  input: { factor: string; reason?: string },
): Promise<PresentationResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.presentation.update",
  );
  const id = String(presentationId);
  try {
    await forOrganization(organizationId).$transaction(async (tx) => {
      const presentation = await tx.productPresentation.findFirst({
        where: { id },
        select: {
          name: true,
          product: {
            select: {
              id: true,
              sku: true,
              status: true,
              unitCode: true,
              quantityStep: true,
            },
          },
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: { version: true, factor: true },
          },
        },
      });
      const current = presentation?.versions[0];
      if (
        !presentation ||
        !current ||
        presentation.product.status !== "ACTIVE"
      ) {
        throw new Rejected({
          ok: false,
          reason: "not_found",
          fieldErrors: {},
          formError:
            "Esta presentación ya no existe o su producto está archivado.",
        });
      }
      const { product } = presentation;
      const factor = parseQuantity(
        {
          unitCode: product.unitCode,
          quantityStep: product.quantityStep.toString(),
        },
        String(input.factor ?? ""),
      );
      if (!factor.ok) {
        throw new Rejected({
          ok: false,
          reason: "invalid",
          fieldErrors: { factor: factor.error },
        });
      }
      if (factor.quantity.equals(current.factor.toString())) {
        throw new Rejected({
          ok: false,
          reason: "unchanged",
          fieldErrors: { factor: "Ese ya es su contenido actual." },
        });
      }
      const unit = getUnit(product.unitCode);
      // (presentationId, version) is unique: of two simultaneous changes
      // only one becomes the next version.
      await tx.presentationVersion.create({
        data: {
          id: newId(),
          organizationId,
          presentationId: id,
          version: current.version + 1,
          factor: factor.quantity.toString(),
          createdByUserId: userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "presentation.updated",
        target: { type: "product", id: product.id },
        reason: input.reason,
        metadata: {
          sku: product.sku,
          presentation: presentation.name,
          version: current.version + 1,
          antes: `${formatDecimal(current.factor.toString())} ${unit.plural}`,
          ahora: `${formatDecimal(factor.quantity)} ${unit.plural}`,
        },
      });
    });
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    if ((error as { code?: string }).code === "P2002") {
      return {
        ok: false,
        reason: "conflict",
        fieldErrors: {},
        formError:
          "Alguien más acaba de cambiar esta presentación. Revisa su contenido actual.",
      };
    }
    throw error;
  }
  return { ok: true, presentationId: id };
}

export type PresentationVersionInfo = {
  version: number;
  factor: string;
  createdAt: Date;
  createdByUserId: string;
};

/** Every content a presentation has had, oldest first. */
export async function listPresentationVersions(
  actor: CatalogActor,
  presentationId: string,
): Promise<PresentationVersionInfo[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.presentation.read",
  );
  const rows = await forOrganization(
    actor.organizationId,
  ).presentationVersion.findMany({
    where: { presentationId: String(presentationId) },
    orderBy: { version: "asc" },
    select: {
      version: true,
      factor: true,
      createdAt: true,
      createdByUserId: true,
    },
  });
  return rows.map((row) => ({ ...row, factor: row.factor.toString() }));
}
