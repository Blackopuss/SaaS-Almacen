import "server-only";

import { z } from "zod";

import { dec, formatDecimal, isAppError, newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { getUnit, pluralizeName } from "@/platform/catalog";
import { forOrganization, type TenantDb } from "@/server";

/**
 * Which supplier sells which product (CMP-03): the code the supplier
 * knows it by, the presentation it is bought in and what it cost the last
 * time. One link per product and supplier.
 *
 * Two things are deliberately not offered here. The presentation only
 * says how the product is bought: its content is the catalog's and is
 * never changed from a link. And the last cost is not typed in: it is
 * written by `recordLastCost` when a purchase is registered (CMP-04,
 * CMP-13), and read only by who may see costs — for anyone else it is
 * not even fetched from the database.
 */

/** Who is acting; always taken from the session, never from the form. */
export type PurchasingActor = { organizationId: string; userId: string };

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .regex(
      /^[^\u0000-\u001f\u007f]*$/,
      "Quita los saltos de línea o tabuladores.",
    )
    .max(max, `Máximo ${max} caracteres.`)
    .optional()
    .transform((value) => (value ? value : null));

const id = (missing: string) =>
  z.string({ error: missing }).trim().min(1, missing).max(36, missing);

const optionalId = z
  .string()
  .trim()
  .max(36)
  .optional()
  .transform((value) => (value ? value : null));

const linkSchema = z.object({
  productId: id("Elige el producto."),
  supplierId: id("Elige el proveedor."),
  supplierSku: optionalText(64),
  presentationId: optionalId,
});

const detailsSchema = linkSchema.pick({
  supplierSku: true,
  presentationId: true,
});

export type ProductSupplierInput = z.input<typeof linkSchema>;
export type ProductSupplierField = keyof ProductSupplierInput;

export type SaveProductSupplierResult =
  | { ok: true; linkId: string }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "duplicate";
      fieldErrors: Partial<Record<ProductSupplierField, string>>;
      formError?: string;
    };

type Failure = Extract<SaveProductSupplierResult, { ok: false }>;

const refuse = (
  reason: Failure["reason"],
  field: ProductSupplierField | null,
  message: string,
): Failure => ({
  ok: false,
  reason,
  fieldErrors: field ? { [field]: message } : {},
  ...(field ? {} : { formError: message }),
});

function fieldErrorsOf(error: z.ZodError): Failure {
  const fieldErrors: Partial<Record<ProductSupplierField, string>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as ProductSupplierField;
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, reason: "invalid", fieldErrors };
}

const DUPLICATE =
  "Ese producto ya está vinculado con este proveedor. Edita el vínculo que ya existe.";

type Reader = Pick<
  ReturnType<typeof forOrganization>,
  "product" | "contact" | "productPresentation"
>;

/** The presentation of the product the link names, or why it cannot be used. */
async function checkPresentation(
  client: Reader,
  productId: string,
  presentationId: string | null,
): Promise<Failure | null> {
  if (!presentationId) return null;
  // Only presentations of this product, in this company.
  const found = await client.productPresentation.findFirst({
    where: { id: presentationId, productId },
    select: { id: true },
  });
  return found
    ? null
    : refuse(
        "invalid",
        "presentationId",
        "Esa presentación no es de este producto. Elige una de la lista.",
      );
}

/**
 * Links a product of the catalog with a supplier of the company. Both
 * must exist in the company and be in use.
 */
