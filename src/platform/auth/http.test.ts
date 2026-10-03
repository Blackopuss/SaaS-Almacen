import { describe, expect, it } from "vitest";

import { isAllowedAuthRequest } from "./http";

const at = (method: string, path: string) =>
  new Request(`http://localhost:3000${path}`, { method });

describe("isAllowedAuthRequest", () => {
  it("lets through only the email links", () => {
    expect(
      isAllowedAuthRequest(at("GET", "/api/auth/verify-email?token=a")),
    ).toBe(true);
    expect(
      isAllowedAuthRequest(
        at("GET", "/api/auth/reset-password/abc_DEF-123?callbackURL=%2Fx"),
      ),
    ).toBe(true);
    expect(isAllowedAuthRequest(at("GET", "/api/auth/verify-email/"))).toBe(
      true,
    );
  });

  it("refuses other methods and paths", () => {
    expect(isAllowedAuthRequest(at("POST", "/api/auth/verify-email"))).toBe(
      false,
    );
    expect(isAllowedAuthRequest(at("HEAD", "/api/auth/verify-email"))).toBe(
      false,
    );
    expect(isAllowedAuthRequest(at("POST", "/api/auth/reset-password"))).toBe(
      false,
    );
    expect(isAllowedAuthRequest(at("GET", "/api/auth/get-session"))).toBe(
      false,
    );
    expect(isAllowedAuthRequest(at("GET", "/api/auth"))).toBe(false);
  });

  it("is not fooled by path tricks", () => {
    // URL normalizes ".." before the check.
    expect(
      isAllowedAuthRequest(
        at("GET", "/api/auth/verify-email/../sign-in/email"),
      ),
    ).toBe(false);
    expect(
      isAllowedAuthRequest(
        at("GET", "/api/auth/reset-password/a%2F..%2Fsign-out"),
      ),
    ).toBe(false);
    expect(
      isAllowedAuthRequest(at("GET", "/api/auth/reset-password/a/b")),
    ).toBe(false);
    expect(isAllowedAuthRequest(at("GET", "/api/authx/verify-email"))).toBe(
      false,
    );
  });
});
