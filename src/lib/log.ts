/**
 * Structured logs (BAS-11). In production each line is one JSON object
 * (`{"time","level","event",…}`) that journald keeps and `journalctl -o
 * cat` shows; in development, a readable line. Fields are data about what
 * happened: never passwords, tokens, links from emails or file contents.
 *
 * Errors are also counted for a few minutes so /api/salud can say when the
 * server is failing more than usual (PIL-04).
 */
type Level = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const ERROR_WINDOW_MS = 15 * 60 * 1000;

// Shared through globalThis: Next loads instrumentation and route code as
// separate module instances in the same process.
const store = globalThis as typeof globalThis & { __almacenErrors?: number[] };

function asJson(): boolean {
  return (
    process.env.LOG_FORMAT === "json" ||
    (process.env.LOG_FORMAT !== "text" && process.env.NODE_ENV === "production")
  );
}

function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    const digest = (error as { digest?: unknown }).digest;
    return {
      error: error.name,
      message: error.message,
      ...(digest !== undefined ? { digest: String(digest) } : {}),
      stack: error.stack?.split("\n").slice(0, 8).join("\n"),
    };
  }
  return { error: "NonError", message: String(error) };
}

function write(level: Level, event: string, fields: LogFields) {
  const record = { time: new Date().toISOString(), level, event, ...fields };
  const out =
    level === "error"
      ? console.error
      : level === "warn"
        ? console.warn
        : console.info;
  if (asJson()) {
    let line: string;
    try {
      line = JSON.stringify(record);
    } catch {
      line = JSON.stringify({
        time: record.time,
        level,
        event,
        message: "unserializable fields",
      });
    }
    out(line);
    return;
  }
  const extra = Object.entries(fields)
    .filter(([key]) => key !== "stack")
    .map(
      ([key, value]) =>
        `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`,
    )
    .join(" ");
  out(`[${level}] ${event}${extra ? ` ${extra}` : ""}`);
  if (typeof fields.stack === "string") out(fields.stack);
}

export const log = {
  info(event: string, fields: LogFields = {}) {
    write("info", event, fields);
  },
  warn(event: string, fields: LogFields = {}) {
    write("warn", event, fields);
  },
  error(event: string, error?: unknown, fields: LogFields = {}) {
    const now = Date.now();
    const recent = (store.__almacenErrors ?? []).filter(
      (at) => now - at < ERROR_WINDOW_MS,
    );
    recent.push(now);
    store.__almacenErrors = recent.slice(-1000);
    write("error", event, {
      ...fields,
      ...(error === undefined ? {} : describeError(error)),
    });
  },
};

/** Errors logged by this process in the last 15 minutes. */
export function recentErrorCount(now = Date.now()): number {
  return (store.__almacenErrors ?? []).filter(
    (at) => now - at < ERROR_WINDOW_MS,
  ).length;
}

/** A request path without its query: links in emails carry tokens there. */
export function pathWithoutQuery(path: string): string {
  const end = path.search(/[?#]/);
  return end === -1 ? path : path.slice(0, end);
}
