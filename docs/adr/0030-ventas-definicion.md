# ADR 0030 — Ventas: alcance y reglas (VEN-01)

Fecha: 2026-10-27 · Estado: aceptada por el fundador · Paso: VEN-01

## Contexto

El fundador decidió adelantar Ventas antes de los pilotos (el servidor actual es de prueba y se migrará). El plan v0.6 ponía primero el punto de venta (VEN) y después cotizaciones y pedidos (COT), y dejaba fuera el crédito. La referencia es el flujo de ventas de SAP (cotización → pedido → entrega → cobro) simplificado para una ferretería, más el mostrador de todos los días. La definición con pilotos reales queda para cuando existan: estas reglas se revisan con ellos.

## Decisiones

- **Antes de Ventas, el valor del inventario (fase VAL).** Costo promedio por producto, recalculado en cada entrada con costo (como el precio medio variable de SAP): 10 a $85 + 10 a $95 → $90. Con él, cada venta muestra su ganancia y se puede exigir que el enganche cubra el costo. El costo también se captura, con permiso, en entradas manuales, saldo inicial e importación (cambia ADR 0017, que solo lo permitía desde Compras).
- **Quién ve costos y ganancia:** titular, administrador y comprador. El cajero ve precios, no costos; el sistema igual le impide vender bajo el mínimo permitido.
- **Mostrador y cotizaciones a la vez.** Comparten la base (módulo, roles, precio, impuestos, esquema de venta); después se avanza en los dos.
- **Un solo precio por producto**, en su unidad base. El precio de una presentación es contenido × precio (caja de 2 a $50 = $100): la pieza suelta deja más margen y al mayorista se le hace descuento en la cotización o en caja. No hay listas de precios ni precio de mayoreo aparte.
- **IVA configurable por empresa:** sus precios ya incluyen IVA (se desglosa el contenido) o se suma al cobrar. Tasa 16 % por omisión.
- **Descuentos por rol, con autorización.** El titular fija el tope de cada rol (por ejemplo, Cajero 5 %). Arriba de su tope, el cajero pide en la misma pantalla la autorización de alguien con tope suficiente (un administrador o un cajero de mayor nivel: si hace falta un rol aparte se decide en VEN-02). Nunca por debajo del costo sin permiso propio. Todo descuento lleva motivo y queda en la bitácora.
- **Ventas a plazos (fase PAG), no «fiado».** Se pactan desde la cotización: enganche y el resto en mensualidades a los meses que el cliente necesite. El **enganche mínimo cubre el costo** de lo vendido (costo promedio × cantidad). El interés es **opcional y configurable por empresa** (un porcentaje por plazo; cero por omisión). La mercancía se entrega y sale del inventario **al pagar el enganche**; desde ahí nace una cuenta por cobrar con su calendario. Una venta a plazos siempre tiene cliente identificado.
- **Sin existencias suficientes la venta se rechaza**, como cualquier salida (ADR 0012).
- **Sin factura (CFDI)** en esta etapa: ticket y cotización no fiscales. Lo fiscal sigue pendiente del fundador.

## Lo que no se hace por ahora

- Listas de precios, precio de mayoreo o promociones automáticas.
- Recargos por atraso en los plazos.
- Reserva de existencias para pedidos (COT-06 se decide después).
- Cobro con tarjeta dentro de la aplicación: la terminal es externa (VEN-12).

## Consecuencias

- El plan agrega las fases VAL (6 pasos) y PAG (9 pasos) y cambia VEN-03, VEN-04 y VEN-14. Ventas deja de esperar a PIL-17.
- El catálogo de permisos y la matriz de roles crecen (`inventory.cost.*`, Cajero, Vendedor, topes de descuento): cada uno en su paso, con su prueba.
