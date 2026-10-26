# SAP como referencia: qué ya seguimos y qué falta

Fecha: 2026-10-26. Propuesta para que el fundador decida. No cambia el plan
(`docs/PLAN_IMPLEMENTACION.md`) hasta que se apruebe.

## La idea en una línea

Lo que hizo famoso a SAP en almacenes no es su pantalla (es famosa por difícil),
sino su **disciplina por debajo**: todo movimiento es un documento con tipo,
fecha y autor; nada se borra, se reversa; las existencias se pueden reconstruir
desde el historial; compras, recepción, almacén y costo están conectados. La
propuesta es **copiar esa disciplina y su flujo, no su complejidad**: por
dentro como SAP, por fuera sencillo (ver `docs/ux/AUDITORIA_KISS.md`).

## Cómo se compara hoy (SAP MM/WM y EWM)

| SAP | Qué es | En la app | Estado |
| --- | --- | --- | --- |
| Maestro de materiales | Ficha del producto, unidad base y unidades alternas | Producto con SKU, unidad base y presentaciones (caja de 100) | Hecho |
| Clases de movimiento (101, 201, 311, 561, 701…) | Cada movimiento tiene un tipo que dice qué hace | Recepción, salida, reubicación, saldo inicial, ajuste, devolución | Hecho |
| Documento de material inmutable y anulación (storno) | Nada se edita; se reversa con el documento contrario | Movimientos inmutables y «Reversar» | Hecho |
| Almacén → tipo → sección → ubicación (bin) | Dónde está cada cosa | Zona → pasillo → estante | Hecho (más simple) |
| MI01 / MI04 / MI07 | Inventario físico: crear documento, contar, contabilizar diferencias | Conteos: abrir, capturar, aplicar diferencias | Hecho |
| ME21N → MIGO 101 → 122 | Orden de compra, recepción (parcial) y devolución al proveedor | Órdenes, recepción parcial por línea, devoluciones | Hecho |
| Punto de pedido (MRP simple) | Pedir cuando baja del mínimo | Mínimos, «Existencias bajas» y «Qué pedir» | Hecho |
| MMBE / MB52 / MB51 | Existencias por producto, por almacén e historial | Ficha, exportación de existencias, historial con filtros | Hecho |
| Estados de existencia: libre, en inspección, bloqueado | Mercancía que existe pero no se puede vender | No existe | Falta |
| Lotes y caducidad (FEFO) | Saber qué lote sale primero | No existe | Falta |
| Órdenes de transporte (WM) / tareas de almacén (EWM): acomodo y surtido | Tras recibir, decir a quién y a qué estante llevarlo; para salir, lista de surtido por ubicación | No existe: la recepción entra directo a una ubicación | Falta |
| Valuación (precio medio variable) | Valor del inventario actualizado en cada movimiento | Solo último costo de compra | Falta |
| Reservas | Apartar existencias para un pedido | No existe (llegaría con Ventas) | Falta |
| Conteo cíclico ABC | Contar más seguido lo que más importa | Conteos manuales, sin clasificación | Falta |
| Números de serie | Rastrear pieza por pieza | No existe | Probablemente innecesario en ferretería |
| MIRO (factura y conciliación de 3 vías) | Pedido = recibido = facturado | No existe | Fuera de alcance (finanzas) |
| Dispositivos RF (pistola) | Operar con lector en el piso | Lector en búsqueda y salida | Parcial |

Conclusión: el núcleo de SAP MM-IM (inventario) y MM-PUR (compras) ya está. Lo
que distingue a SAP WM/EWM como «el almacén por excelencia» es lo que falta:
**tareas guiadas (acomodo y surtido), estados de existencia, lotes y
valuación**.

## Propuesta de orden (cada uno como pasos del plan, con su ADR)

1. **Valor del inventario (precio medio).** Cada entrada recalcula el costo
   promedio; Inicio y la ficha muestran cuánto vale lo que tienes. Para una
   ferretería es lo más útil de SAP y no agrega pantallas.
2. **Acomodo después de recibir (putaway).** Al recibir, la mercancía queda en
   «Andén» y aparece una tarea: «Llevar 3 cajas de tornillos a Pasillo 2 ›
   Estante 3», que el ayudante confirma con el lector. Es el corazón de WM.
3. **Surtido para salidas grandes (picking).** Una lista de qué tomar y de qué
   estante, en orden de recorrido. Llega naturalmente con Ventas.
4. **Estados de existencia.** «Disponible», «En revisión» y «Dañado/bloqueado»
   por ubicación, con movimientos entre estados (como 321/344 en SAP).
5. **Lotes y caducidad opcionales por producto** (pinturas, selladores,
   pegamentos), con salida del lote más próximo a vencer.
6. **Conteo cíclico ABC**: la app sugiere qué contar cada semana según valor y
   rotación.

Regla para todos: la complejidad se activa por producto o por empresa (como en
SAP se activa por material o por almacén). Una tiendita que no la necesita no
la ve.

## Preguntas para el fundador

- ¿Qué parte de SAP extrañan más los almacenistas que conoces: las tareas
  guiadas (acomodo y surtido), el valor del inventario o los lotes?
- ¿Tu primera ferretería recibe mercancía en un andén y luego la acomoda, o la
  acomoda al momento de recibir?
- ¿Manejan productos con caducidad o lote?