export async function linkProductSupplier(
  actor: PurchasingActor,
  input: ProductSupplierInput,
): Promise<SaveProductSupplierResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.product_supplier.create",
  );
  const parsed = linkSchema.safeParse(input);
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const data = parsed.data;
  const client = forOrganization(organizationId);

  const [product, supplier] = await Promise.all([
    client.product.findFirst({
      where: { id: data.productId },
      select: { id: true, sku: true, name: true, status: true },
    }),
    client.contact.findFirst({
      where: { id: data.supplierId, isSupplier: true },
      select: { id: true, name: true, archivedAt: true },
    }),
  ]);
  if (!product) {
    return refuse("not_found", "productId", "Ese producto ya no existe.");
  }
  if (product.status !== "ACTIVE") {
    return refuse(
      "invalid",
      "productId",
      `${product.sku} está archivado. Reactívalo para vincularlo.`,
    );
  }
  if (!supplier) {
    return refuse("not_found", "supplierId", "Ese proveedor ya no existe.");
  }
  if (supplier.archivedAt) {
    return refuse(
      "invalid",
      "supplierId",
      `${supplier.name} está archivado: no se le vinculan productos.`,
    );
  }
  const wrong = await checkPresentation(
    client,
    product.id,
    data.presentationId,
  );
  if (wrong) return wrong;
  const existing = await client.productSupplier.findFirst({
    where: { productId: product.id, contactId: supplier.id },
    select: { id: true },
  });
  if (existing) return refuse("duplicate", null, DUPLICATE);

  const linkId = newId();
  try {
    await client.$transaction(async (tx) => {
      await tx.productSupplier.create({
        data: {
          id: linkId,
          organizationId,
          productId: product.id,
          contactId: supplier.id,
          supplierSku: data.supplierSku,
          presentationId: data.presentationId,
          createdByUserId: userId,
        },
      });
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "product_supplier.created",
        target: { type: "product_supplier", id: linkId },
        metadata: { producto: product.sku, proveedor: supplier.name },
      });
    });
  } catch (error) {
    // Two requests with the same pair at once: the database kept one.
    if ((error as { code?: string }).code === "P2002") {
      return refuse("duplicate", null, DUPLICATE);
    }
    throw error;
  }
  return { ok: true, linkId };
}

/**
 * Changes the supplier's code or the presentation of purchase of a link.
 * Product, supplier and last cost are not changed from here.
 */
export async function updateProductSupplier(
  actor: PurchasingActor,
  linkId: string,
  input: Pick<ProductSupplierInput, "supplierSku" | "presentationId">,
): Promise<SaveProductSupplierResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.product_supplier.update",
  );
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return fieldErrorsOf(parsed.error);
  const data = parsed.data;
  const client = forOrganization(organizationId);
  const notFound = refuse("not_found", null, "Este vínculo ya no existe.");
  const link = await client.productSupplier.findFirst({
    where: { id: String(linkId).slice(0, 36) },
    select: {
      id: true,
      productId: true,
      supplierSku: true,
      presentationId: true,
      product: { select: { sku: true } },
      contact: { select: { name: true } },
    },
  });
  if (!link) return notFound;
  if (
    link.supplierSku === data.supplierSku &&
    link.presentationId === data.presentationId
  ) {
    return { ok: true, linkId: link.id };
  }
  const wrong = await checkPresentation(
    client,
    link.productId,
    data.presentationId,
  );
  if (wrong) return wrong;
  const saved = await client.$transaction(async (tx) => {
    const updated = await tx.productSupplier.updateMany({
      where: { id: link.id },
      data: {
        supplierSku: data.supplierSku,
        presentationId: data.presentationId,
      },
    });
    if (updated.count !== 1) return false;
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: userId,
      action: "product_supplier.updated",
      target: { type: "product_supplier", id: link.id },
      metadata: { producto: link.product.sku, proveedor: link.contact.name },
    });
    return true;
  });
  return saved ? { ok: true, linkId: link.id } : notFound;
}

export type ProductSupplierLink = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  productArchived: boolean;
  supplierId: string;
  supplierName: string;
  supplierArchived: boolean;
  supplierSku: string | null;
  /** How it is usually bought; null = by the product's unit. */
  presentation: { id: string; name: string; text: string } | null;
  /** «pieza», «metro»: the unit the product is kept in. */
  unitName: string;
  /**
   * What it cost the last time. Absent — not null — for who may not see
   * costs: the amount never leaves the service.
   */
  lastCost?: {
    /** Exact amount in pesos, as text: "250.5". */
    amount: string;
    /** «$250.50 por caja de 100 piezas». */
    text: string;
    at: Date;
  } | null;
};

