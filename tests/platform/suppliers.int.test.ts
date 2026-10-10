import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  createSupplier,
  getSupplier,
  listSuppliers,
  normalizeRfc,
  updateSupplier,
  type ContactActor,
} from "@/platform/contacts";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// CMP-02: creating, editing and finding suppliers. The RFC is optional
// and checked in its shape; likely duplicates are warned, not refused.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `proveedores.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(
  modules: string[] = ["inventory", "purchasing"],
): Promise<ContactActor> {
  const owner = await newUser();
  const created = await createOrganization(owner, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  if (!staff) {
    staff = await newUser();
    await db.platformStaff.create({ data: { userId: staff } });
  }
  const result = await provisionCompany(
    moduleRegistry,
    staff,
    created.organizationId,
    {
      productLimit: 20,
      users: 10,
      modules,
      validUntil: null,
      reason: "Prueba de proveedores",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function member(organizationId: string, role: Role) {
  const userId = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId };
}

async function supplier(actor: ContactActor, name: string, rfc = "") {
  const created = await createSupplier(actor, { name, rfc });
  if (!created.ok) throw new Error(`supplier setup failed: ${created.reason}`);
  return created.supplierId;
}

const audits = (actor: ContactActor, action: string) =>
  db.auditEvent.findMany({
    where: { organizationId: actor.organizationId, action },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("normalizeRfc", () => {
  it("accepts a real RFC however it is typed, and stores it clean", () => {
    expect(normalizeRfc("FNO010203AB1")).toBe("FNO010203AB1");
    expect(normalizeRfc(" fno-010203-ab1 ")).toBe("FNO010203AB1");
    expect(normalizeRfc("mell 800101 ab2")).toBe("MELL800101AB2");
    expect(normalizeRfc("ÑU&010203AB1")).toBe("ÑU&010203AB1");
    expect(normalizeRfc("XAXX010101000")).toBe("XAXX010101000");
    // 29 February exists in some years; the RFC only keeps two digits.
    expect(normalizeRfc("FNO000229AB1")).toBe("FNO000229AB1");
  });

  it("refuses what cannot be an RFC", () => {
    for (const text of [
      "",
      "FNO010203AB",
      "FNO010203AB12X",
      "F1O010203AB1",
      "FNO011303AB1",
      "FNO010232AB1",
      "FNO010431AB1",
      "FNO01A203AB1",
      "FNO010203AB!",
    ]) {
      expect(normalizeRfc(text), `«${text}»`).toBeNull();
    }
  });
});

describe("createSupplier", () => {
  it("saves the whole card, as a supplier of the company", async () => {
    const actor = await company();
    const created = await createSupplier(actor, {
      name: "  Ferretera del Norte  ",
      legalName: "Ferretera del Norte, S.A. de C.V.",
      rfc: "fno-010203-ab1",
      contactPerson: "Laura Méndez",
      email: "Ventas@FerreteraNorte.example",
      phone: "81 5555 0101",
      address: "Av. Industria 100, Monterrey, N.L.",
      notes: "Surte los martes.\nPide factura.",
    });
    if (!created.ok) throw new Error("not created");
    expect(await getSupplier(actor, created.supplierId)).toMatchObject({
      name: "Ferretera del Norte",
      legalName: "Ferretera del Norte, S.A. de C.V.",
      rfc: "FNO010203AB1",
      contactPerson: "Laura Méndez",
      email: "ventas@ferreteranorte.example",
      phone: "81 5555 0101",
      address: "Av. Industria 100, Monterrey, N.L.",
      notes: "Surte los martes.\nPide factura.",
      isCustomer: false,
      archived: false,
    });
    expect(
      await db.contact.findUniqueOrThrow({ where: { id: created.supplierId } }),
    ).toMatchObject({
      organizationId: actor.organizationId,
      isSupplier: true,
      isCustomer: false,
      createdByUserId: actor.userId,
    });
    const [event] = await audits(actor, "supplier.created");
    expect(event).toMatchObject({
      actorUserId: actor.userId,
      targetId: created.supplierId,
      metadata: { nombre: "Ferretera del Norte", rfc: "FNO010203AB1" },
    });
  });

  it("only the name is required; an empty RFC is no RFC", async () => {
    const actor = await company();
    const created = await createSupplier(actor, {
      name: "Don Pepe",
      rfc: "  ",
    });
    if (!created.ok) throw new Error("not created");
    expect(await getSupplier(actor, created.supplierId)).toMatchObject({
      name: "Don Pepe",
      rfc: null,
      email: null,
      phone: null,
    });
  });

  it("says what is wrong, field by field, and saves nothing", async () => {
    const actor = await company();
    const result = await createSupplier(actor, {
      name: "X",
      rfc: "FNO011303AB1",
      email: "no-es-correo",
      phone: "1".repeat(41),
      contactPerson: "Con\ttabulador",
    });
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    if (result.ok || result.reason !== "invalid") throw new Error("expected");
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      "contactPerson",
      "email",
      "name",
      "phone",
      "rfc",
    ]);
    expect(result.fieldErrors.rfc).toContain("no tiene la forma correcta");
    expect(
      await db.contact.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  });
});

describe("likely duplicates are warned, not refused", () => {
  it("the same RFC or the same name stops the first attempt", async () => {
    const actor = await company();
    const first = await supplier(actor, "Ferretera del Norte", "FNO010203AB1");

    const sameRfc = await createSupplier(actor, {
      name: "Otra razón social",
      rfc: "fno 010203 ab1",
    });
    expect(sameRfc).toEqual({
      ok: false,
      reason: "duplicate",
      fieldErrors: {},
      duplicates: [
        {
          id: first,
          name: "Ferretera del Norte",
          rfc: "FNO010203AB1",
          isSupplier: true,
          archived: false,
          match: "rfc",
        },
      ],
    });
    // The same name, whatever its capitals or accents.
    expect(
      await createSupplier(actor, { name: "FERRETERA DEL NÓRTE" }),
    ).toMatchObject({
      ok: false,
      reason: "duplicate",
      duplicates: [{ id: first, match: "name" }],
    });
    expect(
      await db.contact.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(1);

    // The person says it is another one: it is saved.
    const accepted = await createSupplier(
      actor,
      { name: "Ferretera del Norte", rfc: "FNO010203AB1" },
      { acceptDuplicates: true },
    );
    expect(accepted.ok).toBe(true);
    expect(
      await db.contact.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(2);
    // Something that only resembles it is not a duplicate.
    expect(
      (await createSupplier(actor, { name: "Ferretera del Sur" })).ok,
    ).toBe(true);
  });

  it("a contact that is only a customer, or archived, is also shown", async () => {
    const actor = await company();
    const customer = await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Constructora Río",
        rfc: "CRI010203AB1",
        isCustomer: true,
        archivedAt: new Date(),
        createdByUserId: actor.userId,
      },
    });
    expect(
      await createSupplier(actor, {
        name: "Constructora Río SA",
        rfc: "CRI010203AB1",
      }),
    ).toMatchObject({
      reason: "duplicate",
      duplicates: [
        { id: customer.id, isSupplier: false, archived: true, match: "rfc" },
      ],
    });
  });

  it("what another company has is never a duplicate here", async () => {
    const ours = await company();
    const theirs = await company();
    await supplier(theirs, "Ferretera del Norte", "FNO010203AB1");
    expect(
      (
        await createSupplier(ours, {
          name: "Ferretera del Norte",
          rfc: "FNO010203AB1",
        })
      ).ok,
    ).toBe(true);
  });
});

describe("updateSupplier", () => {
  it("changes the card and writes down which fields changed", async () => {
    const actor = await company();
    const id = await supplier(actor, "Ferretera del Norte", "FNO010203AB1");
    expect(
      await updateSupplier(actor, id, {
        name: "Ferretera del Norte",
        rfc: "FNO010203AB1",
        phone: "81 5555 0202",
        contactPerson: "Laura",
      }),
    ).toEqual({ ok: true, supplierId: id });
    expect(await getSupplier(actor, id)).toMatchObject({
      phone: "81 5555 0202",
      contactPerson: "Laura",
      rfc: "FNO010203AB1",
    });
    const [event] = await audits(actor, "supplier.updated");
    expect(event).toMatchObject({
      targetId: id,
      metadata: { cambios: "Persona de contacto, Teléfono" },
    });

    // Saving the same again changes nothing and leaves no trace.
    await updateSupplier(actor, id, {
      name: "Ferretera del Norte",
      rfc: "fno010203ab1",
      phone: "81 5555 0202",
      contactPerson: "Laura",
    });
    expect(await audits(actor, "supplier.updated")).toHaveLength(1);
    // An emptied field is erased.
    await updateSupplier(actor, id, { name: "Ferretera del Norte" });
    expect(await getSupplier(actor, id)).toMatchObject({
      rfc: null,
      phone: null,
      contactPerson: null,
    });
  });

  it("warns when the new name or RFC is the one of another contact", async () => {
    const actor = await company();
    const norte = await supplier(actor, "Ferretera del Norte", "FNO010203AB1");
    const sur = await supplier(actor, "Ferretera del Sur");

    expect(
      await updateSupplier(actor, sur, {
        name: "Ferretera del Sur",
        rfc: "FNO010203AB1",
      }),
    ).toMatchObject({
      ok: false,
      reason: "duplicate",
      duplicates: [{ id: norte, match: "rfc" }],
    });
    expect((await getSupplier(actor, sur))!.rfc).toBeNull();
    // Its own name is not a duplicate of itself, and other fields do not ask.
    expect(
      (
        await updateSupplier(actor, norte, {
          name: "Ferretera del Norte",
          rfc: "FNO010203AB1",
          notes: "Nueva nota",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await updateSupplier(
          actor,
          sur,
          { name: "Ferretera del Sur", rfc: "FNO010203AB1" },
          { acceptDuplicates: true },
        )
      ).ok,
    ).toBe(true);
    expect((await getSupplier(actor, sur))!.rfc).toBe("FNO010203AB1");
  });

  it("reaches only suppliers of the company", async () => {
    const ours = await company();
    const theirs = await company();
    const foreign = await supplier(theirs, "Ajeno");
    const customer = await db.contact.create({
      data: {
        id: newId(),
        organizationId: ours.organizationId,
        name: "Solo cliente",
        isCustomer: true,
        createdByUserId: ours.userId,
      },
    });
    for (const id of [foreign, customer.id, newId(), "no-es-un-id"]) {
      expect(await getSupplier(ours, id), id).toBeNull();
      expect(
        await updateSupplier(ours, id, { name: "Cambiado" }),
      ).toMatchObject({ ok: false, reason: "not_found" });
    }
    expect((await getSupplier(theirs, foreign))!.name).toBe("Ajeno");
    expect(
      (await db.contact.findUniqueOrThrow({ where: { id: customer.id } })).name,
    ).toBe("Solo cliente");
  });
});

describe("listSuppliers", () => {
  it("lists by name, a page at a time, and finds by name or RFC", async () => {
    const actor = await company();
    await supplier(actor, "Tornillos y Más", "TMA010203AB1");
    await supplier(actor, "Aceros del Bajío", "ABA050607CD2");
    await supplier(actor, "Ferretera del Norte", "FNO010203AB1");
    await supplier(actor, "Ferretera del Sur");
    await supplier(actor, "100% Herramienta");
    const archived = await supplier(actor, "Ya no surte");
    await db.contact.update({
      where: { id: archived },
      data: { archivedAt: new Date() },
    });
    await db.contact.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        name: "Cliente Ferretera",
        isCustomer: true,
        createdByUserId: actor.userId,
      },
    });

    const all = await listSuppliers(actor);
    expect(all.items.map((item) => item.name)).toEqual([
      "100% Herramienta",
      "Aceros del Bajío",
      "Ferretera del Norte",
      "Ferretera del Sur",
      "Tornillos y Más",
    ]);
    expect(all).toMatchObject({ total: 5, page: 1, pageCount: 1, search: "" });

    const names = async (search: string) =>
      (await listSuppliers(actor, { search })).items.map((item) => item.name);
    expect(await names("ferretera")).toEqual([
      "Ferretera del Norte",
      "Ferretera del Sur",
    ]);
    expect(await names("  norte   FERRETERA ")).toEqual([
      "Ferretera del Norte",
    ]);
    expect(await names("bajio")).toEqual(["Aceros del Bajío"]);
    expect(await names("ABA0506")).toEqual(["Aceros del Bajío"]);
    expect(await names("no existe")).toEqual([]);
    // Wildcards are text, not patterns.
    expect(await names("%")).toEqual(["100% Herramienta"]);
    expect(await names("_")).toEqual([]);

    const second = await listSuppliers(actor, { pageSize: 2, page: 2 });
    expect(second.items.map((item) => item.name)).toEqual([
      "Ferretera del Norte",
      "Ferretera del Sur",
    ]);
    expect(second).toMatchObject({ total: 5, page: 2, pageCount: 3 });
    // A page past the end is the last one.
    expect(
      (await listSuppliers(actor, { pageSize: 2, page: 99 })).items.map(
        (item) => item.name,
      ),
    ).toEqual(["Tornillos y Más"]);
  });

  it("each company lists its own", async () => {
    const ours = await company();
    const theirs = await company();
    await supplier(ours, "Nuestro");
    await supplier(theirs, "De ellos");
    expect((await listSuppliers(ours)).items.map((item) => item.name)).toEqual([
      "Nuestro",
    ]);
    expect((await listSuppliers(ours, { search: "ellos" })).items).toEqual([]);
  });
});

describe("who may", () => {
  it("follows the matrix: Compras and administrators edit; Consulta only reads; Almacén neither", async () => {
    const actor = await company();
    const id = await supplier(actor, "Ferretera del Norte");
    const can = async (person: ContactActor) => ({
      read: await listSuppliers(person).then(
        () => true,
        () => false,
      ),
      create: await createSupplier(person, { name: `Nuevo ${newId()}` }).then(
        (result) => result.ok,
        () => false,
      ),
      update: await updateSupplier(person, id, {
        name: "Ferretera del Norte",
        notes: `Nota ${newId()}`,
      }).then(
        (result) => result.ok,
        () => false,
      ),
    });
    const all = { read: true, create: true, update: true };
    expect(await can(actor)).toEqual(all);
    expect(
      await can(await member(actor.organizationId, "administrator")),
    ).toEqual(all);
    expect(await can(await member(actor.organizationId, "buyer"))).toEqual(all);
    expect(await can(await member(actor.organizationId, "viewer"))).toEqual({
      read: true,
      create: false,
      update: false,
    });
    expect(await can(await member(actor.organizationId, "warehouse"))).toEqual({
      read: false,
      create: false,
      update: false,
    });
    await expect(
      createSupplier(await member(actor.organizationId, "viewer"), {
        name: "Colado",
      }),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("needs the Compras module: without it nobody reaches suppliers", async () => {
    const actor = await company(["inventory"]);
    await expect(listSuppliers(actor)).rejects.toMatchObject({
      kind: "forbidden",
    });
    await expect(
      createSupplier(actor, { name: "Sin módulo" }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    expect(
      await db.contact.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(0);
  });
});
