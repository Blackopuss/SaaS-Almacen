import "server-only";

import { z } from "zod";

import { dec, newId } from "@/lib";
import { postReturnExit } from "@/modules/inventory";
import { recordAuditEvent } from "@/platform/audit";
import { assertModulePermission } from "@/platform/billing";
import { parseQuantity, pluralizeName } from "@/platform/catalog";
import {
  LOCKING_TRANSACTION,
  forOrganization,
  lockRows,
  type TenantDb,
} from "@/server";

import { PURCHASE_ORDER_MAX_LINES, formatOrderNumber } from "./orders";
import type { PurchasingActor } from "./product-suppliers";
import { inTermsOf } from "./receipts";

/**
 * Returns to the supplier (CMP-12). What arrived with a receipt and goes
 * back — damaged, wrong, more than wanted — leaves stock with its own
 * document, in one transaction: the return with its lines and the exit
 * (`RETURN`, written by Inventario). Nothing of the receipt changes.
 *
 * Limit: what is returned of a receipt line, adding every return of it,
 * never exceeds what that line received (NEG-24). It is decided with the
 * order locked, so two returns at once go one after the other and the
 * second sees the first; the database repeats the rule (trigger).
 *
 * Each line goes back in the terms it was received (boxes) and with the
 * factor it was received with: what entered for a box is what leaves.
 * The order does not change state: a return does not make anything
 * pending again (what is still needed is ordered again).
 *
 * Order of locks, as receipts: products → locations → order.
 */

type Tx = Parameters<Parameters<TenantDb["$transaction"]>[0]>[0];
type Decimal = ReturnType<typeof dec>;

const KEY = /^[A-Za-z0-9_-]{8,64}$/;

const KEY_REUSED =
  "Esta confirmación ya se usó para otra devolución. Recarga la página para registrar una nueva.";

const returnSchema = z.object({
  reason: z
    .string({ error: "Escribe por qué se devuelve." })
    .trim()
    .regex(
      /^[^\u0000-\u0009\u000b-\u001f\u007f]*$/,
      "Quita los tabuladores o caracteres especiales.",
    )
    .min(3, "Escribe por qué se devuelve (al menos 3 letras).")
    .max(300, "El motivo admite hasta 300 caracteres."),
  idempotencyKey: z
    .string()
    .regex(KEY, "Recarga la página para registrar la devolución."),
  /** What goes back of each receipt line; empty or 0 = nothing. */
  lines: z
    .array(
      z.object({
        receiptLineId: z.string().trim().max(36),
        quantity: z.string().trim().max(40),
        /** Where it is taken from, when not where it was received. */
        locationId: z.string().trim().max(36).optional(),
      }),
    )
    .max(PURCHASE_ORDER_MAX_LINES),
});

export type ReturnInput = z.input<typeof returnSchema>;

export type ReturnResult =
  | {
      ok: true;
      returnId: string;
      /** «Devolviste 1 caja de Clavo (100 piezas) de OC-0007.». */
      summary: string;
      /** It had already been registered (a retry): nothing was written now. */
      repeated?: true;
    }
  | {
      ok: false;
      reason: "invalid" | "not_found" | "not_allowed";
      fieldErrors: { reason?: string };
      formError?: string;
      /** Problem of each line, by the id of the receipt line. */
      lineErrors?: Record<string, string>;
    };

type Failure = Extract<ReturnResult, { ok: false }>;

class Rejected extends Error {
  constructor(readonly result: Failure) {
    super("return rejected");
  }
}

const refuse = (reason: Failure["reason"], message: string): never => {
  throw new Rejected({
    ok: false,
    reason,
    fieldErrors: {},
    formError: message,
  });
};

const refuseLines = (lineErrors: Record<string, string>): never => {
  throw new Rejected({
    ok: false,
    reason: "invalid",
    fieldErrors: {},
    formError:
      Object.keys(lineErrors).length === 1
        ? "Revisa la cantidad marcada."
        : "Revisa las cantidades marcadas.",
    lineErrors,
  });
};

const isNothing = (text: string) =>
  text.trim() === "" || /^0+([.,]0*)?$/.test(text.trim());

/** What was already returned of each receipt line, in its terms. */
export async function returnedByLine(
  client: Pick<Tx, "purchaseReturnLine">,
  receiptLineIds: string[],
): Promise<Map<string, Decimal>> {
  if (receiptLineIds.length === 0) return new Map();
  const rows = await client.purchaseReturnLine.groupBy({
    by: ["receiptLineId"],
    where: { receiptLineId: { in: receiptLineIds } },
    _sum: { capturedQuantity: true },
  });
  return new Map(
    rows.map((row) => [
      row.receiptLineId,
      dec(row._sum.capturedQuantity?.toString() ?? 0),
    ]),
  );
}

/**
 * Whether a repeated confirmation asks for what its key already returned:
 * the same lines, quantities and places. Otherwise it is a reused form.
 */
