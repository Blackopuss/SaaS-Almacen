import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib";
import {
  getSalePrices,
  getSalesSettings,
  updateSalesSettings,
} from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { createProduct } from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-04 (ADR 0030): each company says whether its prices include VAT and
// at what rate; only the titular changes it.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("sales settings", () => {
  it("start as VAT 16 % included and change only by the titular", async () => {
    const actor = await salesCompany();
    expect(await getSalesSettings(actor)).toEqual({
      pricesIncludeTax: true,
      rate: "16.00",
    });

    expect(
      await updateSalesSettings(actor, { taxMode: "added", taxRate: "8" }),
    ).toEqual({ ok: true, changed: true });
    expect(await getSalesSettings(actor)).toEqual({
      pricesIncludeTax: false,
      rate: "8.00",
    });
    // The same again changes nothing and leaves no new line.
    expect(
      await updateSalesSettings(actor, { taxMode: "added", taxRate: "8.00" }),
    ).toEqual({ ok: true, changed: false });

    const trail = await listAuditTrail(actor.organizationId, { limit: 10 });
    const changes = trail.filter(
      (entry) => entry.action === "sales.settings_changed",
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]?.facts).toEqual([
      "Antes: IVA 16 % incluido",
      "Ahora: IVA 8 % sumado",
    ]);
  });

  it("refuses an unknown mode or rate, saving nothing", async () => {
    const actor = await salesCompany();
    expect(
      await updateSalesSettings(actor, { taxMode: "maybe", taxRate: "116" }),
    ).toEqual({
      ok: false,
      reason: "invalid",
      fieldErrors: {
        taxMode: expect.any(String),
        taxRate: expect.any(String),
      },
    });
    expect(
      await db.salesSettings.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  });

  it("two saves at once leave one row", async () => {
    const actor = await salesCompany();
    const results = await Promise.all([
      updateSalesSettings(actor, { taxMode: "added", taxRate: "16" }),
      updateSalesSettings(actor, { taxMode: "added", taxRate: "16" }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      await db.salesSettings.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(1);
  });

  it("nobody else changes or reads them, not even the administrator", async () => {
    const actor = await salesCompany();
    for (const role of ["administrator", "cash_manager"] as const) {
      const member = await salesMember(actor.organizationId, role);
      await expect(getSalesSettings(member)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(
        updateSalesSettings(member, { taxMode: "added", taxRate: "0" }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("are another company's own", async () => {
    const actor = await salesCompany();
    const other = await salesCompany();
    await updateSalesSettings(other, { taxMode: "added", taxRate: "0" });
    expect(await getSalesSettings(actor)).toEqual({
      pricesIncludeTax: true,
      rate: "16.00",
    });
  });

  it("the price screen knows whether prices include VAT", async () => {
    const actor = await salesCompany();
    const created = await createProduct(actor, { sku: "IVA-1", name: "Pala" });
    if (!created.ok) throw new Error("product setup failed");
    expect(
      (await getSalePrices(actor, created.productId))?.pricesIncludeTax,
    ).toBe(true);
    await updateSalesSettings(actor, { taxMode: "added", taxRate: "16" });
    expect(
      (await getSalePrices(actor, created.productId))?.pricesIncludeTax,
    ).toBe(false);
  });
});
