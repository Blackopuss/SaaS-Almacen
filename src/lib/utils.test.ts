import { describe, expect, it } from "vitest";

import { AppError, NotFoundError, isAppError } from "./errors";
import { isId, newId } from "./ids";
import { formatDateTime, formatRelative, toIsoUtc } from "./time";

describe("ids", () => {
  it("creates valid, unique, time-ordered UUIDv7", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(1000);
    expect(ids.every(isId)).toBe(true);
    expect([...ids].sort()).toEqual(ids);
  });

  it("rejects other values", () => {
    expect(isId("not-an-id")).toBe(false);
    expect(isId(crypto.randomUUID())).toBe(false); // v4
    expect(isId(123)).toBe(false);
  });
});

describe("errors", () => {
  it("carries kind, code and details", () => {
    const error = new NotFoundError("product.not_found", "Product not found", {
      id: "x",
    });
    expect(isAppError(error)).toBe(true);
    expect(error).toBeInstanceOf(AppError);
    expect(error.kind).toBe("not_found");
    expect(error.code).toBe("product.not_found");
    expect(error.details).toEqual({ id: "x" });
    expect(isAppError(new Error("x"))).toBe(false);
  });
});

describe("time", () => {
  it("serializes in UTC", () => {
    expect(toIsoUtc(new Date(Date.UTC(2026, 9, 2, 18, 30)))).toBe(
      "2026-10-02T18:30:00.000Z",
    );
    expect(() => toIsoUtc(new Date("invalid"))).toThrow(RangeError);
  });

  it("shows Mexico City time", () => {
    // 18:30 UTC is 12:30 in Mexico City (UTC−6, no DST).
    const text = formatDateTime(new Date(Date.UTC(2026, 9, 2, 18, 30)));
    expect(text).toMatch(/12:30/);
  });

  it("formats relative times in Spanish", () => {
    const now = new Date(Date.UTC(2026, 9, 2, 12, 0));
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(formatRelative(ago(20_000), now)).toBe("Ahora");
    expect(formatRelative(ago(5 * 60_000), now)).toBe("hace 5 minutos");
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe("hace 3 horas");
    expect(formatRelative(ago(24 * 3_600_000), now)).toBe("ayer");
  });
});