function sameReturn(
  stored: {
    receiptLineId: string;
    capturedQuantity: { toString(): string };
    locationId: string;
  }[],
  asked: { receiptLineId: string; quantity: string; locationId?: string }[],
): boolean {
  const wanted = asked.filter((item) => !isNothing(item.quantity));
  if (wanted.length !== stored.length) return false;
  const byLine = new Map(stored.map((line) => [line.receiptLineId, line]));
  return wanted.every((item) => {
    const line = byLine.get(item.receiptLineId);
    if (!line) return false;
    try {
      return (
        dec(item.quantity.replace(/,(?=\d{3}(\D|$))/g, "")).equals(
          line.capturedQuantity.toString(),
        ) &&
        (!item.locationId || item.locationId === line.locationId)
      );
    } catch {
      return false;
    }
  });
}

/**
 * Returns to the supplier part or all of what a receipt brought (CMP-12).
 * Repeating the confirmation (double click, retry after a lost answer)
 * returns once.
 */
export async function returnToSupplier(
  actor: PurchasingActor,
  receiptId: string,
  input: ReturnInput,
): Promise<ReturnResult> {
  const { organizationId, userId } = actor;
  await assertModulePermission(
    organizationId,
    userId,
    "purchasing.return.create",
  );
  const parsed = returnSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return issue.path[0] === "reason"
      ? { ok: false, reason: "invalid", fieldErrors: { reason: issue.message } }
      : {
          ok: false,
          reason: "invalid",
          fieldErrors: {},
          formError: issue.message,
        };
  }
  const data = parsed.data;
  const client = forOrganization(organizationId);
  // What to lock comes from the receipt, which never changes.
  const receipt = await client.purchaseReceipt.findFirst({
    where: { id: String(receiptId).slice(0, 36) },
    select: {
      id: true,
      orderId: true,
      lines: { select: { productId: true, locationId: true } },
    },
  });
  if (!receipt) {
    return {
      ok: false,
      reason: "not_found",
      fieldErrors: {},
      formError: "Esta recepción ya no existe.",
    };
  }

  try {
    return await client.$transaction(async (tx) => {
      await lockRows(
        tx,
        "product",
        receipt.lines.map((line) => line.productId),
      );
      await lockRows(tx, "location", [
        ...receipt.lines.map((line) => line.locationId),
        ...data.lines.flatMap((line) =>
          line.locationId ? [line.locationId] : [],
        ),
      ]);
      await lockRows(tx, "purchaseOrder", [receipt.orderId]);

      const replay = await tx.purchaseReturn.findFirst({
        where: { idempotencyKey: data.idempotencyKey },
        select: {
          id: true,
          receiptId: true,
          returnedByUserId: true,
          lines: {
            select: {
              receiptLineId: true,
              capturedQuantity: true,
              locationId: true,
            },
          },
        },
      });
      if (replay) {
        if (
          replay.receiptId !== receipt.id ||
          replay.returnedByUserId !== userId ||
          !sameReturn(replay.lines, data.lines)
        ) {
          return refuse("not_allowed", KEY_REUSED);
        }
        return {
          ok: true as const,
          returnId: replay.id,
          repeated: true as const,
          summary:
            "Esta devolución ya estaba registrada. No se registró de nuevo.",
        };
      }

      const current = await tx.purchaseReceipt.findFirst({
        where: { id: receipt.id },
        select: {
          order: {
            select: { number: true, contact: { select: { name: true } } },
          },
          lines: {
            orderBy: { lineNumber: "asc" },
            select: {
              id: true,
              productId: true,
              locationId: true,
              capturedQuantity: true,
              presentationId: true,
              presentationVersionId: true,
              factor: true,
              unitCode: true,
              // VAL-02: goes back at the cost it came in with. Never shown.
              unitCost: true,
              product: { select: { name: true, quantityStep: true } },
              presentation: { select: { name: true } },
            },
          },
        },
      });
      if (!current) return refuse("not_found", "Esta recepción ya no existe.");
      const returned = await returnedByLine(
        tx,
        current.lines.map((line) => line.id),
      );

      const byId = new Map(current.lines.map((line) => [line.id, line]));
      const errors: Record<string, string> = {};
      const chosen: {
        line: (typeof current.lines)[number];
        quantity: Decimal;
        locationId: string;
      }[] = [];
      const seen = new Set<string>();
      for (const item of data.lines) {
        const line = byId.get(item.receiptLineId);
        if (!line || seen.has(line.id)) {
          return refuse(
            "invalid",
            "Lo que mandaste no corresponde a esta recepción. Recarga la página.",
          );
        }
        seen.add(line.id);
        if (isNothing(item.quantity)) continue;
        const quantity = parseQuantity(
          line.presentationId
            ? { unitCode: "piece", quantityStep: "1" }
            : {
                unitCode: line.unitCode,
                quantityStep: line.product.quantityStep.toString(),
              },
          item.quantity,
        );
        if (!quantity.ok) {
          errors[line.id] =
            line.presentation && /completas/.test(quantity.error)
              ? `Escribe ${pluralizeName(line.presentation.name, dec(2)).toLowerCase()} completas.`
              : quantity.error;
          continue;
        }
        const received = dec(line.capturedQuantity.toString());
        const left = received.minus(returned.get(line.id) ?? dec(0));
        if (left.lessThanOrEqualTo(0)) {
          errors[line.id] =
            "Ya se devolvió todo lo que llegó de este producto.";
          continue;
        }
        if (quantity.quantity.greaterThan(left)) {
          errors[line.id] = left.equals(received)
            ? `De esta recepción llegaron ${inTermsOf(received, line.presentation, line.unitCode)}: no se devuelve más de eso.`
            : `Solo puedes devolver ${inTermsOf(left, line.presentation, line.unitCode)}: lo demás ya se devolvió.`;
          continue;
        }
        chosen.push({
          line,
          quantity: quantity.quantity,
          locationId: item.locationId || line.locationId,
        });
      }
      if (Object.keys(errors).length > 0) return refuseLines(errors);
      if (chosen.length === 0) {
        return refuse(
          "invalid",
          "Escribe cuánto devuelves de al menos un producto.",
        );
      }
      // A place chosen by the person must be one of this company.
      const places = await tx.location.findMany({
        where: { id: { in: [...new Set(chosen.map((c) => c.locationId))] } },
        select: { id: true },
      });
      const known = new Set(places.map((place) => place.id));
      for (const item of chosen) {
        if (!known.has(item.locationId)) {
          errors[item.line.id] = "Esa ubicación ya no existe. Elige otra.";
        }
      }
      if (Object.keys(errors).length > 0) return refuseLines(errors);

      const numberText = formatOrderNumber(current.order.number);
      const exit = await postReturnExit(tx, actor, {
        lines: chosen.map((item) => ({
          productId: item.line.productId,
          locationId: item.locationId,
          capturedQuantity: item.quantity,
          presentationId: item.line.presentationId,
          presentationVersionId: item.line.presentationVersionId,
          factor: dec(item.line.factor.toString()),
          unitCode: item.line.unitCode,
          unitCost: item.line.unitCost,
        })),
        reference: `${numberText} · Devolución`,
        reason: data.reason,
      });
      if (!exit.ok) {
        return refuseLines({ [chosen[exit.line]!.line.id]: exit.error });
      }

      const returnId = newId();
      await tx.purchaseReturn.create({
        data: {
          id: returnId,
          organizationId,
          receiptId: receipt.id,
          movementId: exit.movementId,
          reason: data.reason,
          idempotencyKey: data.idempotencyKey,
          returnedByUserId: userId,
        },
      });
      await tx.purchaseReturnLine.createMany({
        data: chosen.map((item, index) => ({
          id: newId(),
          organizationId,
          returnId,
          lineNumber: index + 1,
          receiptLineId: item.line.id,
          productId: item.line.productId,
          locationId: item.locationId,
          capturedQuantity: item.quantity.toString(),
          factor: item.line.factor.toString(),
          baseQuantity: dec(item.line.factor.toString())
            .times(item.quantity)
            .toString(),
          unitCode: item.line.unitCode,
        })),
      });

      const parts = chosen.map((item, index) => {
        const terms = inTermsOf(
          item.quantity,
          item.line.presentation,
          item.line.unitCode,
        );
        return item.line.presentation
          ? `${terms} de ${item.line.product.name} (${exit.texts[index]})`
          : `${terms} de ${item.line.product.name}`;
      });
      const listed =
        parts.length === 1
          ? parts[0]!
          : `${parts.slice(0, -1).join(", ")} y ${parts.at(-1)}`;
      await recordAuditEvent(tx, {
        organizationId,
        actorUserId: userId,
        action: "purchase_order.returned",
        target: { type: "purchase_order", id: receipt.orderId },
        reason: data.reason,
        metadata: {
          orden: numberText,
          proveedor: current.order.contact.name,
          devuelto: listed.slice(0, 500),
        },
      });
      return {
        ok: true as const,
        returnId,
        summary: `Devolviste ${listed} de ${numberText}.`,
      };
    }, LOCKING_TRANSACTION);
  } catch (error) {
    if (error instanceof Rejected) return error.result;
    throw error;
  }
}

/**
 * Whether a confirmation reached the server although its answer was lost
 * (INV-22): the return that key wrote for this person, if any.
 */
export async function findReturnConfirmation(
  actor: PurchasingActor,
  idempotencyKey: string,
): Promise<{ returnId: string } | null> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "purchasing.return.read",
  );
  const key = String(idempotencyKey ?? "").trim();
  if (!KEY.test(key)) return null;
  const found = await forOrganization(
    actor.organizationId,
  ).purchaseReturn.findFirst({
    where: { idempotencyKey: key, returnedByUserId: actor.userId },
    select: { id: true },
  });
  return found ? { returnId: found.id } : null;
}
