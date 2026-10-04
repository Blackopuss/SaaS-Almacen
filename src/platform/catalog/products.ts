import "server-only";

import { z } from "zod";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { consumeQuota } from "@/platform/entitlements";
import { forOrganization } from "@/server";

/**
 * Products of the catalog (INV-02). Every new product goes through
 * `createProduct`: it checks the role and the contracted module, takes one
 * place of the plan's quota and writes the product in the same transaction.
 * If anything fails, the place is not consumed. No other code creates
 * products (a test fails if `product.create` appears elsewhere).
 */

const text = (max: number) =>
  z
    .string()
    .trim()
    // Control characters (tabs, line breaks from a pasted cell) are never
    // part of a code or a name.
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .max(max, `Máximo ${max} caracteres.`);

const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((value) => (value ? value : null));

export const productSchema = z.object({
  sku: text(64).min(1, "Escribe la clave del producto (SKU)."),
  name: text(160).min(2, "Escribe el nombre del producto (mínimo 2 letras)."),
  description: z
    .string()
    .trim()
    .max(2000, "La descripción es demasiado larga (máximo 2,000 caracteres).")
    .optional()
    .transform((value) => (value ? value : null)),
  /** Name of the category; created if the company does not have it yet. */
  category: optionalText(80),
  /** Name of the brand; created if the company does not have it yet. */
  brand: optionalText(80),
  barcode: optionalText(64),
});

export type ProductInput = z.input<typeof productSchema>;
export type ProductField = keyof ProductInput;

export type CreateProductResult =
  | { ok: true; productId: string }
  | {
      ok: false;
      reason: "invalid" | "duplicate" | "limit_reached";
      fieldErrors: Partial<Record<ProductField, string>>;
      formError?: string;
    };

/** Who is acting; always taken from the session, never from the form. */
export type CatalogActor = { organizationId: string; userId: string };

/** Carries an expected failure out of the transaction so it rolls back. */
class Rejected extends Error {
  constructor(readonly result: CreateProductResult) {
    super("product rejected");
  }
}

const duplicate = (field: "sku" | "barcode"): CreateProductResult => ({
  ok: false,
  reason: "duplicate",
  fieldErrors: {
    [field]:
      field === "sku"
        ? "Ya tienes un producto con esa clave. Usa otra o edita el existente."
        : "Ya tienes un producto con ese código de barras.",
  },
});

export function quotaMessage(limit: number | null, taken: number): string {
  if (limit === null) {
    return "Tu empresa todavía no tiene un plan con cupo de productos. Pide que lo activen para empezar a agregar.";
  }
  return `Llegaste al límite de tu plan: ${taken.toLocaleString("es-MX")} de ${limit.toLocaleString("es-MX")} productos activos. Archiva productos que ya no uses o pide un nivel mayor.`;
}

/** Creates an active product and takes one place of the product quota. */
export async function createProduct(
  actor: CatalogActor,
  input: ProductInput,
): Promise<CreateProductResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.product.create",
  );

  const parsed = productSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<ProductField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as ProductField;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, reason: "invalid", fieldErrors };
  }
  const data = parsed.data;
  const productId = newId();

  try {
    await forOrganization(organizationId).$transaction(async (tx) => {
      const sameSku = await tx.product.findFirst({
        where: { sku: data.sku },
        select: { id: true },
      });
      if (sameSku) throw new Rejected(duplicate("sku"));
      if (data.barcode) {
        const sameBarcode = await tx.product.findFirst({
          where: { barcode: data.barcode },
          select: { id: true },
        });
        if (sameBarcode) throw new Rejected(duplicate("barcode"));
      }

      const quota = await consumeQuota(tx, organizationId, "active_products");
      if (!quota.ok) {
        throw new Rejected({
          ok: false,
          reason: "limit_reached",
          fieldErrors: {},
          formError: quotaMessage(quota.limit, quota.taken),
        });
      }

      const category = data.category
        ? await tx.productCategory.upsert({
            where: {
              organizationId_name: { organizationId, name: data.category },
            },
            update: {},
            create: { id: newId(), organizationId, name: data.category },
            select: { id: true },
          })
        : null;
      const brand = data.brand
        ? await tx.productBrand.upsert({
            where: {
              organizationId_name: { organizationId, name: data.brand },
            },
            update: {},
            create: { id: newId(), organizationId, name: data.brand },
            select: { id: true },
          })
        : null;

      await tx.product.create({
        data: {
          id: productId,
          organizationId,
          sku: data.sku,
          name: data.name,
          description: data.description,
          categoryId: category?.id ?? null,
          brandId: brand?.id ?? null,
          barcode: data.barcode,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "product.created",
        target: { type: "product", id: productId },
        metadata: { sku: data.sku, name: data.name },
      });
    });
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    // Two requests with the same code at once: the database kept one.
    if ((error as { code?: string }).code === "P2002") {
      const target = JSON.stringify((error as { meta?: unknown }).meta ?? "");
      return duplicate(target.includes("barcode") ? "barcode" : "sku");
    }
    throw error;
  }
  return { ok: true, productId };
}

export type ProductSummary = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  brand: string | null;
  barcode: string | null;
  createdAt: Date;
};

/** Latest active products of the company (a paginated list arrives with INV-10). */
export async function listRecentProducts(
  actor: CatalogActor,
  limit = 10,
): Promise<ProductSummary[]> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.product.read",
  );
  const rows = await forOrganization(actor.organizationId).product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: {
      id: true,
      sku: true,
      name: true,
      barcode: true,
      createdAt: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    sku: row.sku,
    name: row.name,
    category: row.category?.name ?? null,
    brand: row.brand?.name ?? null,
    barcode: row.barcode,
    createdAt: row.createdAt,
  }));
}

/** Names of categories and brands, for suggestions in forms. */
export async function listProductGroups(
  actor: CatalogActor,
): Promise<{ categories: string[]; brands: string[] }> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.product.read",
  );
  const client = forOrganization(actor.organizationId);
  const [categories, brands] = await Promise.all([
    client.productCategory.findMany({
      orderBy: { name: "asc" },
      take: 500,
      select: { name: true },
    }),
    client.productBrand.findMany({
      orderBy: { name: "asc" },
      take: 500,
      select: { name: true },
    }),
  ]);
  return {
    categories: categories.map((c) => c.name),
    brands: brands.map((b) => b.name),
  };
}
