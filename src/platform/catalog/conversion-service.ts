import "server-only";

import { assertModulePermission } from "@/platform/billing";
import { forOrganization, type TenantDb } from "@/server";

import {
  convertCapture,
  type Capture,
  type Conversion,
  type ResolvedPresentation,
} from "./conversion";
import type { CatalogActor } from "./products";

/**
 * Server side of the conversion (INV-09): loads the product and the
 * current version of the presentation from the company's data and converts
 * the capture. The browser sends what was typed and which presentation;
 * the factor is always resolved here.
 */

export type ResolvedConversion =
  | {
      ok: true;
      conversion: Conversion;
      product: { id: string; unitCode: string; quantityStep: string };
    }
  | { ok: false; error: string };

/** A company client or one of its transactions. */
type CatalogReader = Pick<TenantDb, "product" | "productPresentation">;

/**
 * Converts a capture for a product using the given client, so a movement
 * can resolve the factor inside its own transaction (INV-15). No
 * permission check: callers have already authorized the operation.
 */
export async function resolveConversion(
  client: CatalogReader,
  productId: string,
  capture: Capture,
): Promise<ResolvedConversion> {
  const product = await client.product.findFirst({
    where: { id: String(productId), status: "ACTIVE" },
    select: { id: true, unitCode: true, quantityStep: true },
  });
  if (!product) {
    return { ok: false, error: "Este producto ya no existe o está archivado." };
  }
  const rule = {
    unitCode: product.unitCode,
    quantityStep: product.quantityStep.toString(),
  };

  let presentation: ResolvedPresentation | null = null;
  if (capture.kind === "presentation") {
    // Only presentations of this product, in this company.
    const row = await client.productPresentation.findFirst({
      where: { id: String(capture.presentationId), productId: product.id },
      select: {
        id: true,
        name: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { id: true, version: true, factor: true },
        },
      },
    });
    const current = row?.versions[0];
    if (row && current) {
      presentation = {
        id: row.id,
        name: row.name,
        versionId: current.id,
        version: current.version,
        factor: current.factor.toString(),
      };
    }
  }

  const result = convertCapture(
    rule,
    {
      ...capture,
      quantity: String(capture.quantity ?? ""),
    } as Capture,
    presentation,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    conversion: result.conversion,
    product: { id: product.id, ...rule },
  };
}

export type ConversionPreview =
  | {
      ok: true;
      /** «3 cajas × 100 = 300 piezas». */
      preview: string;
      baseQuantity: string;
      unitCode: string;
    }
  | { ok: false; error: string };

/** Preview shown before confirming a movement. */
export async function previewConversion(
  actor: CatalogActor,
  productId: string,
  capture: Capture,
): Promise<ConversionPreview> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.presentation.read",
  );
  const result = await resolveConversion(
    forOrganization(actor.organizationId),
    productId,
    capture,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    preview: result.conversion.preview,
    baseQuantity: result.conversion.baseQuantity.toString(),
    unitCode: result.product.unitCode,
  };
}
