import { describe, expect, it } from "vitest";

import {
  BACKUP_CODE_COUNT,
  generateBackupCodes,
  normalizeBackupCode,
} from "./backup-codes";

describe("generateBackupCodes", () => {
  it("creates 10 distinct, easy-to-read codes", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
    for (const code of codes) {
      expect(code).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
      expect(code).not.toMatch(/[01ilo]/);
    }
  });
});

describe("normalizeBackupCode", () => {
  it("accepts what people type: case, spaces and missing dash", () => {
    expect(normalizeBackupCode(" K7M2P 9XQ4T ")).toBe("k7m2p-9xq4t");
    expect(normalizeBackupCode("k7m2p9xq4t")).toBe("k7m2p-9xq4t");
    expect(normalizeBackupCode("k7m2p-9xq4t")).toBe("k7m2p-9xq4t");
  });

  it("rejects anything that cannot be a backup code", () => {
    expect(normalizeBackupCode("123456")).toBeNull();
    expect(normalizeBackupCode("k7m2p-9xq4")).toBeNull();
    expect(normalizeBackupCode("k7m2p-9xq40")).toBeNull();
  });
});
