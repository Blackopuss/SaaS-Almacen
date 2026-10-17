import { describe, expect, it } from "vitest";

import { sanitizeMetadata } from "./sanitize";

describe("sanitizeMetadata", () => {
  it("drops anything that looks like a secret, at any depth", () => {
    expect(
      sanitizeMetadata({
        password: "x",
        newPassword: "x",
        token: "x",
        backupCodes: ["a"],
        totpSecret: "x",
        apiKey: "x",
        cookie: "x",
        nested: { authorization: "Bearer x", code: "123456", left: 9 },
        kept: "visible",
      }),
    ).toEqual({ nested: { left: 9 }, kept: "visible" });
  });

  it("cuts long strings and caps depth and size", () => {
    const result = sanitizeMetadata({
      long: "a".repeat(500),
      deep: { a: { b: { c: { d: "too deep" } } } },
      many: Array.from({ length: 80 }, (_, i) => i),
    })!;
    expect((result.long as string).length).toBe(201);
    expect(result.deep).toEqual({ a: { b: { c: "[…]" } } });
    expect(result.many).toHaveLength(50);
  });

  it("returns null when nothing is left", () => {
    expect(sanitizeMetadata(undefined)).toBeNull();
    expect(sanitizeMetadata({ password: "x" })).toBeNull();
  });
});
