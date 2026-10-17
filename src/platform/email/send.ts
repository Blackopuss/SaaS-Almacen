import "server-only";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { createTransport } from "nodemailer";
import type { Transporter } from "nodemailer";

import { newId } from "@/lib";

/**
 * Outgoing email (PLT-03). Drivers:
 * - memory: kept in this process, for tests.
 * - log: written to .local/mail (and printed) for local development; the
 *   dev-only /correos page lists them.
 * - smtp: a real provider (Resend, Amazon SES, Brevo, the hosting's own
 *   mail…) over SMTP with TLS (ADR 0023). Production refuses to send
 *   without a real driver instead of dropping mail silently.
 *
 * What goes into a header (recipient, reply address, subject) never
 * carries a line break: a message that tried to is refused, not repaired,
 * so no text of a customer can add headers or recipients of its own.
 */
export type EmailAttachment = {
  /** Name the recipient sees: «OC-0007.pdf». */
  name: string;
  contentType: string;
  content: Buffer;
};

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  /** Primary action link, shown as a button in the dev outbox. */
  actionUrl?: string;
  /** Where an answer goes, when not to the sender of the system. */
  replyTo?: string;
  attachments?: EmailAttachment[];
};

export type StoredAttachment = {
  name: string;
  contentType: string;
  size: number;
  /** The file, in base64. */
  content: string;
};

export type StoredEmail = Omit<EmailMessage, "attachments"> & {
  id: string;
  sentAt: string;
  attachments?: StoredAttachment[];
};

/** All the attachments of one message, at most. */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;

const ADDRESS =
  /^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/;
// Control characters, the line and paragraph separators included.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ATTACHMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,119}$/;
const CONTENT_TYPE = /^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/;

/**
 * Thrown for a message that must not leave as it is. It is a defect of
 * the caller or hostile data, never something a retry fixes.
 */
export class InvalidEmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEmailError";
  }
}

function address(value: string, what: string): string {
  const text = String(value);
  if (text.length > 254 || CONTROL.test(text) || !ADDRESS.test(text)) {
    throw new InvalidEmailError(`Invalid ${what} address`);
  }
  return text.toLowerCase();
}

