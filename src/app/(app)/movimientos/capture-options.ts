import {
  getUnit,
  unitsOfDimension,
  type Presentation,
} from "@/platform/catalog";

export type CaptureOption = { value: string; label: string; hint: string };

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Ways to count a quantity of a product in a form, built in the server:
 * its own unit first ("base"), then its presentations ("p:<id>") and the
 * other units of the same kind ("u:<code>"). The content of a presentation
 * is only shown here; the service reads it again when the form is sent.
 */
export function captureOptions(
  product: { unitCode: string; quantityStep: string },
  presentations: Presentation[],
): CaptureOption[] {
  const unit = getUnit(product.unitCode);
  // "0.010" → 2 decimals; "1" → none. Text only: quantities are never floats.
  const decimals = (product.quantityStep.split(".")[1] ?? "").replace(
    /0+$/,
    "",
  ).length;
  return [
    {
      value: "base",
      label: capital(unit.plural),
      hint:
        decimals === 0
          ? `En ${unit.plural}, sin fracciones.`
          : `En ${unit.plural}, hasta ${decimals} ${decimals === 1 ? "decimal" : "decimales"}.`,
    },
    ...presentations.map((presentation) => ({
      value: `p:${presentation.id}`,
      label: presentation.label,
      hint: `${presentation.label}. Se capturan completas.`,
    })),
    ...unitsOfDimension(unit.dimension)
      .filter((other) => other.code !== unit.code)
      .map((other) => ({
        value: `u:${other.code}`,
        label: capital(other.plural),
        hint: `En ${other.plural}; se guarda en ${unit.plural}.`,
      })),
  ];
}
