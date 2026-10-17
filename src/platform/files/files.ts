import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { newId } from "@/lib";
import type { Permission } from "@/platform/authorization";
import { assertModulePermission } from "@/platform/billing";
import { forOrganization } from "@/server";

import { getBytes, putBytes, removeBytes } from "./storage";

/**
 * Private files of a company (IMP-02, ADR 0014). A file is a row of the
 * company plus its bytes in the storage. Nobody reaches the bytes by a
 * path: a download goes through a temporary link that only works for the
 * person it was made for, in the company the file belongs to, and only
 * for a few minutes.
 */

/** Who acts; always taken from the session. */
export type FileActor = { organizationId: string; userId: string };

const MB = 1024 * 1024;

const CONTENT_TYPES = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;

type Extension = keyof typeof CONTENT_TYPES;

type Purpose = {
  /** Permission to add a file of this kind. */
  write: Permission;
  /** Permission to download it. */
  read: Permission;
  maxBytes: number;
  extensions: readonly Extension[];
};

/**
 * What files exist and who handles them. A new kind of file is added here,
 * with the permissions of the matrix that govern it.
 */
export const FILE_PURPOSES = {
  /** What a company uploads to import (IMP-04 on). */
  import_source: {
    write: "inventory.import.create",
    read: "inventory.import.read",
    maxBytes: 10 * MB,
    extensions: ["csv", "xlsx"],
  },
  /** What is generated for a company to download (IMP-03, IMP-11). */
  export: {
    write: "inventory.export.create",
    read: "inventory.export.create",
    maxBytes: 50 * MB,
    extensions: ["csv", "xlsx"],
  },
} as const satisfies Record<string, Purpose>;

export type FilePurpose = keyof typeof FILE_PURPOSES;

const isPurpose = (value: string): value is FilePurpose =>
  Object.hasOwn(FILE_PURPOSES, value);

/** Name for people: no folders, no control characters, a sane length. */
function cleanName(name: string): string {
  const base = String(name ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .split(/[\\/]/)
    .pop()!
    .trim();
  return base.slice(-160);
}

const megabytes = (bytes: number) =>
  `${(bytes / MB).toLocaleString("es-MX", { maximumFractionDigits: 1 })} MB`;

export type StoreFileResult =
  | { ok: true; fileId: string }
  | {
      ok: false;
      reason: "empty" | "too_large" | "type" | "name";
      error: string;
    };

/**
 * Keeps a file for the company of the actor. The kind of content is
 * decided here from the extension — never taken from the browser — and the
 * purpose limits what is accepted and how large.
 */
export async function storeFile(
  actor: FileActor,
  input: { purpose: FilePurpose; name: string; bytes: Uint8Array },
): Promise<StoreFileResult> {
  const { organizationId, userId } = actor;
  if (!isPurpose(input.purpose)) throw new Error("Unknown file purpose");
  const purpose: Purpose = FILE_PURPOSES[input.purpose];
  await assertModulePermission(organizationId, userId, purpose.write);

  const name = cleanName(input.name);
  const extension = name.includes(".")
    ? name.split(".").pop()!.toLowerCase()
    : "";
  if (name.length < 3 || extension === "" || name.startsWith(".")) {
    return {
      ok: false,
      reason: "name",
      error:
        "El archivo necesita un nombre con su extensión, por ejemplo productos.csv.",
    };
  }
  if (!(purpose.extensions as readonly string[]).includes(extension)) {
    return {
      ok: false,
      reason: "type",
      error: `Ese tipo de archivo no se acepta. Usa ${purpose.extensions.map((e) => `.${e}`).join(" o ")}.`,
    };
  }
  const size = input.bytes.byteLength;
  if (size === 0) {
    return { ok: false, reason: "empty", error: "El archivo está vacío." };
  }
  if (size > purpose.maxBytes) {
    return {
      ok: false,
      reason: "too_large",
      error: `El archivo pesa ${megabytes(size)}; el máximo es ${megabytes(purpose.maxBytes)}.`,
    };
  }

  const fileId = newId();
  const storageKey = `${organizationId}/${fileId}`;
  // Bytes first: a row always has its file. If the row fails, the bytes
  // are taken back.
  await putBytes(storageKey, input.bytes);
  try {
    await forOrganization(organizationId).storedFile.create({
      data: {
        id: fileId,
        organizationId,
        purpose: input.purpose,
        name,
        contentType: CONTENT_TYPES[extension as Extension],
        size,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        storageKey,
        createdByUserId: userId,
      },
    });
  } catch (error) {
    await removeBytes(storageKey).catch(() => {});
    throw error;
  }
  return { ok: true, fileId };
}

export type StoredFileContent = {
  fileId: string;
  name: string;
  contentType: string;
  size: number;
  bytes: Buffer;
};

/** The row of a file of this company that still exists, or null. */
async function findFile(organizationId: string, fileId: string) {
  return forOrganization(organizationId).storedFile.findFirst({
    where: { id: String(fileId).slice(0, 36), deletedAt: null },
    select: {
      id: true,
      purpose: true,
      name: true,
      contentType: true,
      size: true,
      storageKey: true,
    },
  });
}

/**
 * Content of a file, for the code that processes it (an import reading
 * what was uploaded). Null when the file is not of this company. Callers
 * have already authorized the operation they are doing.
 */
export async function readStoredFile(
  organizationId: string,
  fileId: string,
): Promise<StoredFileContent | null> {
  const file = await findFile(organizationId, fileId);
  if (!file) return null;
  const bytes = await getBytes(file.storageKey);
  if (!bytes) return null;
  return {
    fileId: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    bytes,
  };
}

/** Removes a file: the bytes go, the row stays marked as a trace. */
export async function deleteFile(
  actor: FileActor,
  fileId: string,
): Promise<{ ok: boolean }> {
  const file = await findFile(actor.organizationId, fileId);
  if (!file || !isPurpose(file.purpose)) return { ok: false };
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    FILE_PURPOSES[file.purpose].write,
  );
  await forOrganization(actor.organizationId).storedFile.updateMany({
    where: { id: file.id },
    data: { deletedAt: new Date() },
  });
  await removeBytes(file.storageKey);
  return { ok: true };
}

