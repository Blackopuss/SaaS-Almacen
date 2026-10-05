import { describe, expect, it } from "vitest";

import {
  LOCATION_KINDS,
  canContain,
  compareLocationNames,
  formatLocationPath,
  isLocationKind,
  kindsInside,
  type AnyLocationKind,
} from "./kinds";

const ALL: AnyLocationKind[] = ["GENERAL", ...LOCATION_KINDS];

describe("kinds of location", () => {
  it("a location only goes inside a coarser kind", () => {
    expect(canContain("ZONE", "AISLE")).toBe(true);
    expect(canContain("ZONE", "SHELF")).toBe(true);
    expect(canContain("AISLE", "SHELF")).toBe(true);
    expect(canContain("AISLE", "ZONE")).toBe(false);
    expect(canContain("SHELF", "AISLE")).toBe(false);
    for (const kind of ALL) expect(canContain(kind, kind), kind).toBe(false);
  });

  it("General holds nothing and goes inside nothing", () => {
    for (const kind of ALL) {
      expect(canContain("GENERAL", kind), kind).toBe(false);
      expect(canContain(kind, "GENERAL"), kind).toBe(false);
    }
  });

  it("no pair of kinds can contain each other, so no cycle can be built", () => {
    for (const a of ALL) {
      for (const b of ALL) {
        expect(canContain(a, b) && canContain(b, a), `${a}/${b}`).toBe(false);
      }
    }
  });

  it("levels are optional: every kind may hang from the facility", () => {
    expect(kindsInside(null)).toEqual(["ZONE", "AISLE", "SHELF"]);
    expect(kindsInside("ZONE")).toEqual(["AISLE", "SHELF"]);
    expect(kindsInside("AISLE")).toEqual(["SHELF"]);
    expect(kindsInside("SHELF")).toEqual([]);
    expect(kindsInside("GENERAL")).toEqual([]);
  });

  it("General is not a kind a business can create", () => {
    expect(isLocationKind("ZONE")).toBe(true);
    expect(isLocationKind("GENERAL")).toBe(false);
    expect(isLocationKind("zone")).toBe(false);
    expect(isLocationKind(undefined)).toBe(false);
  });

  it("formats a path and orders names like a person would", () => {
    expect(formatLocationPath(["Zona A", "Pasillo 2", "Estante 3"])).toBe(
      "Zona A › Pasillo 2 › Estante 3",
    );
    expect(
      ["Pasillo 10", "pasillo 2", "Área B", "area a", "Pasillo 1"].sort(
        compareLocationNames,
      ),
    ).toEqual(["area a", "Área B", "Pasillo 1", "pasillo 2", "Pasillo 10"]);
  });
});
