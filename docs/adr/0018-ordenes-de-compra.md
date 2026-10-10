# ADR 0018 — Órdenes de compra: borrador y líneas

Fecha: 2026-10-10 · Estado: aceptada (puntos a confirmar por el fundador) · Paso: CMP-04

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

## Consecuencias

- La orden todavía no hace nada en el inventario ni escribe el último costo: eso ocurre al recibir (CMP-07, CMP-13).
- Una línea se puede quitar de un borrador (no es historia todavía). Una orden enviada no se reescribe: sus transiciones son las de CMP-05.
- Hasta 200 líneas por orden; más productos van en otra orden.

## A confirmar por el fundador

1. El formato del número («OC-0001») y si debe reiniciar cada año.
2. Si quiere capturar aquí descuentos o impuestos por línea, o basta el costo neto antes de impuestos.
3. Si una misma orden debe poder pedir el mismo producto en dos líneas (hoy sí: por caja y por pieza suelta).
