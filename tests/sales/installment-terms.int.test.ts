import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError } from "@/lib";
import { getInstallmentTerms, setInstallmentTerms } from "@/modules/sales";
import { listAuditTrail } from "@/platform/audit";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// PAG-01 (ADR 0030): the months a company sells on installments, each with
// an optional interest (0 by default). Only the titular changes them.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("installment terms", () => {
  it("none by default; the titular sets months and interest", async () => {
    const titular = await salesCompany();
    expect(await getInstallmentTerms(titular)).toEqual([]);
    expect(
      await setInstallmentTerms(titular, [
        { months: "12", interest: "15" },
        { months: "3", interest: "" },
        { months: "", interest: "" },
        { months: "6", interest: "7.5" },
      ]),
    ).toEqual({ ok: true, changed: true });
    expect(await getInstallmentTerms(titular)).toEqual([
      { months: 3, interestPercent: "0.00" },
      { months: 6, interestPercent: "7.50" },
      { months: 12, interestPercent: "15.00" },
    ]);
    // The same again changes nothing; less replaces.
    expect(
      await setInstallmentTerms(titular, [
        { months: "3", interest: "0" },
        { months: "6", interest: "7.5" },
        { months: "12", interest: "15" },
      ]),
    ).toEqual({ ok: true, changed: false });
    expect(
      await setInstallmentTerms(titular, [{ months: "6", interest: "0" }]),
    ).toEqual({ ok: true, changed: true });
    expect(await getInstallmentTerms(titular)).toEqual([
      { months: 6, interestPercent: "0.00" },
    ]);
    const trail = await listAuditTrail(titular.organizationId, { limit: 5 });
    expect(trail.map((entry) => entry.action)).toContain(
      "sales.installments_changed",
    );
  });

  it("says what is wrong with each row", async () => {
    const titular = await salesCompany();
    expect(
      await setInstallmentTerms(titular, [
        { months: "0", interest: "" },
        { months: "6", interest: "abc" },
        { months: "61", interest: "" },
        { months: "3", interest: "" },
        { months: "3", interest: "5" },
        { months: "2.5", interest: "" },
      ]),
    ).toEqual({
      ok: false,
      reason: "invalid",
      rowErrors: {
        0: "Escribe los meses como un número entero del 1 al 60.",
        1: "Escribe el interés como un número del 0 al 100.",
        2: "Escribe los meses como un número entero del 1 al 60.",
        4: "El plazo de 3 meses ya está arriba.",
        5: "Escribe los meses como un número entero del 1 al 60.",
      },
    });
    expect(await getInstallmentTerms(titular)).toEqual([]);
    const many = Array.from({ length: 13 }, (_, index) => ({
      months: String(index + 1),
      interest: "",
    }));
    expect(await setInstallmentTerms(titular, many)).toMatchObject({
      ok: false,
      formError: "Ofrece hasta 12 plazos.",
    });
  });

  it("only the titular changes them; who quotes reads them", async () => {
    const titular = await salesCompany();
    await setInstallmentTerms(titular, [{ months: "6", interest: "10" }]);
    const admin = await salesMember(titular.organizationId, "administrator");
    await expect(
      setInstallmentTerms(admin, [{ months: "3", interest: "" }]),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const cajera = await salesMember(titular.organizationId, "cashier");
    expect(await getInstallmentTerms(cajera)).toEqual([
      { months: 6, interestPercent: "10.00" },
    ]);
    // Another company has its own.
    expect(await getInstallmentTerms(await salesCompany())).toEqual([]);
  });

  it("the database keeps months and interest in range", async () => {
    const titular = await salesCompany();
    await expect(
      db.salesInstallmentTerm.create({
        data: {
          id: "00000000-0000-7000-8000-000000000001",
          organizationId: titular.organizationId,
          months: 0,
        },
      }),
    ).rejects.toThrow(/sales_installment_term_check/);
  });
});
