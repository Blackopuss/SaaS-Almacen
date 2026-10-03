import "server-only";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { newId } from "@/lib";

/**
 * Outgoing email (PLT-03). Drivers:
 * - memory: kept in this process, for tests.
 * - log: written to .local/mail (and printed) for local development; the
 *   dev-only /correos page lists them.
 * A real provider (SMTP/API) is added when hosting is chosen; production
 * refuses to start sending without one instead of dropping mail silently.
 */
export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Primary action link, shown as a button in the dev outbox. */
  actionUrl?: string;
};

export type StoredEmail = EmailMessage & { id: string; sentAt: string };

const MAIL_DIR = path.join(process.cwd(), ".local", "mail");
const memoryOutbox: StoredEmail[] = [];

function driver(): "memory" | "log" {
  const configured = process.env.MAIL_DRIVER;
  if (configured === "memory" || configured === "log") return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MAIL_DRIVER is not configured: production needs a real email provider.",
    );
  }
  return "log";
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const stored: StoredEmail = {
    ...message,
    id: newId(),
    sentAt: new Date().toISOString(),
  };
  if (driver() === "memory") {
    memoryOutbox.push(stored);
    return;
  }
  await mkdir(MAIL_DIR, { recursive: true });
  await writeFile(
    path.join(MAIL_DIR, `${stored.id}.json`),
    JSON.stringify(stored, null, 2),
  );
  console.info(
    `[correo] Para ${stored.to}: ${stored.subject}${stored.actionUrl ? ` → ${stored.actionUrl}` : ""}`,
  );
}

/** Messages captured by the memory driver (tests). */
export function memoryOutboxFor(to: string): StoredEmail[] {
  return memoryOutbox.filter((m) => m.to === to.toLowerCase());
}

/** Messages written by the log driver, newest first (development). */
export async function listDevOutbox(limit = 50): Promise<StoredEmail[]> {
  let files: string[];
  try {
    files = await readdir(MAIL_DIR);
  } catch {
    return [];
  }
  const recent = files
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, limit);
  return Promise.all(
    recent.map(
      async (f) =>
        JSON.parse(
          await readFile(path.join(MAIL_DIR, f), "utf8"),
        ) as StoredEmail,
    ),
  );
}
