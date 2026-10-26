import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { listAuditTrail } from "@/platform/audit";
import {
  assertModulePermission,
  getCompanyPlan,
  listManualPayments,
  provisionCompany,
  recordManualPayment,
  reverseManualPayment,
  type PaymentInput,
} from "@/platform/billing";
import { getEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// PIL-11: a SPEI payment registered by platform staff extends the plan,
// the entitlements follow and the audit log keeps it.

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  return db.user.create({
    data: {
      id: newId(),
      name,
      email: `pagos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
}

/** A company whose plan (inventory + purchasing) ends at `validUntil`. */
async function companyWithPlan(
  validUntil = new Date(Date.now() + 10 * 86_400_000),
) {
  const owner = await newUser("Titular");
  const created = await createOrganization(owner.id, {
    name: `Ferretería pagos ${stamp}-${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const org = created.organizationId;
  const done = await provisionCompany(moduleRegistry, staff, org, {
    productLimit: 100,
    users: 2,
    modules: ["inventory", "purchasing"],
    validUntil,
    reason: "Plan del piloto",
  });
  if (!done.ok) throw new Error("provisioning failed");
  return { org, owner };
}

/** Moves the whole plan to end at `at` (as if time had passed). */
async function endPlanAt(org: string, at: Date) {
  await db.entitlement.updateMany({
    where: { organizationId: org },
    data: {
      validFrom: new Date(at.getTime() - 30 * 86_400_000),
      validUntil: at,
    },
  });
}

const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(
    new Date(),
  );

const payment = (change: Partial<PaymentInput> = {}): PaymentInput => ({
  amount: "1,499.90",
  paidOn: today(),
  reference: `mbanc 0100 ${++counter}`,
  months: 1,
  notes: "",
  ...change,
});

const ends = async (org: string) =>
  (
    await db.entitlement.findMany({
      where: { organizationId: org },
      select: { validUntil: true },
    })
  ).map((row) => row.validUntil?.toISOString());

beforeAll(async () => {
  staff = (await newUser("Soporte Almacén")).id;
  await db.platformStaff.create({ data: { userId: staff } });
});

afterAll(async () => {
  await db.$disconnect();
});

describe("recordManualPayment", () => {
  it("extends the plan from its end, with the exact amount and the audit", async () => {
    const { org } = await companyWithPlan(
      new Date("2026-12-01T05:59:59.999Z"), // end of 30 Nov in Mexico
    );
    const result = await recordManualPayment(
      staff,
      org,
      payment({
        amount: "$12,500.10",
        months: 2,
        notes: "Banco de origen: BBVA",
      }),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.validUntil.toISOString()).toBe("2027-01-31T05:59:59.999Z");
    // Every right of the plan moved together.
    expect(new Set(await ends(org))).toEqual(
      new Set(["2027-01-31T05:59:59.999Z"]),
    );

    const row = await db.manualPayment.findUniqueOrThrow({
      where: { id: result.paymentId },
    });
    expect(row.amount.toFixed(2)).toBe("12500.10");
    expect(row.reference).toMatch(/^MBANC0100\d+$/);
    expect(row.validUntilBefore.toISOString()).toBe("2026-12-01T05:59:59.999Z");

    const [entry] = await listAuditTrail(org);
    expect(entry).toMatchObject({
      label: "Se registró un pago",
      actorName: "Soporte Almacén",
    });
    const event = await db.auditEvent.findFirstOrThrow({
      where: { organizationId: org, action: "payment.recorded" },
    });
    expect(event).toMatchObject({
      actorUserId: staff,
      targetId: result.paymentId,
      reason: "Banco de origen: BBVA",
      metadata: {
        amount: "12500.10",
        months: 2,
        reference: row.reference,
        validUntilAfter: "2027-01-31T05:59:59.999Z",
      },
    });
  });

  it("an expired company becomes writable again, from today", async () => {
    const { org, owner } = await companyWithPlan();
    await endPlanAt(org, new Date(Date.now() - 86_400_000));
    await expect(
      assertModulePermission(org, owner.id, "inventory.product.create"),
    ).rejects.toMatchObject({ code: "module_read_only" });
    expect((await getCompanyPlan(org))?.endedAt).not.toBeNull();

    const result = await recordManualPayment(staff, org, payment());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inAMonth = Date.now() + 27 * 86_400_000;
    expect(result.validUntil.getTime()).toBeGreaterThan(inAMonth);

    await expect(
      assertModulePermission(org, owner.id, "inventory.product.create"),
    ).resolves.toBeUndefined();
    const entitlements = await getEntitlements(org);
    expect([...entitlements.modules].sort()).toEqual([
      "inventory",
      "purchasing",
    ]);
    expect(entitlements.limit("active_products")).toBe(100);
    expect((await getCompanyPlan(org))?.endedAt).toBeNull();
  });

  it("a module removed earlier is not revived", async () => {
    const { org } = await companyWithPlan();
    await provisionCompany(moduleRegistry, staff, org, {
      productLimit: 100,
      users: 2,
      modules: ["inventory"],
      validUntil: new Date(Date.now() + 10 * 86_400_000),
      reason: "Quita Compras",
    });
    expect((await recordManualPayment(staff, org, payment())).ok).toBe(true);
    expect([...(await getEntitlements(org)).modules]).toEqual(["inventory"]);
  });

  it("rejects people who are not platform staff, the titular included", async () => {
    const { org, owner } = await companyWithPlan();
    const before = await ends(org);
    expect(await recordManualPayment(owner.id, org, payment())).toMatchObject({
      ok: false,
      formError: "No tienes permiso para hacer esto.",
    });
    expect(
      await reverseManualPayment(owner.id, org, newId(), "Motivo cualquiera"),
    ).toMatchObject({
      ok: false,
      formError: "No tienes permiso para hacer esto.",
    });
    expect(await ends(org)).toEqual(before);
    expect(
      await db.manualPayment.count({ where: { organizationId: org } }),
    ).toBe(0);
  });

  it("the same SPEI reference registers once, also when sent twice at once", async () => {
    const { org } = await companyWithPlan();
    const input = payment({ reference: "DUP-123" });
    const results = await Promise.all([
      recordManualPayment(staff, org, input),
      recordManualPayment(staff, org, { ...input, reference: " dup-123 " }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({
      fieldErrors: { reference: "Ya hay un pago con esta clave de rastreo." },
    });
    expect(
      await db.manualPayment.count({ where: { organizationId: org } }),
    ).toBe(1);

    // Another company may have the same reference.
    const other = await companyWithPlan();
    expect((await recordManualPayment(staff, other.org, input)).ok).toBe(true);
  });

  it("validates what was typed", async () => {
    const { org } = await companyWithPlan();
    const result = await recordManualPayment(staff, org, {
      amount: "12.345",
      paidOn: "2099-01-01",
      reference: "clave/rara",
      months: 13,
      notes: "",
    });
    expect(result).toMatchObject({
      ok: false,
      fieldErrors: {
        amount: expect.any(String),
        paidOn: "El día del pago no puede ser posterior a hoy.",
        reference: expect.any(String),
        months: expect.any(String),
      },
    });
    expect(
      await recordManualPayment(staff, org, payment({ amount: "0" })),
    ).toMatchObject({ ok: false, fieldErrors: { amount: expect.any(String) } });
  });

  it("needs a plan with an end date", async () => {
    const owner = await newUser();
    const created = await createOrganization(owner.id, {
      name: `Sin plan ${stamp}`,
      timeZone: "",
    });
    if (!created.ok) throw new Error("setup");
    expect(
      await recordManualPayment(staff, created.organizationId, payment()),
    ).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/no tiene plan/),
    });

    const { org } = await companyWithPlan();
    await db.entitlement.updateMany({
      where: { organizationId: org },
      data: { validUntil: null },
    });
    expect(await recordManualPayment(staff, org, payment())).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/no tiene fecha de término/),
    });
  });

  it("payment rows cannot be changed or deleted", async () => {
    const { org } = await companyWithPlan();
    const result = await recordManualPayment(staff, org, payment());
    if (!result.ok) throw new Error("payment failed");
    await expect(
      db.manualPayment.update({
        where: { id: result.paymentId },
        data: { amount: "1" },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.manualPayment.delete({ where: { id: result.paymentId } }),
    ).rejects.toThrow(/immutable/);
  });
});

describe("reverseManualPayment", () => {
  it("takes the months back, once, and the reference can be registered again", async () => {
    const { org } = await companyWithPlan(new Date("2026-12-01T05:59:59.999Z"));
    const first = await recordManualPayment(
      staff,
      org,
      payment({ reference: "FIX-1", amount: "100", months: 3 }),
    );
    if (!first.ok) throw new Error("payment failed");
    expect(first.validUntil.toISOString()).toBe("2027-03-01T05:59:59.999Z");

    expect(
      await reverseManualPayment(staff, org, first.paymentId, "x"),
    ).toMatchObject({
      ok: false,
      fieldErrors: { notes: expect.any(String) },
    });
    const reversed = await reverseManualPayment(
      staff,
      org,
      first.paymentId,
      "Importe mal capturado",
    );
    expect(reversed).toMatchObject({ ok: true });
    if (!reversed.ok) return;
    expect(reversed.validUntil.toISOString()).toBe("2026-12-01T05:59:59.999Z");
    expect(new Set(await ends(org))).toEqual(
      new Set(["2026-12-01T05:59:59.999Z"]),
    );
    expect(
      await reverseManualPayment(staff, org, first.paymentId, "Otra vez igual"),
    ).toMatchObject({ ok: false, formError: "Ese pago ya está anulado." });

    const again = await recordManualPayment(
      staff,
      org,
      payment({ reference: "FIX-1", amount: "1000", months: 3 }),
    );
    expect(again.ok).toBe(true);

    const rows = await listManualPayments(org);
    expect(rows.map((r) => [r.kind, r.amount, r.reversed])).toEqual([
      ["PAYMENT", "1000.00", false],
      ["REVERSAL", "100.00", false],
      ["PAYMENT", "100.00", true],
    ]);
    const event = await db.auditEvent.findFirstOrThrow({
      where: { organizationId: org, action: "payment.reversed" },
    });
    expect(event).toMatchObject({
      actorUserId: staff,
      reason: "Importe mal capturado",
    });
  });

  it("reversing an older payment takes its months from the current end", async () => {
    const { org } = await companyWithPlan(new Date("2026-12-01T05:59:59.999Z"));
    const older = await recordManualPayment(staff, org, payment({ months: 1 }));
    const newer = await recordManualPayment(staff, org, payment({ months: 2 }));
    if (!older.ok || !newer.ok) throw new Error("payment failed");
    expect(newer.validUntil.toISOString()).toBe("2027-03-01T05:59:59.999Z");
    const reversed = await reverseManualPayment(
      staff,
      org,
      older.paymentId,
      "Era de otra empresa",
    );
    expect(reversed.ok && reversed.validUntil.toISOString()).toBe(
      "2027-01-29T05:59:59.999Z",
    );
  });

  it("a payment of another company is not found", async () => {
    const a = await companyWithPlan();
    const b = await companyWithPlan();
    const paid = await recordManualPayment(staff, a.org, payment());
    if (!paid.ok) throw new Error("payment failed");
    expect(
      await reverseManualPayment(
        staff,
        b.org,
        paid.paymentId,
        "Desde otra empresa",
      ),
    ).toMatchObject({ ok: false, formError: "Ese pago no existe." });
    expect(await listManualPayments(b.org)).toEqual([]);
  });
});
