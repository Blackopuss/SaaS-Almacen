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
- **CMP-07 recibe todo lo pendiente** en una ubicación elegida (por omisión, General). La recepción parcial (CMP-08), la ubicación y presentación por línea (CMP-09) y las pruebas de concurrencia de cantidades (CMP-10) se apoyan en las mismas tablas.

## Consecuencias

- El historial de movimientos, las exportaciones y la reconciliación incluyen las recepciones sin cambios: el saldo sigue siendo la suma de líneas.
- El último costo (CMP-13) todavía no se escribe al recibir.
- Una orden con un producto archivado no se puede recibir hasta reactivarlo; CMP-11 impedirá archivar un producto con orden abierta.

## A confirmar por el fundador

- Qué hacer cuando el proveedor manda más de lo pedido: hoy no se recibe por la orden (se registra aparte como entrada).
- Si la remisión del proveedor debe ser obligatoria.
