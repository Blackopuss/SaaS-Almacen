import { afterAll, afterEach, describe, expect, it } from "vitest";

import { ForbiddenError, newId } from "@/lib";
import { listAuditTrail } from "@/platform/audit";
import {
  createCustomer,
  findCustomers,
  getCustomer,
} from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { db } from "@/server";

import { salesCompany, salesMember } from "../setup/sales";

// VEN-08 (ADR 0016, 0030): customers are the customer facet of the shared
// contacts; the counter looks them up and registers new ones.

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("customers", () => {
  it("the cashier registers a customer and finds it by name, phone or RFC", async () => {
    const actor = await salesCompany();
    const cajero = await salesMember(actor.organizationId, "cashier");
    const created = await createCustomer(cajero, {
      name: "Constructora Robles",
      phone: "81 1234 5678",
      rfc: "cro-010203-ab1",
    });
    expect(created).toMatchObject({
      ok: true,
      customer: {
        name: "Constructora Robles",
        phone: "81 1234 5678",
        rfc: "CRO010203AB1",
      },
    });
    if (!created.ok) return;
    for (const search of ["robles", "1234", "CRO0102", "constructora robles"]) {
      expect(
        (await findCustomers(cajero, search)).map((row) => row.id),
        search,
      ).toEqual([created.customer.id]);
    }
    expect(await getCustomer(cajero, created.customer.id)).toEqual(
      created.customer,
    );
    const trail = await listAuditTrail(actor.organizationId, { limit: 5 });
    expect(trail.map((entry) => entry.label)).toContain("Registró un cliente");
  });

  it("warns about a customer with the same name before saving another", async () => {
    const actor = await salesCompany();
    const first = await createCustomer(actor, { name: "Juan Pérez" });
    if (!first.ok) throw new Error("setup failed");
    expect(await createCustomer(actor, { name: "juan perez" })).toMatchObject({
      ok: false,
      reason: "duplicate",
      duplicates: [{ id: first.customer.id }],
    });
    expect(
      await createCustomer(
        actor,
        { name: "Juan Pérez" },
        { acceptDuplicates: true },
      ),
    ).toMatchObject({ ok: true });
    expect(
      await createCustomer(actor, { name: "J", rfc: "nada" }),
    ).toMatchObject({
      ok: false,
      reason: "invalid",
      fieldErrors: { name: expect.any(String), rfc: expect.any(String) },
    });
  });

  it("a contact that is only a supplier is not a customer", async () => {
    const actor = await salesCompany();
    const supplier = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Aceros del Norte",
        isSupplier: true,
        createdByUserId: actor.userId,
      },
    });
    expect(await findCustomers(actor, "aceros")).toEqual([]);
    expect(await getCustomer(actor, supplier.id)).toBeNull();
  });

  it("does not reach another company's customers", async () => {
    const actor = await salesCompany();
    const other = await salesCompany();
    const theirs = await createCustomer(other, { name: "Cliente Ajeno" });
    if (!theirs.ok) throw new Error("setup failed");
    expect(await findCustomers(actor, "ajeno")).toEqual([]);
    expect(await getCustomer(actor, theirs.customer.id)).toBeNull();
  });

  it("whoever only looks finds customers but does not register them", async () => {
    const actor = await salesCompany();
    const consulta = await salesMember(actor.organizationId, "viewer");
    expect(await findCustomers(consulta, "x")).toEqual([]);
    await expect(
      createCustomer(consulta, { name: "Nuevo" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const almacen = await salesMember(actor.organizationId, "warehouse");
    await expect(findCustomers(almacen, "x")).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
