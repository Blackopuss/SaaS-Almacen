# ADR 0031 — Valor del inventario a costo promedio

Fecha: 2026-10-27 · Estado: aceptada · Pasos: VAL-01..06 · Cambia: ADR 0017

## Contexto

El fundador pidió valorar el inventario como SAP (ADR 0030): a costo, no a precio de venta (NIF C-4), y antes de Ventas, para que cada venta muestre su ganancia y el enganche de una venta a plazos cubra el costo. Hasta ahora solo existía el último costo por proveedor (ADR 0017), que no dice cuánto vale lo que hay.

## Decisión

- **Costo promedio por producto** (precio medio variable de SAP), en la unidad del producto y antes de impuestos, para toda la empresa (no por ubicación: cambiar algo de lugar no cambia su valor).
- **Se guarda como SAP:** el valor de todas las existencias y el precio de una unidad, en la tabla propia `product_cost` (una fila por producto, sin fila mientras no hay costo conocido). Está aparte de `product` para que el costo solo se lea a propósito, por quien puede verlo.
- **Reglas** (puras, en `src/modules/inventory/average-cost.ts`, con pruebas):
  - Una entrada con costo suma cantidad × costo al valor; el precio queda en valor ÷ cantidad. 10 a $85 + 10 a $95 → $90.
  - Una entrada sin costo entra al precio vigente, que no cambia. Un producto sin costo conocido sigue sin él.
  - El primer costo conocido valora también las existencias que no tenían: nunca hay valor de solo una parte.
  - Una salida resta cantidad × precio y nunca mueve el precio. Al quedar en cero, el valor queda en cero (se va el residuo del redondeo) y el precio se conserva para la siguiente entrada.
  - Seis decimales, redondeo a la mitad hacia arriba.
- **Cada línea de movimiento guarda su `unitCost`**: el costo de una entrada o el promedio que se llevó una salida (nulo si no había costo). Las líneas siguen siendo inmutables; con ellas se puede reconstruir el valor.
- **Mismo candado que las existencias:** el costo se lee y se escribe dentro de la transacción del movimiento, después de `lockRows(tx, "product", …)`, que ya bloquea cada producto que se mueve.
- **Casos especiales** (pasos siguientes):
  - Recepción de Compras (VAL-02): costo de la línea de la orden ÷ factor de la presentación.
  - Devolución al proveedor y reversa de una entrada: salen al costo con que entraron, no al promedio.
  - Reversa de una salida: vuelve a entrar al costo con que salió.
  - Traspaso entre ubicaciones y ajustes: al promedio vigente.
- **Captura manual del costo (cambia ADR 0017):** además de las recepciones, el costo se puede capturar en entradas, saldo inicial e importación, solo con el permiso nuevo de registrar costos (titular, administrador, comprador). Ver costos y valor exige el permiso de lectura de costos; para los demás el dato no existe en la respuesta (como CMP-03).

## Lo que no se hace

- Costo por ubicación, PEPS/UEPS o costo estándar.
- Revaluar a mano el precio de un producto: el precio solo cambia con entradas con costo.
- Recalcular el pasado: los movimientos anteriores a VAL quedan sin `unitCost`; los productos arrancan con su último costo de compra (VAL-06).

## Consecuencias

- Toda operación que mueva existencias tendrá que actualizar `product_cost` en su transacción y guardar `unitCost` (VAL-02..04). La reconciliación compara también el valor.
- La migración es solo de expansión (tabla y columna nuevas): la versión anterior las ignora.
