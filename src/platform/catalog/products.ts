import "server-only";

import { z } from "zod";

import { dec, formatDecimal, isMultipleOf, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { consumeQuota, releaseQuota } from "@/platform/entitlements";
import { LOCKING_TRANSACTION, forOrganization, lockRows } from "@/server";

import { defaultStep, stepProblem } from "./quantity";
import { getUnit, isUnitCode } from "./units";

/**
 * Products of the catalog (INV-02). Every new product goes through
 * `createProduct`: it checks the role and the contracted module, takes one
 * place of the plan's quota and writes the product in the same transaction.
 * If anything fails, the place is not consumed. The only other way in is a
 * confirmed import (`imported-products.ts`, IMP-08), which takes its place
 * from what the import holds (a test fails if `product.create` appears
 * anywhere else).
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
  /** Code of the unit in which the product is controlled (INV-06). */
  unit: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || "piece")
    .refine(isUnitCode, "Elige una unidad de la lista."),
  /** Increment for its quantities; empty = the usual one for the unit. */
  step: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || ""),
});

/** Unit and increment of a parsed card, or the problem with them. */
function quantityRule(data: { unit: string; step: string }) {
  const step = data.step || defaultStep(data.unit);
  const problem = stepProblem(data.unit, step);
  return problem
    ? ({ ok: false, problem } as const)
    : ({ ok: true, unitCode: data.unit, quantityStep: step } as const);
}

export type ProductInput = z.input<typeof productSchema>;
export type ProductField = keyof ProductInput;

export type CreateProductResult =
  | { ok: true; productId: string }
  | {
      ok: false;
      reason:
        "invalid" | "duplicate" | "limit_reached" | "not_found" | "unchanged";
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
  const rule = quantityRule(data);
  if (!rule.ok) {
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: { step: rule.problem },
    };
  }
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
          unitCode: rule.unitCode,
          quantityStep: rule.quantityStep,
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
  /** Unit in which it is controlled and the increment of its quantities. */
  unitCode: string;
  quantityStep: string;
  createdAt: Date;
};

/** Products shown per page of the list. */
export const PRODUCT_PAGE_SIZE = 25;

export type ProductPage = {
  items: ProductSummary[];
  /** Products that match, in every page. */
  total: number;
  /** Page actually returned (1-based); a page past the end becomes the last. */
  page: number;
  pageSize: number;
  pageCount: number;
  /** The search as it was applied (trimmed and bounded); "" without one. */
  search: string;
  /**
   * The product whose code (SKU) or barcode is exactly what was searched,
   * if any: what a scanner or a typed code is looking for, wherever it
   * falls in the list.
   */
  exact: ProductSummary | null;
};

/** Longest search accepted and how many words of it are used. */
const SEARCH_MAX_LENGTH = 100;
const SEARCH_MAX_TERMS = 6;

/** What a person typed in the search box, without control characters or extra spaces. */
export function normalizeSearch(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, SEARCH_MAX_LENGTH)
    .trim();
}

/** `%`, `_` and `\` are text to find, not wildcards. */
const literal = (term: string) => term.replace(/[\\%_]/g, "\\$&");

const SUMMARY_SELECT = {
  id: true,
  sku: true,
  name: true,
  barcode: true,
  unitCode: true,
  quantityStep: true,
  createdAt: true,
  category: { select: { name: true } },
  brand: { select: { name: true } },
} as const;

type SummaryRow = {
  id: string;
  sku: string;
  name: string;
  barcode: string | null;
  unitCode: string;
  quantityStep: { toString(): string };
  createdAt: Date;
  category: { name: string } | null;
  brand: { name: string } | null;
};

const toSummary = (row: SummaryRow): ProductSummary => ({
  id: row.id,
  sku: row.sku,
  name: row.name,
  category: row.category?.name ?? null,
  brand: row.brand?.name ?? null,
  barcode: row.barcode,
  unitCode: row.unitCode,
  quantityStep: row.quantityStep.toString(),
  createdAt: row.createdAt,
});

