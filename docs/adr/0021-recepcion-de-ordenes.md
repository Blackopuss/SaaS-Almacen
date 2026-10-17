# ADR 0021 — Recepción de órdenes de compra

Fecha: 2026-10-15 · Estado: aceptada (puntos a confirmar por el fundador) · Pasos: CMP-07 (y la base de CMP-08..10)

## Contexto

Recibir una orden es lo que une Compras con Inventario: la mercancía entra al almacén y la orden dice que llegó. El plan exige que ambas cosas ocurran juntas («recepción y entrada de inventario en la misma transacción») y la matriz dice que recibir pide permisos de Compras (`purchasing.receipt.create`), no los de entrada manual, y que una recepción no se deshace con la reversa de Inventario (NEG-22).

## Decisión

- **Un documento propio:** `purchase_receipt` (orden, movimiento, remisión del proveedor, quién y cuándo, clave de confirmación) y `purchase_receipt_line` (qué línea de la orden recibe, producto, ubicación, cantidad recibida, presentación con su versión, factor y cantidad en la unidad del producto). Ambos son historia: no se editan ni se borran (disparadores).
- **Un tipo de movimiento nuevo, `RECEIPT`** («Recepción de compra»), escrito por Inventario (`postReceiptEntry`) dentro de la transacción de Compras. Una recepción = un movimiento con una línea por producto; el movimiento lleva como referencia el número de la orden y la remisión.
- **Todo o nada.** En una sola transacción (`LOCKING_TRANSACTION`): candados de productos → ubicación → orden; clave de confirmación; estado de la orden; lo pendiente; la entrada de inventario (conversión, movimiento, líneas, saldos); la recepción y sus líneas; el estado nuevo de la orden; y la bitácora. Si algo falla (un producto archivado, la ubicación archivada) no queda nada escrito.
- **Lo pendiente se cuenta en los términos de la orden.** Si se pidieron 3 cajas y llegó 1, faltan 2 cajas, aunque el contenido de la caja cambie entre tanto. Lo que entra al inventario se convierte con el contenido **vigente al recibir** (lo que de verdad trae la caja hoy) y la recepción guarda ese factor y su versión. La pantalla de recepciones muestra «3 cajas × 120 = 360 piezas».
- **La base lo repite:** una recepción solo se inserta si su orden está enviada o recibida en parte y su movimiento es `RECEIPT`; cada línea debe ser de una línea de esa misma orden, del mismo producto y presentación, en la unidad del producto; cantidades positivas y base = recibida × factor exactos (`CHECK`).
- **Repetir no duplica.** El formulario lleva una clave creada al pintar la pantalla; un reintento con la misma clave responde con la recepción ya hecha, y si la respuesta se perdió la pantalla pregunta por la clave antes de dejar reintentar (INV-22). Dos recepciones distintas a la vez quedan en fila por el candado de la orden: la segunda ve la orden ya recibida y se rechaza.
- **Corrección desde Compras.** La reversa de Inventario rechaza un movimiento `RECEIPT` y la pantalla de movimientos no ofrece «Reversar» para él: lo que llegó de más o mal se devolverá al proveedor (CMP-12), que deja documento y salida juntos.
- **Recepción parcial (CMP-08):** la persona dice cuánto llegó de cada línea (vacío o 0 = no llegó). Cada cantidad se valida con la regla de la línea (presentaciones completas, paso del producto) y contra lo pendiente, leído con la orden bloqueada: nunca más de lo que falta. La orden queda «Recibida en parte» mientras falte algo y «Recibida» cuando no falta nada.
- **Destino y contenido (CMP-09):** la recepción tiene una ubicación para todo y cada línea puede ir a otra; todas se bloquean juntas (en orden de id) antes de leer. Antes de confirmar se ve el contenido vigente de cada presentación y, si cambió desde la orden, el de la orden: entra el vigente.
- **Concurrencia y reintentos (CMP-10):** el candado de la orden pone en fila las recepciones y la cancelación; cada una vuelve a leer lo pendiente bajo el candado, así que la suma de recepciones simultáneas nunca pasa de lo pedido. Una clave ya usada solo se acepta como reintento si es de la misma persona, la misma orden y pide lo mismo (líneas, cantidades y destino); si no, se rechaza sin escribir.
- **Cierre con faltante (CMP-11):** estado nuevo `CLOSED` («Cerrada con faltante»), solo desde «recibida en parte», con fecha, persona y motivo (`CHECK`). El faltante no se guarda aparte: es lo pedido − lo recibido, que ya no cambia porque una orden cerrada no recibe (disparador de recepciones) y sus líneas no se editan. La bitácora guarda el texto del faltante. Cerrar bloquea solo la orden, el último candado de una recepción.
- **Producto con orden abierta (CMP-11):** `archiveProduct` (Catálogo) rechaza si una orden enviada o recibida en parte todavía espera algo del producto; lo consulta en las tablas de Compras dentro de su transacción, como ya consulta saldos. Confirmar una orden bloquea primero sus productos (orden producto → orden), así archivar y confirmar a la vez quedan en fila.
- **Devoluciones (CMP-12):** documento propio `purchase_return` + `purchase_return_line` (por línea de recepción), inmutable, con movimiento `RETURN` (salida) escrito por Inventario (`postReturnExit`) en la misma transacción. Cada línea sale con el factor y la presentación de su línea de recepción, no con el contenido vigente. Límite acumulado: lo devuelto de una línea de recepción, sumando todas sus devoluciones, nunca pasa de lo recibido; se decide con la orden bloqueada (productos → ubicaciones → orden) y lo repite un disparador. Nunca deja saldo negativo. Clave de confirmación igual que las recepciones. Una devolución no cambia el estado de la orden ni vuelve a dejar pendiente lo devuelto (pregunta para el fundador). La reversa de Inventario rechaza `RETURN`.
- **Costo de compra (CMP-13):** al recibir, `recordLastCost` (ADR 0017) escribe en `product_supplier` el costo de la línea de la orden para la versión de presentación con que llegó; si no había vínculo producto-proveedor, se crea. La línea de recepción copia ese costo (`unitCost`, privado de quien no tiene `purchasing.cost.read`). Sin valuación contable. Las devoluciones no tocan el último costo.
- **CMP-07 recibe todo lo pendiente** en una ubicación elegida (por omisión, General). La recepción parcial (CMP-08), la ubicación y presentación por línea (CMP-09) y las pruebas de concurrencia de cantidades (CMP-10) se apoyan en las mismas tablas.

## Consecuencias

- El historial de movimientos, las exportaciones y la reconciliación incluyen las recepciones sin cambios: el saldo sigue siendo la suma de líneas.
- El último costo (CMP-13) todavía no se escribe al recibir.
- Una orden con un producto archivado no se puede recibir hasta reactivarlo; CMP-11 impedirá archivar un producto con orden abierta.

## A confirmar por el fundador

- Qué hacer cuando el proveedor manda más de lo pedido: hoy no se recibe por la orden (se registra aparte como entrada).
- Si la remisión del proveedor debe ser obligatoria.
- Si una devolución debe volver a dejar pendiente lo devuelto en la orden (para que el proveedor lo reponga) en lugar de pedirlo en otra orden.
