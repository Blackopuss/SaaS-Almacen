import { afterEach, describe, expect, it, vi } from "vitest";

import { log, pathWithoutQuery, recentErrorCount } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("log", () => {
  it("writes one JSON object per line in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    log.info("worker_started", { workerId: "worker-1" });
    const record = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(record).toMatchObject({
      level: "info",
      event: "worker_started",
      workerId: "worker-1",
    });
    expect(Date.parse(record.time)).not.toBeNaN();
  });

  it("describes errors and counts them", () => {
    vi.stubEnv("LOG_FORMAT", "json");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = recentErrorCount();
    const error = Object.assign(new Error("se cayó"), { digest: "123" });
    log.error("request_error", error, { path: "/inicio" });
    const record = JSON.parse(spy.mock.calls[0]![0] as string);
    expect(record).toMatchObject({
      level: "error",
      event: "request_error",
      path: "/inicio",
      error: "Error",
      message: "se cayó",
      digest: "123",
    });
    expect(recentErrorCount()).toBe(before + 1);
    expect(recentErrorCount(Date.now() + 16 * 60 * 1000)).toBe(0);
  });
});

describe("pathWithoutQuery", () => {
  it("drops the query, where email links carry their tokens", () => {
    expect(pathWithoutQuery("/restablecer-contrasena?token=secreto")).toBe(
      "/restablecer-contrasena",
    );
    expect(pathWithoutQuery("/inicio#x")).toBe("/inicio");
    expect(pathWithoutQuery("/inicio")).toBe("/inicio");
  });
});
