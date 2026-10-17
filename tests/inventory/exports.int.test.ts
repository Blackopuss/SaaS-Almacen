import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  buildExport,
  registerEntry,
  registerExit,
  setMinimum,
  type ExportFormat,
  type ExportKind,
  type InventoryActor,
} from "@/modules/inventory";
import { moduleRegistry } from "@/modules/registry";
import { provisionCompany } from "@/platform/billing";
import {
  archiveProduct,
  createPresentation,
  createProduct,
} from "@/platform/catalog";
import { invalidateEntitlements } from "@/platform/entitlements";
import { readSpreadsheet } from "@/platform/files";
import { createLocation } from "@/platform/locations";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-11: safe export. Cells protected against formulas; only for people
// with the permission, and only rows of their own company.

type Role = "administrator" | "warehouse" | "buyer" | "viewer";

const stamp = Date.now();
let counter = 0;
let staff = "";

async function newUser(name = "Persona") {
  const user = await db.user.create({
    data: {
      id: newId(),
      name,
      email: `exportar.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<InventoryActor> {
  const owner = await newUser("Olga Titular");
  const created = await createOrganization(owner, {
    name: `Ferretería ${counter}`,
    timeZone: "America/Mexico_City",
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
      productLimit: 50,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de exportación",
    },
  );
  if (!result.ok) throw new Error("provision failed");
  return { organizationId: created.organizationId, userId: owner };
}

async function member(organizationId: string, role: Role | null) {
  const userId = await newUser();
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  if (role) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return { organizationId, userId };
}

async function product(
  actor: InventoryActor,
  input: Parameters<typeof createProduct>[1],
) {
  const created = await createProduct(actor, input);
  if (!created.ok) throw new Error("product setup failed");
  return created.productId;
}

/** The export, read back as the rows a person would see on opening it. */
async function exported(
  actor: InventoryActor,
  kind: ExportKind,
  format: ExportFormat,
  range: { from?: string; to?: string } = {},
) {
  const result = await buildExport(actor, { kind, format, ...range });
  if (!result.ok) throw new Error(result.error);
  const read = readSpreadsheet(result.name, result.bytes);
  if (!read.ok) throw new Error(read.error);
  // The reader drops empty cells at the end of a row: put them back.
  const width = read.rows[0]?.length ?? 0;
  const table = read.rows.map((row) => [
    ...row,
    ...Array.from({ length: Math.max(0, width - row.length) }, () => ""),
  ]);
  return { ...result, table };
}

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("what each export contains", () => {
  it("the catalog: every product, active or archived, with its minimum", async () => {
    const actor = await company();
    const tornillo = await product(actor, {
      sku: "TOR-1",
      name: "Tornillo hexagonal",
      description: "Galvanizado",
      category: "Tornillería",
      brand: "Fiero",
      barcode: "750100",
    });
    await product(actor, { sku: "CAB-2", name: "Cable THW", unit: "m" });
    const viejo = await product(actor, { sku: "VIE-3", name: "Viejo" });
    await archiveProduct(actor, viejo);
    await setMinimum(actor, { productId: tornillo, quantity: "200" });

    for (const format of ["xlsx", "csv"] as const) {
      const file = await exported(actor, "catalogo", format);
      expect(file.rows).toBe(3);
      expect(file.name).toMatch(
        new RegExp(`^catalogo-\\d{4}-\\d{2}-\\d{2}\\.${format}$`),
      );
      expect(file.table, format).toEqual([
        [
          "Clave (SKU)",
          "Nombre",
          "Descripción",
          "Categoría",
          "Marca",
          "Código de barras",
          "Unidad",
          "Estado",
          "Mínimo",
        ],
        ["CAB-2", "Cable THW", "", "", "", "", "metro", "Activo", ""],
        [
          "TOR-1",
          "Tornillo hexagonal",
          "Galvanizado",
          "Tornillería",
          "Fiero",
          "750100",
          "pieza",
          "Activo",
          "200",
        ],
        ["VIE-3", "Viejo", "", "", "", "", "pieza", "Archivado", ""],
      ]);
    }
  });

  it("stock: what there is in each location, with exact decimals", async () => {
    const actor = await company();
    const zone = await createLocation(actor, { name: "Zona A", kind: "ZONE" });
    if (!zone.ok) throw new Error("zone setup failed");
    const made = await createLocation(actor, {
      name: "Estante 3",
      kind: "SHELF",
      parentId: zone.locationId,
    });
    if (!made.ok) throw new Error("shelf setup failed");
    const cable = await product(actor, {
      sku: "CAB-2",
      name: "Cable THW",
      unit: "m",
    });
    const tornillo = await product(actor, { sku: "TOR-1", name: "Tornillo" });
    await product(actor, { sku: "SIN-9", name: "Sin existencias" });
    await registerEntry(actor, { productId: cable, quantity: "12.5" });
    await registerEntry(actor, { productId: cable, quantity: "0.1" });
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "300",
      locationId: made.locationId,
    });
    // What went back to zero is not listed.
    await registerEntry(actor, { productId: tornillo, quantity: "5" });
    await registerExit(actor, { productId: tornillo, quantity: "5" });

    for (const format of ["xlsx", "csv"] as const) {
      expect((await exported(actor, "existencias", format)).table).toEqual([
        ["Clave (SKU)", "Producto", "Ubicación", "Cantidad", "Unidad"],
        ["CAB-2", "Cable THW", "General", "12.6", "metro"],
        ["TOR-1", "Tornillo", "Zona A › Estante 3", "300", "pieza"],
      ]);
    }
  });

  it("the history: one row per line, with who, why and how it was captured", async () => {
    const actor = await company();
    const tornillo = await product(actor, { sku: "TOR-1", name: "Tornillo" });
    const caja = await createPresentation(actor, tornillo, {
      name: "Caja",
      factor: "100",
    });
    if (!caja.ok) throw new Error("presentation setup failed");
    await registerEntry(actor, {
      productId: tornillo,
      quantity: "3",
      presentationId: caja.presentationId,
      reference: "Factura 88",
    });
    await registerExit(actor, {
      productId: tornillo,
      quantity: "25",
      reason: "Venta de mostrador",
    });

    const file = await exported(actor, "movimientos", "xlsx");
    expect(file.rows).toBe(2);
    expect(file.table[0]).toEqual([
      "Fecha y hora",
      "Tipo",
      "Clave (SKU)",
      "Producto",
      "Ubicación",
      "Sentido",
      "Cantidad",
      "Unidad",
      "Capturado",
      "Capturado en",
      "Motivo",
      "Referencia",
      "Quién",
    ]);
    const [entry, exit] = file.table.slice(1);
    expect(entry![0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(entry!.slice(1)).toEqual([
      "Entrada",
      "TOR-1",
      "Tornillo",
      "General",
      "Entrada",
      "300",
      "pieza",
      "3",
      "Caja",
      "",
      "Factura 88",
      "Olga Titular",
    ]);
    expect(exit!.slice(1)).toEqual([
      "Salida",
      "TOR-1",
      "Tornillo",
      "General",
      "Salida",
      "25",
      "pieza",
      "",
      "",
      "Venta de mostrador",
      "",
      "Olga Titular",
    ]);
    expect((await exported(actor, "movimientos", "csv")).table).toEqual(
      file.table,
    );
  });

  it("the history can be cut by days of the company's calendar", async () => {
    const actor = await company();
    const tornillo = await product(actor, { sku: "TOR-1", name: "Tornillo" });
    await registerEntry(actor, { productId: tornillo, quantity: "10" });
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Mexico_City",
    }).format(new Date());
    const day = (offset: number) => {
      const date = new Date(`${today}T12:00:00.000Z`);
      date.setUTCDate(date.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    };
    const rows = async (range: { from?: string; to?: string }) =>
      (await exported(actor, "movimientos", "csv", range)).rows;
    expect(await rows({ from: today, to: today })).toBe(1);
    expect(await rows({ from: day(-7) })).toBe(1);
    expect(await rows({ to: day(-1) })).toBe(0);
    expect(await rows({ from: day(1) })).toBe(0);

    expect(
      await buildExport(actor, {
        kind: "movimientos",
        format: "csv",
        from: "09/10/2026",
      }),
    ).toMatchObject({ ok: false, reason: "dates" });
    expect(
      await buildExport(actor, {
        kind: "movimientos",
        format: "csv",
        from: today,
        to: day(-1),
      }),
    ).toMatchObject({ ok: false, reason: "dates" });
  });
});

describe("cells are protected against formulas", () => {
  it("text a spreadsheet would run arrives as plain text, in CSV and Excel", async () => {
    const actor = await company();
    const evil = await product(actor, {
      sku: "+SUMA(A1)",
      name: '=HYPERLINK("http://malo.example","Ver")',
      description: "@SUM(1+1)*cmd|' /C calc'!A0",
      category: "-2+3",
      brand: "\t=1+1",
    });
    await registerEntry(actor, {
      productId: evil,
      quantity: "1",
      reference: "=cmd|' /C notepad'!A1",
    });
    await registerExit(actor, {
      productId: evil,
      quantity: "1",
      reason: "-1+1",
    });

    for (const kind of ["catalogo", "movimientos"] as const) {
      for (const format of ["xlsx", "csv"] as const) {
        const file = await exported(actor, kind, format);
        const cells = file.table.slice(1).flat();
        const risky = cells.filter((cell) => /^[=+\-@\t\r]/.test(cell));
        expect(risky, `${kind}.${format}`).toEqual([]);
        // The text is all there, behind an apostrophe.
        expect(cells, `${kind}.${format}`).toContain("'+SUMA(A1)");
        expect(cells, `${kind}.${format}`).toContain(
          `'=HYPERLINK("http://malo.example","Ver")`,
        );
      }
    }
    const csv = await buildExport(actor, { kind: "catalogo", format: "csv" });
    const text = csv.ok ? csv.bytes.toString("utf8") : "";
    // No field of the raw file starts a formula either.
    for (const line of text.split("\r\n").slice(1)) {
      for (const field of line.split(",")) {
        expect(field.replace(/^"/, ""), line).not.toMatch(/^[=+\-@]/);
      }
    }
    const history = await exported(actor, "movimientos", "csv");
    expect(history.table.flat()).toEqual(
      expect.arrayContaining(["'=cmd|' /C notepad'!A1", "'-1+1"]),
    );
  });
});

