import "server-only";

import { newId } from "@/lib";
import { recordAuditEvent } from "@/platform/audit";
import {
  refundAttempt,
  reserveAttempt,
  settleFailure,
  throttleKeys,
  tooManyAttemptsMessage,
  verifyAccountPassword,
} from "@/platform/auth";
import { can, listTeamMembers } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import { capOf, formatPercent, parsePercent, PERCENT_ERROR } from "./discounts";
import type { SalesActor } from "./prices";
import { readDiscountCaps } from "./settings";

/**
 * A discount above the cashier's cap, allowed at the counter (VEN-14, ADR
 * 0030): someone whose cap reaches it — Encargado de caja, administrator or
 * the titular — types their password on that screen. The authorization is
 * for that cashier, up to that percent, for a few minutes and one sale.
 */

export const AUTHORIZATION_MINUTES = 10;

export type DiscountAuthorizer = {
  userId: string;
  name: string;
  /** «20 %»; the titular has no cap. */
  cap: string;
};

/** Who may allow a discount here, besides the cashier, with their cap. */
export async function listDiscountAuthorizers(
  seller: SalesActor,
): Promise<DiscountAuthorizer[]> {
  await assertModulePermission(
    seller.organizationId,
    seller.userId,
    "sales.sale.create",
  );
  const [members, caps] = await Promise.all([
    listTeamMembers(seller.organizationId),
    readDiscountCaps(
      forOrganization(seller.organizationId),
      seller.organizationId,
    ),
  ]);
  return (
    members
      .filter(
        (member) =>
          member.status === "ACTIVE" &&
          member.userId !== seller.userId &&
          can(member, "sales.discount.authorize"),
      )
      // Whoever is usually asked first: the smallest cap, the titular last.
      .map((member) => ({ member, cap: capOf(member, caps) }))
      .sort(
        (a, b) =>
          a.cap.comparedTo(b.cap) ||
          a.member.name.localeCompare(b.member.name, "es"),
      )
      .map(({ member, cap }) => ({
        userId: member.userId,
        name: member.name,
        cap: formatPercent(cap),
      }))
  );
}

export type AuthorizeDiscountResult =
  | {
      ok: true;
      authorizationId: string;
      /** «Autorizó Laura Pérez hasta 20 %». */
      summary: string;
      percent: string;
      belowCost: boolean;
    }
  | {
      ok: false;
      fieldErrors: Partial<
        Record<"authorizer" | "password" | "percent" | "reason", string>
      >;
      formError?: string;
    };

export async function authorizeDiscount(
  seller: SalesActor,
  input: {
    authorizerUserId: string;
    password: string;
    percent: string;
    reason: string;
    /** Of the request, for the attempt limit (`clientIp`). */
    ip: string;
  },
): Promise<AuthorizeDiscountResult> {
  const { organizationId, userId } = seller;
  await assertModulePermission(organizationId, userId, "sales.sale.create");
  const fieldErrors: Extract<
    AuthorizeDiscountResult,
    { ok: false }
  >["fieldErrors"] = {};
  const percent = parsePercent(String(input.percent ?? "").slice(0, 16));
  if (percent === null || Number(percent) === 0) {
    fieldErrors.percent = PERCENT_ERROR;
  }
  const reason = String(input.reason ?? "").trim();
  if (
    reason.length < 3 ||
    reason.length > 200 ||
    /[\u0000-\u001f]/.test(reason)
  ) {
    fieldErrors.reason =
      "Escribe el motivo del descuento (de 3 a 200 caracteres).";
  }
  const authorizerId = String(input.authorizerUserId ?? "").slice(0, 36);
  if (authorizerId === "") fieldErrors.authorizer = "Elige quién autoriza.";
  if (String(input.password ?? "") === "") {
    fieldErrors.password = "Escribe la contraseña de quien autoriza.";
  }
  if (Object.keys(fieldErrors).length > 0 || percent === null) {
    return { ok: false, fieldErrors };
  }

  const authorizers = await listDiscountAuthorizers(seller);
  const authorizer = authorizers.find((a) => a.userId === authorizerId);
  if (!authorizer) {
    return {
      ok: false,
      fieldErrors: { authorizer: "Esa persona no puede autorizar descuentos." },
    };
  }
  // Before checking the password: the attempt is taken first (audit 1).
  const keys = [
    throttleKeys.discountAuthorizer(authorizerId),
    throttleKeys.discountAuthorizeIp(input.ip || "unknown"),
  ];
  const wait = await reserveAttempt(keys);
  if (wait > 0) {
    return {
      ok: false,
      fieldErrors: {},
      formError: tooManyAttemptsMessage(wait),
    };
  }
  if (!(await verifyAccountPassword(authorizerId, input.password))) {
    await settleFailure(keys);
    return {
      ok: false,
      fieldErrors: { password: "Esa contraseña no es la de quien autoriza." },
    };
  }
  await refundAttempt(keys);

  // Read again with the roles in force: the cap and below-cost permission.
  const members = await listTeamMembers(organizationId);
  const member = members.find(
    (m) => m.userId === authorizerId && m.status === "ACTIVE",
  );
  const caps = await readDiscountCaps(
    forOrganization(organizationId),
    organizationId,
  );
  if (!member || !can(member, "sales.discount.authorize")) {
    return {
      ok: false,
      fieldErrors: { authorizer: "Esa persona no puede autorizar descuentos." },
    };
  }
  const cap = capOf(member, caps);
  if (cap.lessThan(percent)) {
    return {
      ok: false,
      fieldErrors: {
        percent: `${member.name} autoriza hasta ${formatPercent(cap)}.`,
      },
    };
  }
  const belowCost = can(member, "sales.below_cost.authorize");
  const id = newId();
  await forOrganization(organizationId).$transaction(async (tx) => {
    await tx.saleDiscountAuthorization.create({
      data: {
        id,
        organizationId,
        sellerUserId: userId,
        authorizerUserId: authorizerId,
        percent,
        belowCost,
        reason,
        expiresAt: new Date(Date.now() + AUTHORIZATION_MINUTES * 60_000),
      },
    });
    await recordAuditEvent(tx, {
      organizationId,
      actorUserId: authorizerId,
      action: "sales.discount_authorized",
      target: { type: "user", id: userId },
      reason,
      metadata: { porcentaje: formatPercent(percent) },
    });
  });
  return {
    ok: true,
    authorizationId: id,
    summary: `Autorizó ${member.name} hasta ${formatPercent(percent)}`,
    percent,
    belowCost,
  };
}
