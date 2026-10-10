import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { invalidateEntitlements } from "@/platform/entitlements";
import {
  FILE_LINK_SECONDS,
  createFileLink,
  deleteFile,
  openFileLink,
  readStoredFile,
  storeFile,
  type FileActor,
} from "@/platform/files";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

// IMP-02: private files per company. A temporary link; a file of another
// company is unreachable.

const stamp = Date.now();
let counter = 0;
let staff = "";
const csv = (text = "sku,nombre\nTOR-1,Tornillo\n") => Buffer.from(text);

async function newUser() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Persona",
      email: `archivos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

async function company(): Promise<FileActor> {
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
      productLimit: 50,
      users: 10,
      modules: ["inventory"],
      validUntil: null,
      reason: "Prueba de archivos",
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
  const assigned = await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId, roleRowId: assigned.id };
}

async function upload(owner: FileActor, name = "productos.csv") {
  const result = await storeFile(owner, {
    purpose: "import_source",
    name,
    bytes: csv(),
  });
  if (!result.ok) throw new Error("upload failed");
  return result.fileId;
}

/** `e` and `s` of a link, as the route receives them. */
function parts(url: string) {
  const parsed = new URL(url, "http://local.test");
  return {
    fileId: parsed.pathname.split("/").pop()!,
    expires: parsed.searchParams.get("e")!,
    signature: parsed.searchParams.get("s")!,
  };
}

async function linkOf(owner: FileActor, fileId: string, now?: Date) {
  const link = await createFileLink(owner, fileId, { now });
  if (!link.ok) throw new Error("link failed");
  return link;
}

const storageDir = process.env.FILE_STORAGE_DIR!;
let actor: FileActor;

beforeAll(async () => {
  actor = await company();
}, 60_000);

afterEach(() => invalidateEntitlements());
afterAll(() => db.$disconnect());

describe("storeFile", () => {
  it("keeps the file under its company, with what the server decides", async () => {
    const result = await storeFile(actor, {
      purpose: "import_source",
      name: "C:\\Users\\Lupita\\Documentos\\Inventario marzo.CSV",
      bytes: csv(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = await db.storedFile.findUniqueOrThrow({
      where: { id: result.fileId },
    });
    expect(row).toMatchObject({
      organizationId: actor.organizationId,
      purpose: "import_source",
      // The folder of the person's computer is not kept.
      name: "Inventario marzo.CSV",
      contentType: "text/csv; charset=utf-8",
      size: csv().byteLength,
      storageKey: `${actor.organizationId}/${result.fileId}`,
      createdByUserId: actor.userId,
      deletedAt: null,
    });
    expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    // Tests write to a throwaway folder, never to the project's storage.
    expect(storageDir).not.toContain(process.cwd());
    expect(
      existsSync(path.join(storageDir, actor.organizationId, result.fileId)),
    ).toBe(true);
    const content = await readStoredFile(actor.organizationId, result.fileId);
    expect(content!.bytes.equals(csv())).toBe(true);
  });

  it("refuses what it should not keep, and keeps nothing", async () => {
    const before = await db.storedFile.count({
      where: { organizationId: actor.organizationId },
    });
    const attempt = (name: string, bytes: Uint8Array = csv()) =>
      storeFile(actor, { purpose: "import_source", name, bytes });
    expect(await attempt("virus.exe")).toMatchObject({ reason: "type" });
    expect(await attempt("pagina.html")).toMatchObject({ reason: "type" });
    expect(await attempt("productos.csv.exe")).toMatchObject({
      reason: "type",
    });
    expect(await attempt("sin-extension")).toMatchObject({ reason: "name" });
    expect(await attempt(".csv")).toMatchObject({ reason: "name" });
    expect(await attempt("vacio.csv", Buffer.alloc(0))).toMatchObject({
      reason: "empty",
    });
    expect(
      await attempt("enorme.csv", Buffer.alloc(10 * 1024 * 1024 + 1)),
    ).toMatchObject({ reason: "too_large" });
    expect(
      await db.storedFile.count({
        where: { organizationId: actor.organizationId },
      }),
    ).toBe(before);
  });

  it("a name can never become a path", async () => {
    const fileId = await upload(actor, "../../../../etc/passwd.csv");
    const row = await db.storedFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    expect(row.name).toBe("passwd.csv");
    expect(row.storageKey).toBe(`${actor.organizationId}/${fileId}`);
    // Nothing was written outside the company's folder.
    expect(
      readdirSync(storageDir).every((n) => /^[0-9a-f-]{36}$/.test(n)),
    ).toBe(true);
  });

  it("only who may import uploads", async () => {
    const viewer = await member(actor.organizationId, "viewer");
    await expect(
      storeFile(viewer, {
        purpose: "import_source",
        name: "productos.csv",
        bytes: csv(),
      }),
    ).rejects.toMatchObject({ code: "permission_denied" });
    const warehouse = await member(actor.organizationId, "warehouse");
    expect(
      (
        await storeFile(warehouse, {
          purpose: "import_source",
          name: "productos.csv",
          bytes: csv(),
        })
      ).ok,
    ).toBe(true);
  });
});

describe("temporary links", () => {
  it("a link opens the file for who asked for it, for a few minutes", async () => {
    const fileId = await upload(actor);
    const now = new Date();
    const link = await linkOf(actor, fileId, now);
    expect(link.url).toMatch(
      new RegExp(`^/api/archivos/${fileId}\\?e=\\d+&s=[A-Za-z0-9_-]{43}$`),
    );
    expect(link.expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(
      FILE_LINK_SECONDS * 1000,
    );
    const opened = await openFileLink(actor, parts(link.url), { now });
    expect(opened).toMatchObject({
      ok: true,
      fileId,
      name: "productos.csv",
      contentType: "text/csv; charset=utf-8",
    });
    if (!opened.ok) return;
    expect(opened.bytes.equals(csv())).toBe(true);
  });

  it("expires", async () => {
    const fileId = await upload(actor);
    const now = new Date();
    const link = parts((await linkOf(actor, fileId, now)).url);
    const at = (seconds: number) => ({
      now: new Date(now.getTime() + seconds * 1000),
    });
    expect(
      (await openFileLink(actor, link, at(FILE_LINK_SECONDS - 2))).ok,
    ).toBe(true);
    expect(await openFileLink(actor, link, at(FILE_LINK_SECONDS + 1))).toEqual({
      ok: false,
      reason: "expired",
    });
    // Pushing the expiry forward breaks the signature.
    expect(
      await openFileLink(
        actor,
        { ...link, expires: String(Number(link.expires) + 3600) },
        at(FILE_LINK_SECONDS + 1),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("does not work for another person, even of the same company", async () => {
    const fileId = await upload(actor);
    const link = parts((await linkOf(actor, fileId)).url);
    const colleague = await member(actor.organizationId, "warehouse");
    expect(await openFileLink(colleague, link)).toEqual({
      ok: false,
      reason: "invalid",
    });
    // The colleague can ask for a link of their own.
    const own = parts((await linkOf(colleague, fileId)).url);
    expect((await openFileLink(colleague, own)).ok).toBe(true);
  });

  it("a file of another company is unreachable", async () => {
    const fileId = await upload(actor);
    const link = parts((await linkOf(actor, fileId)).url);
    const theirs = await company();
    // They cannot make a link for it…
    expect(await createFileLink(theirs, fileId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    // …nor use ours, nor read or delete it through the services.
    expect(await openFileLink(theirs, link)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(await readStoredFile(theirs.organizationId, fileId)).toBeNull();
    expect(await deleteFile(theirs, fileId)).toEqual({ ok: false });
    // Someone who belongs to both: the link is tied to the company too.
    const both = {
      organizationId: theirs.organizationId,
      userId: actor.userId,
    };
    expect(await openFileLink(both, link)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect((await openFileLink(actor, link)).ok).toBe(true);
  });

  it("tampered or malformed links are refused", async () => {
    const fileId = await upload(actor);
    const other = await upload(actor);
    const link = parts((await linkOf(actor, fileId)).url);
    const invalid = { ok: false, reason: "invalid" };
    expect(await openFileLink(actor, { ...link, fileId: other })).toEqual(
      invalid,
    );
    expect(await openFileLink(actor, { ...link, signature: "" })).toEqual(
      invalid,
    );
    expect(
      await openFileLink(actor, {
        ...link,
        signature: link.signature.replace(/.$/, (c) => (c === "A" ? "B" : "A")),
      }),
    ).toEqual(invalid);
    // A link is valid in exactly one spelling. The last character of the
    // signature carries two bits that decoding ignores: every other
    // character there, padding or stray symbols must be refused too.
    const last = link.signature.at(-1)!;
    const body = link.signature.slice(0, -1);
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    for (const character of alphabet) {
      if (character === last) continue;
      expect(
        await openFileLink(actor, { ...link, signature: body + character }),
        `…${character}`,
      ).toEqual(invalid);
    }
    for (const signature of [
      `${link.signature}=`,
      `${link.signature} `,
      `${link.signature}!`,
      `${body}.${last}`,
      link.signature.replace(/-/g, "+").replace(/_/g, "/") + "=",
      link.signature.toUpperCase() === link.signature
        ? link.signature.toLowerCase()
        : link.signature.toUpperCase(),
    ]) {
      expect(
        await openFileLink(actor, { ...link, signature }),
        signature,
      ).toEqual(invalid);
    }
    // And the untouched link still opens.
    expect((await openFileLink(actor, link)).ok).toBe(true);
    expect(await openFileLink(actor, { ...link, expires: "mañana" })).toEqual(
      invalid,
    );
    expect(
      await openFileLink(actor, { ...link, fileId: "../../etc/passwd" }),
    ).toEqual(invalid);
  });

  it("stops working when the person loses the permission or the file is deleted", async () => {
    const fileId = await upload(actor);
    const person = await member(actor.organizationId, "warehouse");
    const link = parts((await linkOf(person, fileId)).url);
    expect((await openFileLink(person, link)).ok).toBe(true);
    // The role is taken away after the link was made.
    await db.membershipRole.delete({ where: { id: person.roleRowId } });
    expect(await openFileLink(person, link)).toEqual({
      ok: false,
      reason: "forbidden",
    });

    const mine = parts((await linkOf(actor, fileId)).url);
    expect(await deleteFile(actor, fileId)).toEqual({ ok: true });
    expect(await openFileLink(actor, mine)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await createFileLink(actor, fileId)).toEqual({
      ok: false,
      reason: "not_found",
    });
    expect(await readStoredFile(actor.organizationId, fileId)).toBeNull();
    // The bytes are gone; the row stays as a trace.
    expect(
      existsSync(path.join(storageDir, actor.organizationId, fileId)),
    ).toBe(false);
    const row = await db.storedFile.findUniqueOrThrow({
      where: { id: fileId },
    });
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it("roles that cannot read imports get no link", async () => {
    const fileId = await upload(actor);
    const buyer = await member(actor.organizationId, "buyer");
    await expect(createFileLink(buyer, fileId)).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});
