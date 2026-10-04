import { describe, expect, it } from "vitest";

import { dec } from "@/lib";

import {
  convertCapture,
  describeInPresentation,
  pluralizeName,
  type Capture,
  type ResolvedPresentation,
} from "./conversion";

// INV-09: conversion to the product's unit with a preview.
// «3 cajas × 100 = 300 piezas»; incompatible dimensions are rejected.

const pieces = { unitCode: "piece", quantityStep: "1" };
const meters = { unitCode: "m", quantityStep: "0.01" };
const kilos = { unitCode: "kg", quantityStep: "0.001" };

const presentation = (
  name: string,
  factor: string,
  version = 1,
): ResolvedPresentation => ({
  id: `p-${name}`,
  name,
  versionId: `v-${name}-${version}`,
  version,
  factor,
});

const caja = presentation("Caja", "100");

function run(
  rule: typeof pieces,
  capture: Capture,
  resolved: ResolvedPresentation | null = null,
) {
  const result = convertCapture(rule, capture, resolved);
  return result.ok
    ? {
        base: result.conversion.baseQuantity.toString(),
        preview: result.conversion.preview,
      }
    : result.error;
}

describe("capture in a presentation", () => {
  it("3 cajas × 100 = 300 piezas", () => {
    const result = convertCapture(
      pieces,
      { kind: "presentation", quantity: "3", presentationId: caja.id },
      caja,
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.conversion.preview).toBe("3 cajas × 100 = 300 piezas");
    expect(result.conversion.baseQuantity.toString()).toBe("300");
    expect(result.conversion.capturedQuantity.toString()).toBe("3");
    expect(result.conversion.factor.toString()).toBe("100");
    // The movement will keep exactly which version was used.
    expect(result.conversion.presentation).toEqual(caja);
  });

  it("the examples of the plan", () => {
    const rollo = presentation("Rollo", "100");
    const bolsa = presentation("Bolsa", "5");
    const cubeta = presentation("Cubeta", "19");
    expect(
      run(
        meters,
        { kind: "presentation", quantity: "2", presentationId: rollo.id },
        rollo,
      ),
    ).toEqual({ base: "200", preview: "2 rollos × 100 = 200 metros" });
    expect(
      run(
        kilos,
        { kind: "presentation", quantity: "3", presentationId: bolsa.id },
        bolsa,
      ),
    ).toEqual({ base: "15", preview: "3 bolsas × 5 = 15 kilogramos" });
    expect(
      run(
        { unitCode: "l", quantityStep: "0.01" },
        { kind: "presentation", quantity: "2", presentationId: cubeta.id },
        cubeta,
      ),
    ).toEqual({ base: "38", preview: "2 cubetas × 19 = 38 litros" });
    expect(
      run(
        pieces,
        { kind: "presentation", quantity: "1", presentationId: caja.id },
        caja,
      ),
    ).toEqual({ base: "100", preview: "1 caja × 100 = 100 piezas" });
  });

  it("uses the version it is given: 120 after the content changed", () => {
    const v2 = presentation("Caja", "120", 2);
    expect(
      run(
        pieces,
        { kind: "presentation", quantity: "1", presentationId: v2.id },
        v2,
      ),
    ).toEqual({ base: "120", preview: "1 caja × 120 = 120 piezas" });
  });

  it("presentations are counted whole", () => {
    expect(
      run(
        pieces,
        { kind: "presentation", quantity: "2.5", presentationId: caja.id },
        caja,
      ),
    ).toBe(
      "Las presentaciones se capturan completas. Para una parte de caja, captura en piezas.",
    );
    for (const quantity of ["0", "-1", "", "tres"]) {
      expect(
        typeof run(
          pieces,
          { kind: "presentation", quantity, presentationId: caja.id },
          caja,
        ),
        quantity,
      ).toBe("string");
    }
  });

  it("a presentation that is missing or of another product is refused", () => {
    const message = "Esa presentación no existe para este producto.";
    expect(
      run(
        pieces,
        { kind: "presentation", quantity: "3", presentationId: "x" },
        null,
      ),
    ).toBe(message);
    expect(
      run(
        pieces,
        { kind: "presentation", quantity: "3", presentationId: "otra" },
        caja,
      ),
    ).toBe(message);
  });

  it("the result must fit the maximum", () => {
    const pallet = presentation("Tarima", "500000000");
    expect(
      run(
        pieces,
        { kind: "presentation", quantity: "2", presentationId: pallet.id },
        pallet,
      ),
    ).toBe("La cantidad es demasiado grande.");
  });
});

describe("capture in the product's unit", () => {
  it("is the quantity itself", () => {
    expect(run(pieces, { kind: "base", quantity: "25" })).toEqual({
      base: "25",
      preview: "25 piezas",
    });
    expect(run(meters, { kind: "base", quantity: "2.75" })).toEqual({
      base: "2.75",
      preview: "2.75 metros",
    });
    expect(run(pieces, { kind: "base", quantity: "1" })).toEqual({
      base: "1",
      preview: "1 pieza",
    });
  });

  it("follows the product's increment", () => {
    expect(run(pieces, { kind: "base", quantity: "0.5" })).toMatch(
      /piezas completas/,
    );
  });
});

