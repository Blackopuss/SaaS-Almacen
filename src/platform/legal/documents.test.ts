import { describe, expect, it } from "vitest";

import {
  LEGAL_DOCUMENTS,
  legalConsentSchema,
  legalVersionDate,
} from "./documents";

describe("legal documents", () => {
  it("versions are calendar dates", () => {
    for (const document of Object.values(LEGAL_DOCUMENTS)) {
      expect(document.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(legalVersionDate(document.version)).not.toMatch(/Invalid/);
    }
    expect(legalVersionDate("2026-10-16")).toBe("16 de octubre de 2026");
  });

  it("consent must be explicit", () => {
    expect(legalConsentSchema.safeParse(true).success).toBe(true);
    expect(legalConsentSchema.safeParse(false).success).toBe(false);
  });
});
