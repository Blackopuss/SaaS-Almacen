import { describe, expect, it } from "vitest";

import { contentSecurityPolicy, newNonce } from "./csp";

describe("contentSecurityPolicy", () => {
  it("allows scripts only with the request nonce in production", () => {
    const policy = contentSecurityPolicy("abc123", {
      development: false,
      https: true,
    });
    expect(policy).toContain(
      "script-src 'self' 'nonce-abc123' 'strict-dynamic';",
    );
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toMatch(/upgrade-insecure-requests$/);
  });

  it("adds eval and the reload socket only in development", () => {
    const policy = contentSecurityPolicy("n", {
      development: true,
      https: false,
    });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("connect-src 'self' ws: wss:");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});

describe("newNonce", () => {
  it("is different every time and safe inside a header", () => {
    const nonces = new Set(Array.from({ length: 50 }, newNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
