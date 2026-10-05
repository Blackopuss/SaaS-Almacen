# ADR 0012 — Movimientos, líneas y saldos

Fecha: 2026-10-04 · Estado: aceptada · Paso: INV-15

## Contexto

El plan exige que todo cambio de existencias sea un movimiento confirmado e inmutable, que el saldo sea una proyección reconciliable del historial, que cada línea conserve lo capturado, el factor, la versión de la presentación y la cantidad en la unidad del producto, y que el saldo nunca sea negativo aunque lleguen dos salidas a la vez.

## Decisión

- **`stock_movement`**: una confirmación (quién, cuándo, tipo, motivo, referencia). Tipos: `ENTRY`, `EXIT`, `TRANSFER`, `ADJUSTMENT`, `INITIAL`, `REVERSAL`; recepciones y conteos agregarán los suyos con su migración. `idempotencyKey` único por empresa cuando existe (INV-21). `reversesMovementId` solo en reversas, obligatorio en ellas y único: un movimiento se reversa una vez (INV-25).
- **`stock_movement_line`**: un producto en una ubicación, con dirección `IN` u `OUT`. Una reubicación son dos líneas del mismo movimiento (sale del origen, entra al destino). Guarda `capturedQuantity`, `capturedUnitCode` (si se capturó en otra unidad), `presentationId` + `presentationVersionId` (si se capturó en una presentación), `factor`, `baseQuantity` y `unitCode` (la unidad del producto en ese momento).
- **La base comprueba la equivalencia**: `CHECK (baseQuantity = capturedQuantity * factor)` con decimales exactos, cantidades positivas, y que la captura sea exactamente una de tres formas (unidad del producto con factor 1, presentación con su versión, u otra unidad). Llaves compuestas garantizan que la presentación es de ese producto y la versión de esa presentación, y que producto, ubicación y movimiento son de la misma empresa. Un disparador exige que `unitCode` sea la unidad del producto.
- **Inmutables**: disparadores rechazan `UPDATE` y `DELETE` sobre movimientos y líneas. Un error se corrige con una reversa.
- **`stock_balance`**: una fila por empresa, producto y ubicación, en la unidad del producto, con `CHECK (quantity >= 0)`. Se actualiza en la misma transacción que el movimiento (INV-16 en adelante); el `CHECK` es la última defensa contra dos salidas simultáneas.
- **Reconciliación**: `reconcileStock(organizationId)` (`src/modules/inventory`) recalcula entradas menos salidas por producto y ubicación y devuelve las diferencias con el saldo guardado. Debe devolver siempre una lista vacía; las pruebas de cada tipo de movimiento la usan.
- **La unidad queda fija con el primer movimiento**: `updateProduct` rechaza cambiarla (y la base también, con un disparador). La precisión solo puede hacerse más fina, para que toda cantidad ya registrada siga siendo válida.
- Los servicios que escriben movimientos viven en `src/modules/inventory` (Compras los usará por su `index.ts`); las tablas siguen el patrón de empresa (`TENANT_MODELS`, `forOrganization`).

## Consecuencias

- El saldo por ubicación se lee en una fila; el total de un producto es la suma de sus ubicaciones (no hay un segundo saldo editable).
- El historial nunca cambia aunque cambie el contenido de una presentación: la línea apunta a la versión que usó y guarda su factor.
- `factor` usa `DECIMAL(18,6)` para admitir conversiones entre unidades (milímetro a metro) además del contenido de las presentaciones; las cantidades usan `DECIMAL(12,3)` (tope de captura 999,999,999.999) y el saldo `DECIMAL(18,3)`.
- Pendiente: no archivar productos ni ubicaciones con existencias (INV-19B, NEG-21); clave idempotente en los servicios (INV-21).
