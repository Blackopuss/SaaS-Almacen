import "server-only";

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Where the bytes of private files live (IMP-02, ADR 0014): a folder of
 * the server, outside what the web application serves. Nothing reaches a
 * file by its path: only `platform/files` reads here, after checking whose
 * the file is.
 *
 * Keys are built by the service from ids ("<organizationId>/<fileId>");
 * anything else is refused, so a key can never leave the folder.
 */

const KEY = /^[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

function root(): string {
  return path.resolve(
    process.env.FILE_STORAGE_DIR ?? path.join(process.cwd(), "storage"),
  );
}

function locate(key: string): string {
  if (!KEY.test(key)) throw new Error("Invalid storage key");
  return path.join(root(), ...key.split("/"));
}

/** Writes the whole file or nothing: a temporary name first, then renamed. */
export async function putBytes(key: string, bytes: Uint8Array): Promise<void> {
  const target = locate(key);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);
}

/** Null when the bytes are not there. */
export async function getBytes(key: string): Promise<Buffer | null> {
  try {
    return await readFile(locate(key));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function removeBytes(key: string): Promise<void> {
  await rm(locate(key), { force: true });
}