/** How long a download link works. */
export const FILE_LINK_SECONDS = 5 * 60;

/** Key for signing links, apart from the one that signs sessions. */
function linkKey(): Buffer {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("BETTER_AUTH_SECRET is required to sign file links");
  }
  return createHmac("sha256", secret).update("almacen:file-link:v1").digest();
}

/**
 * The signature covers the file, the company, the person and the expiry:
 * change any of them and it no longer matches.
 */
function sign(
  fileId: string,
  organizationId: string,
  userId: string,
  expires: number,
): string {
  return createHmac("sha256", linkKey())
    .update(`${fileId}|${organizationId}|${userId}|${expires}`)
    .digest("base64url");
}

export type FileLinkResult =
  | { ok: true; url: string; expiresAt: Date }
  | { ok: false; reason: "not_found" };

/**
 * Temporary link to download a file of the company. It works only for
 * the person who asked for it, signed in and in that company, until it
 * expires. The file of another company «does not exist».
 */
export async function createFileLink(
  actor: FileActor,
  fileId: string,
  options: { now?: Date } = {},
): Promise<FileLinkResult> {
  const file = await findFile(actor.organizationId, fileId);
  if (!file || !isPurpose(file.purpose))
    return { ok: false, reason: "not_found" };
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    FILE_PURPOSES[file.purpose].read,
  );
  const now = options.now ?? new Date();
  const expires = Math.floor(now.getTime() / 1000) + FILE_LINK_SECONDS;
  const signature = sign(file.id, actor.organizationId, actor.userId, expires);
  return {
    ok: true,
    url: `/api/archivos/${file.id}?e=${expires}&s=${signature}`,
    expiresAt: new Date(expires * 1000),
  };
}

export type OpenFileLinkResult =
  | ({ ok: true } & StoredFileContent)
  | { ok: false; reason: "invalid" | "expired" | "not_found" | "forbidden" };

/**
 * Opens a download link for the person of the session. Everything is
 * checked again: signature, expiry, that the file is of the session's
 * company and that the person may still read it.
 */
export async function openFileLink(
  actor: FileActor,
  link: { fileId: string; expires: string; signature: string },
  options: { now?: Date } = {},
): Promise<OpenFileLinkResult> {
  const fileId = String(link.fileId);
  const expires = /^\d{9,11}$/.test(String(link.expires))
    ? Number(link.expires)
    : NaN;
  if (!/^[0-9a-f-]{36}$/.test(fileId) || Number.isNaN(expires)) {
    return { ok: false, reason: "invalid" };
  }
  // The signature is compared as the text it was issued as, not after
  // decoding it: decoding would accept other spellings of the same bytes
  // (a different last character, padding, stray symbols), and a link is
  // valid in exactly one form.
  const given = Buffer.from(String(link.signature), "utf8");
  const expected = Buffer.from(
    sign(fileId, actor.organizationId, actor.userId, expires),
    "utf8",
  );
  // Made for another person, another company or another moment: no match.
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: "invalid" };
  }
  const now = options.now ?? new Date();
  if (expires * 1000 <= now.getTime()) return { ok: false, reason: "expired" };

  const file = await findFile(actor.organizationId, fileId);
  if (!file || !isPurpose(file.purpose))
    return { ok: false, reason: "not_found" };
  try {
    await assertModulePermission(
      actor.organizationId,
      actor.userId,
      FILE_PURPOSES[file.purpose].read,
    );
  } catch {
    // The role was taken away after the link was made.
    return { ok: false, reason: "forbidden" };
  }
  const bytes = await getBytes(file.storageKey);
  if (!bytes) return { ok: false, reason: "not_found" };
  return {
    ok: true,
    fileId: file.id,
    name: file.name,
    contentType: file.contentType,
    size: file.size,
    bytes,
  };
}
