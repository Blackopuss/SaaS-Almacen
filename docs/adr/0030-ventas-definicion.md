# ADR 0030 — Ventas: alcance y reglas (VEN-01)

Fecha: 2026-10-27 · Estado: aceptada por el fundador · Paso: VEN-01

## Contexto

El fundador decidió adelantar Ventas antes de los pilotos (el servidor actual es de prueba y se migrará). El plan v0.6 ponía primero el punto de venta (VEN) y después cotizaciones y pedidos (COT), y dejaba fuera el crédito. La referencia es el flujo de ventas de SAP (cotización → pedido → entrega → cobro) simplificado para una ferretería, más el mostrador de todos los días. La definición con pilotos reales queda para cuando existan: estas reglas se revisan con ellos.

## Decisiones

- **Antes de Ventas, el valor del inventario (fase VAL).** Costo promedio por producto, recalculado en cada entrada con costo (como el precio medio variable de SAP): 10 a $85 + 10 a $95 → $90. Con él, cada venta muestra su ganancia y se puede exigir que el enganche cubra el costo. El costo también se captura, con permiso, en entradas manuales, saldo inicial e importación (cambia ADR 0017, que solo lo permitía desde Compras).
- **Quién ve costos y ganancia:** titular, administrador y comprador. El cajero ve precios, no costos; el sistema igual le impide vender bajo el mínimo permitido.
- **Mostrador y cotizaciones a la vez.** Comparten la base (módulo, roles, precio, impuestos, esquema de venta); después se avanza en los dos.
- **Precio de venta propio por presentación** (corregido por el fundador el 2026-10-27). Ejemplo: una caja de 500 tornillos que costó $450 se vende en $500, y cada tornillo suelto a $1.50; la pieza suelta deja más margen. Una presentación sin precio propio se vende a contenido × precio de la unidad. Al mayorista, además, se le puede dar descuento en la cotización o en caja. No hay listas de precios por cliente ni precio de mayoreo aparte.
- **IVA configurable por empresa:** sus precios ya incluyen IVA (se desglosa el contenido) o se suma al cobrar. Tasa 16 % por omisión.
- **Roles (decididos 2026-10-27, como en una tienda de autoservicio):** **Cajero** (`cashier`): cobra, cotiza, hace pedidos y abre su caja; no hay rol Vendedor aparte. **Encargado de caja** (`cash_manager`): todo lo del Cajero más autorizar descuentos grandes, corte de caja, cancelaciones y devoluciones. Se ofrecen en Equipo solo con Ventas contratado.
- **Descuentos por rol, con autorización.** El titular fija el tope de cada rol (por ejemplo, Cajero 5 %, Encargado 20 %). Arriba de su tope, el cajero pide en la misma pantalla la autorización de un Encargado de caja (o administrador, o el titular) con tope suficiente. Nunca por debajo del costo sin permiso propio (titular y administrador). Todo descuento lleva motivo y queda en la bitácora.
- **Ventas a plazos (fase PAG), no «fiado».** Se pactan desde la cotización: enganche y el resto en mensualidades a los meses que el cliente necesite. El **enganche mínimo cubre el costo** de lo vendido (costo promedio × cantidad). El interés es **opcional y configurable por empresa** (un porcentaje por plazo; cero por omisión). La mercancía se entrega y sale del inventario **al pagar el enganche**; desde ahí nace una cuenta por cobrar con su calendario. Una venta a plazos siempre tiene cliente identificado.
- **Sin existencias suficientes la venta se rechaza**, como cualquier salida (ADR 0012).
- **Sin factura (CFDI)** en esta etapa: ticket y cotización no fiscales. Lo fiscal sigue pendiente del fundador.
- **Un pedido no aparta existencias** (COT-06, decidido por el fundador el 2026-10-28). Lo pedido sigue disponible para el mostrador hasta que se surte; al surtir se valida lo que hay en ese momento y, si no alcanza, se surte en parte y el resto queda pendiente. Es lo más simple y no deja existencias «atoradas» en pedidos que no se concretan; se revisará con los pilotos.
- **Surtir un pedido es cobrarlo** (COT-07). Como no hay «fiado», lo que sale para el cliente se paga al salir: cada entrega de un pedido es una venta ligada a él (en la caja de quien la cobra), con los precios, descuento e IVA que el cliente aceptó y con la presentación como se pactó («2 cajas de 500» siguen siendo de 500). El descuento pactado se reparte sobre lo entregado como en el mostrador; entregado completo de una vez, suma exactamente el pedido. Lo entregado cuenta aunque después se devuelva o se cancele su venta: una devolución regresa mercancía, no reabre el pedido.

## Lo que no se hace por ahora

- Listas de precios, precio de mayoreo o promociones automáticas.
- Recargos por atraso en los plazos.
- Reserva de existencias para pedidos (COT-06: decidido no apartar; se revisa con los pilotos).
- Cobro con tarjeta dentro de la aplicación: la terminal es externa (VEN-12).

## Consecuencias

- El plan agrega las fases VAL (6 pasos) y PAG (9 pasos) y cambia VEN-03, VEN-04 y VEN-14. Ventas deja de esperar a PIL-17.
- El catálogo de permisos y la matriz de roles crecen (`inventory.cost.*`, Cajero, Vendedor, topes de descuento): cada uno en su paso, con su prueba.