/**
 * One page of the catalog, by name (INV-10), optionally narrowed by a
 * search (INV-11): every word typed must appear in the name, the code
 * (SKU) or the barcode, without distinguishing capitals or accents.
 *
 * The database counts, filters and cuts the page inside one index (company,
 * status, name, SKU, barcode); the catalog is never loaded whole. The SKU,
 * unique in the company, breaks ties between equal names so pages never
 * overlap.
 */
export async function listProducts(
  actor: CatalogActor,
  options: {
    status?: "ACTIVE" | "ARCHIVED";
    page?: number;
    pageSize?: number;
    search?: string;
    /** Only this category (INV-12); `null` = products without category. */
    categoryId?: string | null;
    /** Only this brand; `null` = products without brand. */
    brandId?: string | null;
  } = {},
): Promise<ProductPage> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.product.read",
  );
  const status: "ACTIVE" | "ARCHIVED" =
    options.status === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
  const pageSize = clampInteger(options.pageSize, 1, 100, PRODUCT_PAGE_SIZE);
  const search = normalizeSearch(options.search);
  const where = {
    status,
    // Filters combine with each other and with the search. An id of
    // another company matches nothing: the client is scoped to this one.
    ...(options.categoryId === undefined
      ? {}
      : { categoryId: groupId(options.categoryId) }),
    ...(options.brandId === undefined
      ? {}
      : { brandId: groupId(options.brandId) }),
    AND: search
      .split(" ")
      .filter(Boolean)
      .slice(0, SEARCH_MAX_TERMS)
      .map((term) => {
        const contains = literal(term);
        return {
          OR: [
            { name: { contains } },
            { sku: { contains } },
            { barcode: { contains } },
          ],
        };
      }),
  };
  const client = forOrganization(actor.organizationId);
  const [total, exact] = await Promise.all([
    client.product.count({ where }),
    search
      ? client.product.findFirst({
          where: { status, OR: [{ sku: search }, { barcode: search }] },
          select: SUMMARY_SELECT,
        })
      : null,
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = clampInteger(options.page, 1, pageCount, 1);
  const rows = await client.product.findMany({
    where,
    orderBy: [{ name: "asc" }, { sku: "asc" }],
    skip: (page - 1) * pageSize,
    take: pageSize,
    select: SUMMARY_SELECT,
  });
  return {
    items: rows.map(toSummary),
    total,
    page,
    pageSize,
    pageCount,
    search,
    exact: exact ? toSummary(exact) : null,
  };
}

/** Id of a category or brand as it came from a filter; never longer than an id. */
const groupId = (value: string | null) =>
  value === null ? null : String(value).slice(0, 36);

export type ProductFilterOptions = {
  categories: { id: string; name: string }[];
  brands: { id: string; name: string }[];
};

/** Categories and brands of the company, by name, to filter the list (INV-12). */
export async function listProductFilterOptions(
  actor: CatalogActor,
): Promise<ProductFilterOptions> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.product.read",
  );
  const client = forOrganization(actor.organizationId);
  const query = {
    orderBy: { name: "asc" },
    take: 500,
    select: { id: true, name: true },
  } as const;
  const [categories, brands] = await Promise.all([
    client.productCategory.findMany(query),
    client.productBrand.findMany(query),
  ]);
  return { categories, brands };
}

/** A whole number inside the range; anything else becomes the fallback or the nearest bound. */
function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isSafeInteger(value)) return fallback;
  return Math.min(Math.max(value, min), max);
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

export type ProductCard = ProductSummary & {
  description: string | null;
  status: "ACTIVE" | "ARCHIVED";
  updatedAt: Date;
};

