import "server-only";

import { dec, newId } from "@/lib";
import {
  confirmReservation,
  consumeQuota,
  type QuotaClient,
} from "@/platform/entitlements";
import type { TenantDb } from "@/server";

import { defaultStep } from "./quantity";

/**
 * Products that arrive from a confirmed import (IMP-08). One product at a
 * time, inside the transaction of the batch that applies it: created when
 * its key is new, updated when it exists, brought back when it was
 * archived. The place of the plan a new or returning product needs comes
 * from what the import held when it was confirmed.
 *
 * No permission is checked here: the import was authorized when a person
 * confirmed it, and the batch runs later, in the background, in that
 * person's name.
 */

export type ImportedProduct = {
  sku: string;
  name: string;
  description: string | null;
  category: string | null;
  brand: string | null;
  barcode: string | null;
  unitCode: string;
  /** Presentation and its content, as fixed when the import was confirmed. */
  presentation: { name: string; content: string } | null;
};

export type ImportedProductResult =
  | {
      ok: true;
      productId: string;
      outcome: "created" | "updated" | "reactivated";
      /** A place the import was holding became this product's. */
      usedReservation: boolean;
      /** Presentation of the row, when it has one. */
      presentationId: string | null;
    }
  | { ok: false; error: string };

type Writer = QuotaClient &
  Pick<
    TenantDb,
    | "product"
    | "productCategory"
    | "productBrand"
    | "productPresentation"
    | "presentationVersion"
  >;

export async function applyImportedProduct(
  tx: Writer,
  actor: { organizationId: string; userId: string },
  input: ImportedProduct,
  options: {
    /** The import still holds places of the plan. */
    hasReservation: boolean;
  },
): Promise<ImportedProductResult> {
  const { organizationId, userId } = actor;
  const existing = await tx.product.findFirst({
    where: { sku: input.sku },
    select: { id: true, status: true, unitCode: true, barcode: true },
  });
  if (existing && existing.unitCode !== input.unitCode) {
    return {
      ok: false,
      error:
        "El producto ya existe con otra unidad; la unidad no se cambia al importar.",
    };
  }
  if (input.barcode && input.barcode !== existing?.barcode) {
    const owner = await tx.product.findFirst({
      where: { barcode: input.barcode },
      select: { id: true, sku: true },
    });
    if (owner && owner.id !== existing?.id) {
      return {
        ok: false,
        error: `El código de barras ya lo tiene el producto ${owner.sku}.`,
      };
    }
  }

  // A new or returning product takes a place: one the import holds, or —
  // if it holds none any more — a free one, like a manual product.
  let usedReservation = false;
  if (!existing || existing.status !== "ACTIVE") {
    if (
      options.hasReservation &&
      (await confirmReservation(tx, "active_products"))
    ) {
      usedReservation = true;
    } else {
      const quota = await consumeQuota(tx, organizationId, "active_products");
      if (!quota.ok) {
        return {
          ok: false,
          error: "Ya no hay lugar en tu plan para este producto.",
        };
      }
    }
  }

  const category = input.category
    ? await tx.productCategory.upsert({
        where: {
          organizationId_name: { organizationId, name: input.category },
        },
        update: {},
        create: { id: newId(), organizationId, name: input.category },
        select: { id: true },
      })
    : null;
  const brand = input.brand
    ? await tx.productBrand.upsert({
        where: { organizationId_name: { organizationId, name: input.brand } },
        update: {},
        create: { id: newId(), organizationId, name: input.brand },
        select: { id: true },
      })
    : null;

  let productId: string;
  let outcome: "created" | "updated" | "reactivated";
  if (!existing) {
    productId = newId();
    outcome = "created";
    await tx.product.create({
      data: {
        id: productId,
        organizationId,
        sku: input.sku,
        name: input.name,
        description: input.description,
        categoryId: category?.id ?? null,
        brandId: brand?.id ?? null,
        barcode: input.barcode,
        unitCode: input.unitCode,
        quantityStep: defaultStep(input.unitCode),
      },
    });
  } else {
    productId = existing.id;
    outcome = existing.status === "ACTIVE" ? "updated" : "reactivated";
    await tx.product.updateMany({
      where: { id: existing.id },
      data: {
        name: input.name,
        status: "ACTIVE",
        // An empty cell leaves what the product has: it erases nothing.
        ...(input.description !== null
          ? { description: input.description }
          : {}),
        ...(category ? { categoryId: category.id } : {}),
        ...(brand ? { brandId: brand.id } : {}),
        ...(input.barcode !== null ? { barcode: input.barcode } : {}),
      },
    });
  }

  let presentationId: string | null = null;
  if (input.presentation) {
    const current = await tx.productPresentation.findFirst({
      where: { productId, name: input.presentation.name },
      select: {
        id: true,
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, factor: true },
        },
      },
    });
    if (!current) {
      presentationId = newId();
      await tx.productPresentation.create({
        data: {
          id: presentationId,
          organizationId,
          productId,
          name: input.presentation.name,
        },
      });
    } else {
      presentationId = current.id;
    }
    const latest = current?.versions[0];
    // A different content is a new version: what moved before keeps its own.
    if (
      !latest ||
      !dec(latest.factor.toString()).equals(input.presentation.content)
    ) {
      await tx.presentationVersion.create({
        data: {
          id: newId(),
          organizationId,
          presentationId,
          version: (latest?.version ?? 0) + 1,
          factor: input.presentation.content,
          createdByUserId: userId,
        },
      });
    }
  }
  return { ok: true, productId, outcome, usedReservation, presentationId };
}
