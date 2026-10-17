import { afterAll, describe, expect, it } from "vitest";

import { UNITS } from "@/platform/catalog";
import { db } from "@/server";

// INV-05: the units seeded in the database are exactly the catalog in code.

afterAll(async () => {
  await db.$disconnect();
});

describe("unit table", () => {
  it("is seeded with the catalog", async () => {
    const rows = await db.unit.findMany();
    const normalize = (unit: {
      code: string;
      dimension: string;
      name: string;
      plural: string;
      symbol: string;
      toReference: { toString(): string } | string;
      fractional: boolean;
    }) => ({ ...unit, toReference: Number(unit.toReference.toString()) });
    const byCode = (a: { code: string }, b: { code: string }) =>
      a.code.localeCompare(b.code);
    expect(rows.map(normalize).sort(byCode)).toEqual(
      UNITS.map(normalize).sort(byCode),
    );
  });

  it("survives the cleaning of the test database", async () => {
    expect(await db.unit.count()).toBe(UNITS.length);
  });

  it("rejects a unit without a positive factor or with an unknown dimension", async () => {
    await expect(
      db.$executeRaw`INSERT INTO unit (code, dimension, name, plural, symbol, toReference, fractional) VALUES ('zero', 'mass', 'x', 'x', 'x', 0, true)`,
    ).rejects.toThrow(/unit_values_check/);
    await expect(
      db.$executeRaw`INSERT INTO unit (code, dimension, name, plural, symbol, toReference, fractional) VALUES ('temp', 'heat', 'x', 'x', 'x', 1, true)`,
    ).rejects.toThrow(/unit_values_check/);
  });
});