/** Whether the person may see costs: never an error, just yes or no. */
async function mayReadCosts(actor: PurchasingActor): Promise<boolean> {
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      "purchasing.cost.read",
    );
    return true;
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return false;
    throw error;
  }
}

const presentationSelect = {
  id: true,
  name: true,
  versions: {
    orderBy: { version: "desc" },
    take: 1,
    select: { factor: true },
  },
} as const;

const baseSelect = {
  id: true,
  supplierSku: true,
  product: {
    select: { id: true, sku: true, name: true, status: true, unitCode: true },
  },
  contact: { select: { id: true, name: true, archivedAt: true } },
  presentation: { select: presentationSelect },
} as const;

/** Only added to the query for who may see costs. */
const costSelect = {
  lastCost: true,
  lastCostAt: true,
  lastCostVersion: {
    select: { factor: true, presentation: { select: { name: true } } },
  },
} as const;

type BaseRow = {
  id: string;
  supplierSku: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    status: string;
    unitCode: string;
  };
  contact: { id: string; name: string; archivedAt: Date | null };
  presentation: {
    id: string;
    name: string;
    versions: { factor: { toString(): string } }[];
  } | null;
  lastCost?: { toString(): string } | null;
  lastCostAt?: Date | null;
  lastCostVersion?: {
    factor: { toString(): string };
    presentation: { name: string };
  } | null;
};

/** «caja de 100 piezas», from a presentation and its content. */
function describe(
  name: string,
  factor: { toString(): string },
  unitCode: string,
): string {
  const content = dec(factor.toString());
  const unit = getUnit(unitCode);
  return `${name.toLowerCase()} de ${formatDecimal(content)} ${content.equals(1) ? unit.name : unit.plural}`;
}

function toLink(row: BaseRow, withCosts: boolean): ProductSupplierLink {
  const unit = getUnit(row.product.unitCode);
  const content = row.presentation?.versions[0]?.factor;
  const link: ProductSupplierLink = {
    id: row.id,
    productId: row.product.id,
    sku: row.product.sku,
    productName: row.product.name,
    productArchived: row.product.status !== "ACTIVE",
    supplierId: row.contact.id,
    supplierName: row.contact.name,
    supplierArchived: row.contact.archivedAt !== null,
    supplierSku: row.supplierSku,
    presentation:
      row.presentation && content
        ? {
            id: row.presentation.id,
            name: row.presentation.name,
            text: describe(
              pluralizeName(row.presentation.name, dec(1)),
              content,
              row.product.unitCode,
            ),
          }
        : null,
    unitName: unit.name,
  };
  if (!withCosts) return link;
  if (!row.lastCost || !row.lastCostAt) return { ...link, lastCost: null };
  const amount = dec(row.lastCost.toString());
  const per = row.lastCostVersion
    ? describe(
        row.lastCostVersion.presentation.name,
        row.lastCostVersion.factor,
        row.product.unitCode,
      )
    : unit.name;
  return {
    ...link,
    lastCost: {
      amount: amount.toString(),
      text: `$${formatDecimal(amount, { minScale: 2 })} por ${per}`,
      at: row.lastCostAt,
    },
  };
}

export const PRODUCT_SUPPLIER_PAGE_SIZE = 25;

export type ProductSupplierList = {
  items: ProductSupplierLink[];
  total: number;
  page: number;
  pageCount: number;
  /** The person may see costs: the items carry `lastCost`. */
  costsVisible: boolean;
};

const clampPage = (value: number | undefined, pageCount: number) =>
  value === undefined || !Number.isSafeInteger(value)
    ? 1
    : Math.min(Math.max(value, 1), pageCount);