describe("only who may, and only their company", () => {
  it("every role exports; a person without a role, or of another company, does not", async () => {
    const actor = await company();
    await product(actor, { sku: "TOR-1", name: "Tornillo" });
    for (const role of [
      "administrator",
      "warehouse",
      "buyer",
      "viewer",
    ] as const) {
      const person = await member(actor.organizationId, role);
      for (const kind of ["catalogo", "existencias", "movimientos"] as const) {
        expect(
          (await buildExport(person, { kind, format: "csv" })).ok,
          `${role} ${kind}`,
        ).toBe(true);
      }
    }
    const noRole = await member(actor.organizationId, null);
    const stranger = {
      organizationId: actor.organizationId,
      userId: await newUser(),
    };
    for (const person of [noRole, stranger]) {
      for (const kind of ["catalogo", "existencias", "movimientos"] as const) {
        await expect(
          buildExport(person, { kind, format: "xlsx" }),
        ).rejects.toMatchObject({ kind: "forbidden" });
      }
    }
  });

  it("a company never receives rows of another", async () => {
    const ours = await company();
    const theirs = await company();
    const mine = await product(ours, { sku: "NUESTRO-1", name: "Nuestro" });
    const other = await product(theirs, { sku: "AJENO-1", name: "Ajeno" });
    await registerEntry(ours, { productId: mine, quantity: "4" });
    await registerEntry(theirs, { productId: other, quantity: "9" });

    for (const kind of ["catalogo", "existencias", "movimientos"] as const) {
      const cells = (await exported(ours, kind, "csv")).table.flat();
      expect(cells, kind).toContain("NUESTRO-1");
      expect(cells, kind).not.toContain("AJENO-1");
      expect(cells.join("|"), kind).not.toContain("Ajeno");
    }
    // Asking with our account for their company is refused outright.
    await expect(
      buildExport(
        { organizationId: theirs.organizationId, userId: ours.userId },
        { kind: "catalogo", format: "csv" },
      ),
    ).rejects.toMatchObject({ kind: "forbidden" });
  });

  it("stays available with the plan expired: exporting changes nothing", async () => {
    const actor = await company();
    const tornillo = await product(actor, { sku: "TOR-1", name: "Tornillo" });
    await registerEntry(actor, { productId: tornillo, quantity: "4" });
    const DAY = 24 * 60 * 60 * 1000;
    await db.entitlement.updateMany({
      where: { organizationId: actor.organizationId },
      data: {
        validFrom: new Date(Date.now() - 2 * DAY),
        validUntil: new Date(Date.now() - DAY),
      },
    });
    invalidateEntitlements(actor.organizationId);
    // Writing is closed…
    await expect(
      registerEntry(actor, { productId: tornillo, quantity: "1" }),
    ).rejects.toMatchObject({ kind: "forbidden" });
    // …but the data can still be taken out.
    for (const kind of ["catalogo", "existencias", "movimientos"] as const) {
      expect((await exported(actor, kind, "xlsx")).rows, kind).toBe(1);
    }
  });

  it("each export is written down in the audit trail", async () => {
    const actor = await company();
    await product(actor, { sku: "TOR-1", name: "Tornillo" });
    await product(actor, { sku: "TOR-2", name: "Tuerca" });
    await exported(actor, "catalogo", "xlsx");
    const events = await db.auditEvent.findMany({
      where: {
        organizationId: actor.organizationId,
        action: "inventory.export_created",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorUserId: actor.userId,
      targetType: "export",
      targetId: "catalogo",
      metadata: {
        contenido: "Catálogo de productos",
        formato: "xlsx",
        filas: 2,
      },
    });
  });
});
