import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  CONTACT_FACETS,
  CONTACT_FACET_LABELS,
  isContactFacet,
} from "@/platform/contacts";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// CMP-01: shared contacts in the core. A contact is a supplier, a
// customer or both, and belongs to one company.

const stamp = Date.now();
let counter = 0;

async function newCompany() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `contacto.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(user.id, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  return { organizationId: created.organizationId, userId: user.id };
}

let a = { organizationId: "", userId: "" };
let b = { organizationId: "", userId: "" };

const contact = (
  owner: { organizationId: string; userId: string },
  extra: Record<string, unknown> = {},
) => ({
  id: newId(),
  organizationId: owner.organizationId,
  name: "Ferretera del Norte",
  isSupplier: true,
  createdByUserId: owner.userId,
  ...extra,
});

beforeAll(async () => {
  a = await newCompany();
  b = await newCompany();
});

afterAll(() => db.$disconnect());

describe("contact", () => {
  it("stores the whole card of a supplier", async () => {
    const created = await forOrganization(a.organizationId).contact.create({
      data: contact(a, {
        legalName: "Ferretera del Norte, S.A. de C.V.",
        rfc: "FNO010203AB1",
        contactPerson: "Laura Méndez",
        email: "ventas@ferreteranorte.example",
        phone: "81 5555 0101",
        address: "Av. Industria 100, Monterrey, N.L.",
        notes: "Surte los martes.",
      }),
    });
    expect(created).toMatchObject({
      name: "Ferretera del Norte",
      rfc: "FNO010203AB1",
      isSupplier: true,
      isCustomer: false,
      archivedAt: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("is a supplier, a customer or both — never neither", async () => {
    const client = forOrganization(a.organizationId);
    for (const facets of [
      { isSupplier: true, isCustomer: false },
      { isSupplier: false, isCustomer: true },
      { isSupplier: true, isCustomer: true },
    ]) {
      await expect(
        client.contact.create({ data: contact(a, facets) }),
      ).resolves.toMatchObject(facets);
    }
    await expect(
      client.contact.create({
        data: contact(a, { isSupplier: false, isCustomer: false }),
      }),
    ).rejects.toThrow(/contact_facet_check/);
    // Nor by taking away its last facet afterwards.
    const only = await client.contact.create({ data: contact(a) });
    await expect(
      client.contact.updateMany({
        where: { id: only.id },
        data: { isSupplier: false },
      }),
    ).rejects.toThrow(/contact_facet_check/);
    await expect(
      client.contact.updateMany({
        where: { id: only.id },
        data: { isSupplier: false, isCustomer: true },
      }),
    ).resolves.toEqual({ count: 1 });
  });

  it("needs a name, and an RFC — when it has one — in its real shape", async () => {
    const client = forOrganization(a.organizationId);
    await expect(
      client.contact.create({ data: contact(a, { name: "   " }) }),
    ).rejects.toThrow(/contact_name_check/);
    for (const rfc of ["FNO010203AB1", "MELL800101AB2", "ÑU&010203AB1"]) {
      await expect(
        client.contact.create({ data: contact(a, { rfc }) }),
        rfc,
      ).resolves.toMatchObject({ rfc });
    }
    for (const rfc of [
      "",
      "fno010203ab1",
      "FNO 010203AB1",
      "FNO010203AB",
      "FNO01020EAB1",
      "12345",
    ]) {
      await expect(
        client.contact.create({ data: contact(a, { rfc }) }),
        `«${rfc}»`,
      ).rejects.toThrow(/contact_rfc_check/);
    }
  });

  it("the same business can be captured in two companies, each with its own row", async () => {
    const ours = await forOrganization(a.organizationId).contact.create({
      data: contact(a, { name: "Proveedor compartido", rfc: "PCO010203AB1" }),
    });
    const theirs = await forOrganization(b.organizationId).contact.create({
      data: contact(b, { name: "Proveedor compartido", rfc: "PCO010203AB1" }),
    });
    expect(ours.id).not.toBe(theirs.id);
  });

  it("a company never sees, changes or deletes the contacts of another", async () => {
    const mine = await forOrganization(a.organizationId).contact.create({
      data: contact(a, { name: "Solo de A" }),
    });
    const other = forOrganization(b.organizationId);
    expect(
      await other.contact.findFirst({ where: { id: mine.id } }),
    ).toBeNull();
    expect(
      await other.contact.findMany({ where: { name: "Solo de A" } }),
    ).toEqual([]);
    expect(
      await other.contact.updateMany({
        where: { id: mine.id },
        data: { name: "Cambiado" },
      }),
    ).toEqual({ count: 0 });
    expect(await other.contact.deleteMany({ where: { id: mine.id } })).toEqual({
      count: 0,
    });
    // And cannot create one inside another company.
    await expect(
      other.contact.create({ data: contact(a, { name: "Colado" }) }),
    ).rejects.toThrow();
    expect(
      await forOrganization(a.organizationId).contact.findFirst({
        where: { id: mine.id },
      }),
    ).toMatchObject({ name: "Solo de A" });
  });

  it("names the facets a contact can have", () => {
    expect(CONTACT_FACETS).toEqual(["supplier", "customer"]);
    expect(CONTACT_FACET_LABELS).toEqual({
      supplier: "Proveedor",
      customer: "Cliente",
    });
    expect(isContactFacet("supplier")).toBe(true);
    expect(isContactFacet("prospect")).toBe(false);
  });
});