/** One product of the company, or null when it is not there. */
export async function getProduct(
  actor: CatalogActor,
  productId: string,
): Promise<ProductCard | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.product.read",
  );
  const row = await forOrganization(actor.organizationId).product.findFirst({
    where: { id: String(productId) },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      barcode: true,
      unitCode: true,
      quantityStep: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      category: { select: { name: true } },
      brand: { select: { name: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    description: row.description,
    category: row.category?.name ?? null,
    brand: row.brand?.name ?? null,
    barcode: row.barcode,
    unitCode: row.unitCode,
    quantityStep: row.quantityStep.toString(),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type UpdateProductResult = CreateProductResult;

/** Fields of the card as people see them, for the audit log. */
const FIELD_LABELS: Record<ProductField, string> = {
  sku: "Clave",
  name: "Nombre",
  description: "Descripción",
  category: "Categoría",
  brand: "Marca",
  barcode: "Código de barras",
  unit: "Unidad",
  step: "Precisión",
};

/**
 * Changes the card of a product (INV-03): its descriptive fields only.
 * Quantities are not part of the card; stock changes only through
 * movements. Every change is recorded with the previous and new values.
 */
export async function updateProduct(
  actor: CatalogActor,
  productId: string,
  input: ProductInput,
): Promise<UpdateProductResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.product.update",
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
  const rule = quantityRule(data);
  if (!rule.ok) {
    return {
      ok: false,
      reason: "invalid",
      fieldErrors: { step: rule.problem },
    };
  }
  const id = String(productId);

  try {
    await forOrganization(organizationId).$transaction(async (tx) => {
      const current = await tx.product.findFirst({
        where: { id },
        select: {
          sku: true,
          name: true,
          description: true,
          barcode: true,
          unitCode: true,
          quantityStep: true,
          category: { select: { name: true } },
          brand: { select: { name: true } },
        },
      });
      if (!current) {
        throw new Rejected({
          ok: false,
          reason: "not_found",
          fieldErrors: {},
          formError: "Este producto ya no existe.",
        });
      }
      const before: Record<ProductField, string | null> = {
        sku: current.sku,
        name: current.name,
        description: current.description,
        category: current.category?.name ?? null,
        brand: current.brand?.name ?? null,
        barcode: current.barcode,
        unit: current.unitCode,
        step: Number(current.quantityStep.toString()).toString(),
      };
      const after: Record<ProductField, string | null> = {
        ...data,
        unit: rule.unitCode,
        step: Number(rule.quantityStep).toString(),
      };
      const changed = (Object.keys(before) as ProductField[]).filter(
        (field) => before[field] !== after[field],
      );
      if (changed.length === 0) {
        throw new Rejected({
          ok: false,
          reason: "unchanged",
          fieldErrors: {},
          formError: "No hay cambios que guardar.",
        });
      }
      // The first movement fixes the unit (INV-15): the stock already
      // recorded is in it. The precision may only become finer, so every
      // quantity recorded stays valid.
      if (changed.includes("unit") || changed.includes("step")) {
        const moved = await tx.stockMovementLine.findFirst({
          where: { productId: id },
          select: { id: true },
        });
        if (moved && changed.includes("unit")) {
          throw new Rejected({
            ok: false,
            reason: "invalid",
            fieldErrors: {
              unit: "Este producto ya tiene movimientos: su unidad ya no se puede cambiar.",
            },
          });
        }
        if (
          moved &&
          !isMultipleOf(current.quantityStep.toString(), rule.quantityStep)
        ) {
          throw new Rejected({
            ok: false,
            reason: "invalid",
            fieldErrors: {
              step: "Este producto ya tiene movimientos: su precisión solo puede hacerse más fina (por ejemplo, de 0.1 a 0.01).",
            },
          });
        }
      }

      const sameSku = await tx.product.findFirst({
        where: { sku: data.sku, NOT: { id } },
        select: { id: true },
      });
      if (sameSku) throw new Rejected(duplicate("sku"));
      if (data.barcode) {
        const sameBarcode = await tx.product.findFirst({
          where: { barcode: data.barcode, NOT: { id } },
          select: { id: true },
        });
        if (sameBarcode) throw new Rejected(duplicate("barcode"));
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

      await tx.product.update({
        where: { id },
        data: {
          sku: data.sku,
          name: data.name,
          description: data.description,
          categoryId: category?.id ?? null,
          brandId: brand?.id ?? null,
          barcode: data.barcode,
          unitCode: rule.unitCode,
          quantityStep: rule.quantityStep,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "product.updated",
        target: { type: "product", id },
        metadata: {
          sku: data.sku,
          changes: Object.fromEntries(
            changed.map((field) => [
              FIELD_LABELS[field],
              field === "unit"
                ? {
                    antes: getUnit(before.unit!).name,
                    ahora: getUnit(after.unit!).name,
                  }
                : { antes: before[field], ahora: after[field] },
            ]),
          ),
        },
      });
    });
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    if ((error as { code?: string }).code === "P2002") {
      const target = JSON.stringify((error as { meta?: unknown }).meta ?? "");
      return duplicate(target.includes("barcode") ? "barcode" : "sku");
    }
    throw error;
  }
  return { ok: true, productId: id };
}

export type ProductStatusResult =
  | { ok: true }
  | {
      ok: false;
      reason: "not_found" | "unchanged" | "limit_reached" | "has_stock";
      error: string;
    };

/** Carries an expected failure of archive/reactivate out of the transaction. */
class StatusRejected extends Error {
  constructor(readonly result: ProductStatusResult) {
    super("status change rejected");
  }
}

/**
 * Archives a product (INV-04): it leaves the catalog in use and frees its
 * place of the quota. Nothing is deleted: the card, its code and its
 * history stay, and it can be reactivated.
 */
export async function archiveProduct(
  actor: CatalogActor,
  productId: string,
  reason?: string,
): Promise<ProductStatusResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.product.archive",
  );
  const id = String(productId);
  try {
    await forOrganization(organizationId).$transaction(async (tx) => {
      // Movements lock the product too: none can slip in while we decide.
      await lockRows(tx, "product", [id]);
      const product = await tx.product.findFirst({
        where: { id },
        select: { sku: true, name: true, status: true, unitCode: true },
      });
      if (!product) {
        throw new StatusRejected({
          ok: false,
          reason: "not_found",
          error: "Este producto ya no existe.",
        });
      }
      // A product with stock is not archived (INV-19B): what is on the
      // shelves must still be visible and countable.
      const stock = await tx.stockBalance.aggregate({
        where: { productId: id, quantity: { gt: 0 } },
        _sum: { quantity: true },
        _count: true,
      });
      if (product.status === "ACTIVE" && stock._count > 0) {
        const unit = getUnit(product.unitCode);
        const total = dec((stock._sum.quantity ?? 0).toString());
        throw new StatusRejected({
          ok: false,
          reason: "has_stock",
          error: `Todavía hay ${formatDecimal(total)} ${total.equals(1) ? unit.name : unit.plural} de este producto${stock._count > 1 ? ` en ${stock._count} ubicaciones` : ""}. Regístralas como salida o ajústalas a cero antes de archivarlo.`,
        });
      }
      // The status in the filter decides between two simultaneous requests.
      const archived = await tx.product.updateMany({
        where: { id, status: "ACTIVE" },
        data: { status: "ARCHIVED" },
      });
      if (archived.count === 0) {
        throw new StatusRejected({
          ok: false,
          reason: "unchanged",
          error: "Este producto ya está archivado.",
        });
      }
      if (!(await releaseQuota(tx, "active_products"))) {
        throw new Error(`Quota counter out of step for ${organizationId}`);
      }
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "product.archived",
        target: { type: "product", id },
        reason,
        metadata: { sku: product.sku, name: product.name },
      });
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof StatusRejected) return error.result;
    throw error;
  }
  return { ok: true };
}

/** Brings an archived product back. It needs a free place of the quota. */
export async function reactivateProduct(
  actor: CatalogActor,
  productId: string,
): Promise<ProductStatusResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "inventory.product.reactivate",
  );
  const id = String(productId);
  try {
    await forOrganization(organizationId).$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id },
        select: { sku: true, name: true },
      });
      if (!product) {
        throw new StatusRejected({
          ok: false,
          reason: "not_found",
          error: "Este producto ya no existe.",
        });
      }
      const reactivated = await tx.product.updateMany({
        where: { id, status: "ARCHIVED" },
        data: { status: "ACTIVE" },
      });
      if (reactivated.count === 0) {
        throw new StatusRejected({
          ok: false,
          reason: "unchanged",
          error: "Este producto ya está activo.",
        });
      }
      const quota = await consumeQuota(tx, organizationId, "active_products");
      if (!quota.ok) {
        throw new StatusRejected({
          ok: false,
          reason: "limit_reached",
          error: quotaMessage(quota.limit, quota.taken),
        });
      }
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "product.reactivated",
        target: { type: "product", id },
        metadata: { sku: product.sku, name: product.name },
      });
    });
  } catch (error) {
    if (error instanceof StatusRejected) return error.result;
    throw error;
  }
  return { ok: true };
}
