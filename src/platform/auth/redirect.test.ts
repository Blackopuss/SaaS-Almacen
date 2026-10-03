import { describe, expect, it } from "vitest";

import { DEFAULT_AFTER_SIGN_IN, safeRedirectPath } from "./redirect";

describe("safeRedirectPath (no open redirects)", () => {
  it("keeps same-site paths with query and hash", () => {
    expect(safeRedirectPath("/movimientos")).toBe("/movimientos");
    expect(safeRedirectPath("/inventario?q=tornillo#lista")).toBe(
      "/inventario?q=tornillo#lista",
    );
  });

  it.each([
    undefined,
    null,
    "",
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "inventario",
    "/inventario\r\nSet-Cookie:x=1",
    `/${"a".repeat(600)}`,
  ])("falls back for %j", (value) => {
    expect(safeRedirectPath(value)).toBe(DEFAULT_AFTER_SIGN_IN);
  });
});