async function list(
  actor: PurchasingActor,
  where: { contactId: string } | { productId: string },
  page: number | undefined,
): Promise<ProductSupplierList> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.product_supplier.read",
  );
  const costsVisible = await mayReadCosts(actor);
  const client = forOrganization(actor.organizationId);
  const total = await client.productSupplier.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / PRODUCT_SUPPLIER_PAGE_SIZE));
  const current = clampPage(page, pageCount);
  const rows: BaseRow[] = await client.productSupplier.findMany({
    where,
    // The id (UUIDv7: order of creation) keeps pages stable inside the
    // index that starts with the company and the side being listed.
    orderBy: { id: "asc" },
    skip: (current - 1) * PRODUCT_SUPPLIER_PAGE_SIZE,
    take: PRODUCT_SUPPLIER_PAGE_SIZE,
    select: costsVisible ? { ...baseSelect, ...costSelect } : baseSelect,
  });
  return {
    items: rows.map((row) => toLink(row, costsVisible)),
    total,
    page: current,
    pageCount,
    costsVisible,
  };
}

/** Products a supplier of the company sells to it, a page at a time. */
export function listProductsOfSupplier(
  actor: PurchasingActor,
  supplierId: string,
  options: { page?: number } = {},
): Promise<ProductSupplierList> {
  return list(
    actor,
    { contactId: String(supplierId).slice(0, 36) },
    options.page,
  );
}

/** Suppliers a product of the company is bought from. */
export function listSuppliersOfProduct(
  actor: PurchasingActor,
  productId: string,
  options: { page?: number } = {},
): Promise<ProductSupplierList> {
  return list(
    actor,
    { productId: String(productId).slice(0, 36) },
    options.page,
  );
}

/** One link of the company; null when it is not one of its links. */
export async function getProductSupplier(
  actor: PurchasingActor,
  linkId: string,
): Promise<ProductSupplierLink | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.product_supplier.read",
  );
  const costsVisible = await mayReadCosts(actor);
  const row: BaseRow | null = await forOrganization(
    actor.organizationId,
  ).productSupplier.findFirst({
    where: { id: String(linkId).slice(0, 36) },
    select: costsVisible ? { ...baseSelect, ...costSelect } : baseSelect,
  });
  return row ? toLink(row, costsVisible) : null;
}

/**
 * Writes what a product cost at a supplier, when a purchase is
 * registered. For the services of orders and receipts (CMP-04, CMP-13):
 * it runs inside their transaction, after they checked
 * `purchasing.cost.record`. There is no screen that calls it directly —
 * the last cost is a fact of a purchase, never a number typed on its own.
 *
 * Returns false when the product is not linked with that supplier.
 */
export async function recordLastCost(
  tx: Pick<Tx, "productSupplier" | "presentationVersion">,
  input: {
    productId: string;
    supplierId: string;
    /** Cost of one unit of purchase, in pesos: "250.50". */
    cost: string;
    /** What was bought: a version of a presentation; null = the unit. */
    presentationVersion: { presentationId: string; versionId: string } | null;
    at?: Date;
  },
): Promise<boolean> {
  const cost = dec(input.cost);
  if (cost.isNegative() || cost.decimalPlaces() > 4) {
    throw new Error(`Invalid cost ${input.cost}`);
  }
  if (cost.greaterThan("9999999999.9999")) {
    throw new Error("Cost too large");
  }
  if (input.presentationVersion) {
    // The version must be of a presentation of this very product.
    const version = await tx.presentationVersion.findFirst({
      where: {
        id: input.presentationVersion.versionId,
        presentationId: input.presentationVersion.presentationId,
        presentation: { productId: input.productId },
      },
      select: { id: true },
    });
    if (!version) throw new Error("Presentation version is not of the product");
  }
  const updated = await tx.productSupplier.updateMany({
    where: { productId: input.productId, contactId: input.supplierId },
    data: {
      lastCost: cost.toString(),
      lastCostPresentationId: input.presentationVersion?.presentationId ?? null,
      lastCostPresentationVersionId:
        input.presentationVersion?.versionId ?? null,
      lastCostAt: input.at ?? new Date(),
    },
  });
  return updated.count === 1;
}