describe("capture in another unit of the same dimension", () => {
  it("converts exactly", () => {
    expect(
      run(meters, { kind: "unit", quantity: "275", unitCode: "cm" }),
    ).toEqual({ base: "2.75", preview: "275 centímetros = 2.75 metros" });
    expect(
      run(kilos, { kind: "unit", quantity: "750", unitCode: "g" }),
    ).toEqual({
      base: "0.75",
      preview: "750 gramos = 0.75 kilogramos",
    });
    expect(
      run(pieces, { kind: "unit", quantity: "3", unitCode: "dozen" }),
    ).toEqual({ base: "36", preview: "3 docenas = 36 piezas" });
    expect(
      run(meters, { kind: "unit", quantity: "2.75", unitCode: "m" }),
    ).toEqual({ base: "2.75", preview: "2.75 metros" });
  });

  it.each([
    [pieces, "kg"],
    [kilos, "piece"],
    [meters, "l"],
    [kilos, "m"],
    [meters, "m2"],
  ])("rejects incompatible dimensions (%o ← %s)", (rule, unitCode) => {
    expect(run(rule, { kind: "unit", quantity: "1", unitCode })).toMatch(
      /miden cosas distintas/,
    );
  });

  it("rejects what does not fit the product's increment instead of rounding", () => {
    // 5 mm = 0.005 m, finer than hundredths of a meter.
    expect(run(meters, { kind: "unit", quantity: "5", unitCode: "mm" })).toBe(
      "Eso equivale a 0.005 metros, y este producto se maneja en pasos de 0.01 metros.",
    );
    // 7 pieces is not a whole number of dozens.
    expect(
      run(
        { unitCode: "dozen", quantityStep: "1" },
        { kind: "unit", quantity: "6", unitCode: "piece" },
      ),
    ).toBe("Eso equivale a 0.5 docenas, y este producto no admite fracciones.");
    expect(
      run(
        { unitCode: "dozen", quantityStep: "1" },
        { kind: "unit", quantity: "24", unitCode: "piece" },
      ),
    ).toEqual({ base: "2", preview: "24 piezas = 2 docenas" });
  });

  it("rejects an unknown unit", () => {
    expect(run(pieces, { kind: "unit", quantity: "1", unitCode: "caja" })).toBe(
      "Esa unidad no existe.",
    );
  });
});

describe("the required case of the plan", () => {
  it("300 − 25 = 275; a new box of 120 → 395; exact meters", () => {
    const entry = convertCapture(
      pieces,
      { kind: "presentation", quantity: "3", presentationId: caja.id },
      caja,
    );
    const exit = convertCapture(pieces, { kind: "base", quantity: "25" });
    const v2 = presentation("Caja", "120", 2);
    const second = convertCapture(
      pieces,
      { kind: "presentation", quantity: "1", presentationId: v2.id },
      v2,
    );
    if (!entry.ok || !exit.ok || !second.ok) throw new Error("expected ok");
    const stock = entry.conversion.baseQuantity
      .minus(exit.conversion.baseQuantity)
      .plus(second.conversion.baseQuantity);
    expect(stock.toString()).toBe("395");

    const rollo = presentation("Rollo", "100");
    const rolls = convertCapture(
      meters,
      { kind: "presentation", quantity: "2", presentationId: rollo.id },
      rollo,
    );
    const cut = convertCapture(meters, { kind: "base", quantity: "2.75" });
    if (!rolls.ok || !cut.ok) throw new Error("expected ok");
    expect(
      rolls.conversion.baseQuantity
        .minus(cut.conversion.baseQuantity)
        .toString(),
    ).toBe("197.25");
  });
});

describe("describeInPresentation", () => {
  it("shows a stock quantity as boxes and loose units", () => {
    expect(describeInPresentation(pieces, dec(250), caja)).toBe(
      "250 piezas, equivalentes a 2 cajas de 100 y 50 piezas",
    );
    expect(describeInPresentation(pieces, dec(300), caja)).toBe(
      "300 piezas, equivalentes a 3 cajas de 100",
    );
    expect(describeInPresentation(pieces, dec(100), caja)).toBe(
      "100 piezas, equivalentes a 1 caja de 100",
    );
    expect(describeInPresentation(pieces, dec(40), caja)).toBe("40 piezas");
    expect(
      describeInPresentation(
        meters,
        dec("197.25"),
        presentation("Rollo", "100"),
      ),
    ).toBe("197.25 metros, equivalentes a 1 rollo de 100 y 97.25 metros");
  });
});

describe("pluralizeName", () => {
  it.each([
    ["Caja", "cajas"],
    ["Rollo", "rollos"],
    ["Saco", "sacos"],
    ["Costal", "costales"],
    ["Paquete", "paquetes"],
    ["Blíster", "blísteres"],
    ["Lápiz", "lápices"],
    ["Atados", "atados"],
    ["Caja chica", "caja chica"],
  ])("%s → %s", (name, plural) => {
    expect(pluralizeName(name, dec(3))).toBe(plural);
    expect(pluralizeName(name, dec(1))).toBe(name.toLowerCase());
  });
});