/** The message as it will leave, or an error when it must not. */
function checked(message: EmailMessage): Omit<StoredEmail, "id" | "sentAt"> {
  const subject = String(message.subject);
  if (subject.length === 0 || subject.length > 200 || CONTROL.test(subject)) {
    throw new InvalidEmailError("Invalid subject");
  }
  let bytes = 0;
  const attachments = (message.attachments ?? []).map((file) => {
    if (
      !ATTACHMENT_NAME.test(file.name) ||
      !CONTENT_TYPE.test(file.contentType) ||
      !Buffer.isBuffer(file.content)
    ) {
      throw new InvalidEmailError("Invalid attachment");
    }
    bytes += file.content.byteLength;
    if (bytes > MAX_ATTACHMENTS_BYTES) {
      throw new InvalidEmailError("Attachments are too large");
    }
    return {
      name: file.name,
      contentType: file.contentType,
      size: file.content.byteLength,
      content: file.content.toString("base64"),
    };
  });
  return {
    to: address(message.to, "recipient"),
    subject,
    text: String(message.text),
    ...(message.actionUrl ? { actionUrl: message.actionUrl } : {}),
    ...(message.replyTo ? { replyTo: address(message.replyTo, "reply") } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

const MAIL_DIR = path.join(process.cwd(), ".local", "mail");
const memoryOutbox: StoredEmail[] = [];

type Driver = "memory" | "log" | "smtp";

function driver(): Driver {
  const configured = process.env.MAIL_DRIVER;
  // On a public address (https), "log" would write reset and invitation
  // links to the server's logs and "memory" would drop them: refused
  // (security audit). `next start` on localhost still accepts both.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.BETTER_AUTH_URL?.startsWith("https://") &&
    (configured === "memory" || configured === "log")
  ) {
    throw new Error(
      `MAIL_DRIVER=${configured} is not allowed on a public address: configure a real email provider.`,
    );
  }
  if (
    configured === "memory" ||
    configured === "log" ||
    configured === "smtp"
  ) {
    return configured;
  }
  if (configured) throw new Error(`Unknown MAIL_DRIVER: ${configured}`);
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "MAIL_DRIVER is not configured: production needs a real email provider.",
    );
  }
  return "log";
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

export type SmtpSettings = {
  host: string;
  port: number;
  /** "tls": encrypted from the start (port 465); "starttls": upgraded. */
  security: "tls" | "starttls" | "none";
  user?: string;
  password?: string;
  /** «Almacén <avisos@tudominio.mx>». */
  from: string;
};

/**
 * SMTP settings from the environment, checked once. Mail always travels
 * encrypted: "none" is accepted only towards this same machine (a local
 * relay or a test sink), never across the network.
 */
export function smtpSettings(
  env: Record<string, string | undefined> = process.env,
): SmtpSettings {
  const host = env.SMTP_HOST?.trim();
  if (!host) throw new Error("SMTP_HOST is not configured.");
  const security = (env.SMTP_SECURITY ??
    "starttls") as SmtpSettings["security"];
  if (!["tls", "starttls", "none"].includes(security)) {
    throw new Error(`Invalid SMTP_SECURITY: ${security}`);
  }
  if (security === "none" && !LOCAL_HOSTS.has(host)) {
    throw new Error("SMTP_SECURITY=none is only allowed towards localhost.");
  }
  const port = Number(env.SMTP_PORT ?? (security === "tls" ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid SMTP_PORT: ${env.SMTP_PORT}`);
  }
  const from = env.MAIL_FROM?.trim() ?? "";
  const match = /^(?:([^<>]{1,80}) )?<([^<>]+)>$/.exec(from) ?? [
    "",
    undefined,
    from,
  ];
  if (!from || CONTROL.test(from)) {
    throw new Error("MAIL_FROM is not configured.");
  }
  address(match[2] ?? "", "sender");
  const user = env.SMTP_USER?.trim() || undefined;
  const password = env.SMTP_PASSWORD || undefined;
  if (Boolean(user) !== Boolean(password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD go together.");
  }
  return { host, port, security, user, password, from };
}

let transport: { key: string; transporter: Transporter } | undefined;

function smtpTransport(settings: SmtpSettings): Transporter {
  const key = JSON.stringify(settings);
  if (transport?.key === key) return transport.transporter;
  const transporter = createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.security === "tls",
    requireTLS: settings.security === "starttls",
    ignoreTLS: settings.security === "none",
    auth: settings.user
      ? { user: settings.user, pass: settings.password }
      : undefined,
    tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    // Messages are built here, never from paths or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  transport = { key, transporter };
  return transporter;
}

async function sendSmtp(stored: StoredEmail): Promise<void> {
  const settings = smtpSettings();
  await smtpTransport(settings).sendMail({
    from: settings.from,
    to: stored.to,
    ...(stored.replyTo ? { replyTo: stored.replyTo } : {}),
    subject: stored.subject,
    text: stored.text,
    attachments: stored.attachments?.map((file) => ({
      filename: file.name,
      contentType: file.contentType,
      content: Buffer.from(file.content, "base64"),
    })),
    disableFileAccess: true,
    disableUrlAccess: true,
  });
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  const stored: StoredEmail = {
    ...checked(message),
    id: newId(),
    sentAt: new Date().toISOString(),
  };
  const kind = driver();
  // `.invalid` never exists (RFC 2606). The local drivers treat it as a
  // server that cannot be reached, so a delivery that fails can be seen
  // and tested without a real provider.
  if (stored.to.endsWith(".invalid")) {
    throw new Error(`No se pudo entregar el correo a ${stored.to}.`);
  }
  if (kind === "memory") {
    memoryOutbox.push(stored);
    return;
  }
  if (kind === "smtp") {
    await sendSmtp(stored);
    return;
  }
  await mkdir(MAIL_DIR, { recursive: true });
  await writeFile(
    path.join(MAIL_DIR, `${stored.id}.json`),
    JSON.stringify(stored, null, 2),
  );
  console.info(
    `[correo] Para ${stored.to}: ${stored.subject}${stored.actionUrl ? ` → ${stored.actionUrl}` : ""}${stored.attachments ? ` (${stored.attachments.length} adjunto${stored.attachments.length === 1 ? "" : "s"})` : ""}`,
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
