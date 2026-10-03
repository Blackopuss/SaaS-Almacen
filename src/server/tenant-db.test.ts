import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { TENANT_MODELS } from "./tenant-db";

// PLT-12: every model with an organizationId column must go through the
// company-scoped client. A new business table that is not registered fails
// here before it can be queried without its company filter.

const schema = readFileSync(
  path.join(process.cwd(), "prisma/schema.prisma"),
  "utf8",
);

function modelsWithOrganizationId(): string[] {
  const models: string[] = [];
  for (const [, name, body] of schema.matchAll(
    /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm,
  )) {
    if (/^\s*organizationId\s/m.test(body!)) models.push(name!);
  }
  return models.sort();
}

describe("TENANT_MODELS", () => {
  it("lists exactly the models that carry organizationId", () => {
    expect([...TENANT_MODELS].sort()).toEqual(modelsWithOrganizationId());
  });
});
