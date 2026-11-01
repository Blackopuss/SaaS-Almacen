import { dec } from "@/lib";
import { getUnit, pluralizeName } from "@/platform/catalog";

/**
 * How a line of a quote or an order says its quantity: «2 cajas de 500
 * piezas», «2.75 metros», «1 pieza».
 */
export function quantityText(line: {
  capturedQuantity: { toString(): string };
  factor: { toString(): string };
  unitCode: string;
  presentation: { name: string } | null;
}): string {
  const unit = getUnit(line.unitCode);
  const captured = dec(line.capturedQuantity.toString());
  return line.presentation
    ? `${captured.toString()} ${pluralizeName(line.presentation.name, captured)} de ${dec(line.factor.toString()).toString()} ${unit.plural}`
    : `${captured.toString()} ${captured.equals(1) ? unit.name : unit.plural}`;
}
