# ADR 0018 — Órdenes de compra: borrador, líneas y estados

Fecha: 2026-10-10 · Estado: aceptada (puntos a confirmar por el fundador) · Pasos: CMP-04, CMP-05

## Contexto

Una orden de compra es lo que el negocio le pide a un proveedor. Es el documento del que después salen el PDF que se envía (CMP-06), las recepciones que suben existencias (CMP-07 a CMP-10) y el último costo (CMP-13). Este paso crea el documento y sus líneas; los estados y sus transiciones llegan en CMP-05.

## Decisión

- **Dos tablas de la empresa:** `purchase_order` y `purchase_order_line`, del módulo Compras (`src/modules/purchasing/orders.ts`).
- **Numeración consecutiva por empresa** («OC-0001»), asignada al empezar el borrador. Se toma el siguiente número libre y un índice único decide si dos órdenes empezadas a la vez pidieron el mismo: la que pierde vuelve a pedir. No hay tabla de contadores (ver IMP-S13 para el porqué).
- **El proveedor no cambia** después de empezar la orden: el código del proveedor de cada línea y la presentación sugerida dependen de él. Para otro proveedor se hace otra orden.
- **Una línea guarda lo mismo que una línea de movimiento:** lo capturado, la presentación con la **versión** de su contenido en ese momento, el factor y el resultado en la unidad del producto, con la igualdad `base = capturada × factor` comprobada por la base. Lo pedido queda como se pidió («3 cajas × 100 = 300 piezas») aunque la caja cambie después; qué factor se usa al recibir se decide en CMP-09. El navegador solo manda la forma elegida (`base` o `p:<id>`) y lo tecleado; el contenido se lee dentro de la transacción.
- **Solo un borrador se cambia.** Agregar, editar o quitar líneas y editar sus datos empieza bloqueando la fila de la orden y comprobando que siga en borrador (`lockDraft`): dos cambios a la misma orden ocurren uno tras otro y ninguno cae sobre una orden que ya se envió.
- **Costo por unidad capturada** (una caja, un metro), en pesos, antes de impuestos, con decimal exacto de hasta 4 decimales; opcional mientras es borrador. Escribirlo o borrarlo exige `purchasing.cost.record`; verlo, `purchasing.cost.read`. Para quien no puede verlo, la columna no se consulta y el campo no existe en la respuesta, igual que el total. La lista de órdenes no lleva importes.
- **El importe y el total se calculan**, no se guardan: cantidad capturada × costo, sumado sin redondear. Las líneas sin costo se cuentan aparte y el total lo avisa.
- **Sin impuestos por ahora.** El total dice «antes de impuestos». El cálculo de IVA pertenece a Ventas (VEN-04) y, en Compras, a cuando se registre la factura del proveedor.

### Estados (CMP-05)

- **Cinco estados y seis movimientos:** borrador → enviada o cancelada; enviada → recibida en parte, recibida o cancelada; recibida en parte → recibida. Recibida y cancelada son finales; nada vuelve atrás. La tabla vive una sola vez en código (`order-states.ts`, pura) y se repite en un disparador de la base, de modo que ni un servicio nuevo ni una escritura directa pueden saltársela.
- **Quién mueve qué.** Una persona confirma (`purchasing.order.submit`) o cancela (`purchasing.order.cancel`, con motivo). «Recibida en parte» y «recibida» no las elige nadie: las pone una recepción según lo que llegó (`advanceOrderOnReceipt`, dentro de la transacción de la recepción).
- **Confirmar no es aprobar ni enviar el correo.** La matriz dice que confirmar «no implica aprobación por otra persona»; y el envío del PDF (CMP-06B) puede fallar o repetirse sin que la orden cambie de estado.
- **Una orden recibida en parte no se cancela:** lo que llegó ya es inventario e historia. Lo que falte se cierra como faltante (CMP-11).
- **Cada estado lleva sus datos** (`CHECK`): fecha y persona de la confirmación; fecha, persona y motivo de la cancelación. Una orden cancelada después de enviada conserva su fecha de envío.
- **Las líneas de una orden que ya no es borrador no se escriben** (disparadores de `INSERT`, `UPDATE` y `DELETE`). Las cantidades recibidas vivirán en las tablas de recepción.

## Consecuencias

- La orden todavía no hace nada en el inventario ni escribe el último costo: eso ocurre al recibir (CMP-07, CMP-13).
- Una línea se puede quitar de un borrador (no es historia todavía). Una orden enviada no se reescribe: sus transiciones son las de CMP-05.
- Hasta 200 líneas por orden; más productos van en otra orden.

## A confirmar por el fundador

1. El formato del número («OC-0001») y si debe reiniciar cada año.
2. Si quiere capturar aquí descuentos o impuestos por línea, o basta el costo neto antes de impuestos.
3. Si una misma orden debe poder pedir el mismo producto en dos líneas (hoy sí: por caja y por pieza suelta).
4. Si una orden enviada debe poder reabrirse para corregirla. Hoy no: se cancela y se hace otra, para que lo que recibió el proveedor y lo que dice el sistema nunca difieran en silencio.
