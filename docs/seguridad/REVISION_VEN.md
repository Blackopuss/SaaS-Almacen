# Revisión de amenazas — Ventas (VEN-01 a VEN-23) y Cotizaciones (COT-01 a COT-12)

Fecha: 2026-10-28. Complementa `REVISION_PLT.md`, `REVISION_USR.md`, `REVISION_MOD.md`, `REVISION_INV.md`, `REVISION_IMP.md`, `REVISION_CMP.md` y `REVISION_PIL.md`. Hecha por la misma IA que implementó las etapas; **falta una revisión independiente** (como la que tuvo CMP). VEN-24..28 (hardware, piloto y cobro del módulo) quedan fuera.

## Qué se agregó

- Precio de venta por producto y presentación, IVA configurable por empresa y descuentos con tope por rol y autorización en el mostrador (ADR 0030).
- Venta de mostrador: carrito, clientes, pagos en efectivo, tarjeta, transferencia o mixtos, ticket con enlace firmado para el cliente, caja con fondo, ingresos, egresos y corte a ciegas.
- Devoluciones, cancelaciones, historial y reportes de ventas exportables (ganancia solo para quien ve costos, ADR 0031).
- Cotizaciones con PDF y envío por correo, estados, pedidos, entregas parciales que se cobran como venta, cancelación de pedidos y reporte de conversión.

## Amenazas consideradas y control

| Amenaza | Control | Prueba |
| --- | --- | --- |
| Cobrar un precio o un total que manda el navegador | El navegador solo manda ids, presentación y lo tecleado; precios (`priceLines`), IVA (`saleTotals`) y cambio se calculan en el servidor al confirmar; en un pedido, los precios son los aceptados y un disparador exige que cada línea vendida coincida con la del pedido | `sale.int.test.ts`, `cart.int.test.ts`, `order-fulfillment.int.test.ts` |
| Vender más de lo que hay, o la última pieza a dos clientes | Productos bloqueados en orden fijo, resta condicionada del saldo y `CHECK`; un pedido no aparta y valida al entregar | `sale.int.test.ts`, `order-fulfillment.int.test.ts` («dos a la vez nunca entregan dos veces») |
| Cobrar dos veces por doble clic o respuesta perdida | Clave de confirmación única por empresa; una clave repetida solo es reintento si coinciden persona y lo pedido (si no, se rechaza); verificación por clave en el navegador | `sale.int.test.ts`, `returns.int.test.ts`, `order-fulfillment.int.test.ts` |
| Descuentos grandes sin permiso o bajo el costo | Tope por rol leído en el servidor; arriba del tope, autorización con contraseña de quien autoriza (`reserveAttempt` por persona e IP), para ese cajero, ese porcentaje, 10 minutos y una sola venta; bajo el costo solo con `sales.below_cost.authorize`; el costo nunca viaja al cajero. En una cotización no hay autorización: se rechaza | `discounts.int.test.ts`, `quotes.int.test.ts` |
| Sacar efectivo de la caja sin rastro o de una caja ajena | Una caja abierta por persona; ventas, ingresos, egresos y reembolsos en efectivo solo en la caja propia bloqueada; un egreso o reembolso no pasa de lo que debe haber; el corte es a ciegas, una vez (disparador) y lo hace quien tiene `sales.cash.close` | `cash.int.test.ts`, `returns.int.test.ts`, `quote-to-cash.int.test.ts` |
| Devolver más de lo vendido o perder centavos al devolver en partes | Límite por línea bajo el candado de la venta; la última devolución regresa lo que queda; documentos inmutables | `returns.int.test.ts` |
| Ver la ganancia o los costos sin `inventory.cost.read` | Los campos y columnas de ganancia no existen en la respuesta ni en los archivos; la cotización no lleva costos | `reports.int.test.ts`, `prices.int.test.ts` |
| Abrir el ticket de otra venta cambiando el enlace | Enlace `/ticket/<empresa>.<venta>.<firma>` con HMAC (llave derivada de `BETTER_AUTH_SECRET`, etiqueta propia); cualquier cambio no muestra nada; página `noindex` y `no-referrer` | `ticket.int.test.ts` |
| Mandar la cotización a otro correo o inyectar cabeceras | El destinatario sale de la ficha del cliente; `sendEmail` rechaza saltos de línea; el worker vuelve a comprobar el permiso de quien lo pidió | `quote-delivery.int.test.ts` |
| Cambiar lo que el cliente aceptó (precios, descuento, IVA) | Cotización editable solo en borrador; el pedido copia lo aceptado y los disparadores impiden cambiarlo; estados con una sola tabla repetida en la base | `quote-schema.int.test.ts`, `quote-status.int.test.ts`, `sales-orders.int.test.ts` |
| Cancelar pedidos o ventas sin permiso, o sin rastro | `sales.sale.cancel` (Encargado de caja, administrador, titular), motivo obligatorio, quién y cuándo guardados una vez (`CHECK` y disparador) y bitácora | `returns.int.test.ts`, `order-fulfillment.int.test.ts`, `quote-permissions.int.test.ts` |
| Un rol de Ventas que mueve o ajusta inventario | Cajero y Encargado solo leen Inventario; las salidas salen de una venta en la misma transacción | `quote-permissions.int.test.ts` |
| Datos de otra empresa | `forOrganization`, llaves compuestas y `lockRows`; los ids del navegador se buscan solo en la empresa de la sesión | pruebas «de otra empresa» de cada servicio, `two-companies.int.test.ts`, `server-actions.int.test.ts` |

## Hallazgos

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| VEN-S01 | Baja | El aviso de posible duplicado al crear un proveedor (CMP-S12) busca en todos los contactos: ahora que hay clientes, a quien tiene `purchasing.supplier.create` sin `sales.customer.read` le puede mostrar el nombre y RFC de un cliente que coincide con lo que escribió. | Pendiente: decidir con la revisión independiente si el aviso se limita a «hay un cliente con ese RFC». |
| VEN-S02 | Baja | Durante VEN-15 y COT-03 una prueba del ticket falló «a veces»: al alterar la firma cambiaba la última letra por «A», que a veces ya era «A». | **Corregido:** la prueba cambia por otra letra. |
| VEN-S03 | Informativa | Quien tiene el enlace de un ticket ve lo que dice el ticket impreso (cliente, productos, total). Es intencional: es lo que se le entrega al cliente. | Aceptado (VEN-15). |
| VEN-S04 | Informativa | Con IVA sumado, cada entrega de un pedido redondea su IVA por separado: entregado en partes, la suma puede diferir del total del pedido por centavos. Entregado completo de una vez coincide exacto. | Aceptado (ADR 0030); los totales de cada venta son los que se cobraron. |
| VEN-S05 | Baja | Reportes de ventas y de cotizaciones leen hasta 5,000 documentos (lo avisan con `truncated`); no hay límite de frecuencia para descargarlos. | Pendiente con IMP-S05. |
| VEN-S06 | Informativa | El reporte de cotizaciones calcula «pendiente hoy» con hasta 5,000 cotizaciones y pedidos abiertos, sin aviso si hay más. | Vigilar con datos del piloto. |
