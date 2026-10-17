# Revisión de amenazas — etapa INV (INV-01 a INV-35)

Fecha: 2026-10-05. Complementa `REVISION_PLT.md`, `REVISION_USR.md` y `REVISION_MOD.md`. Hecha por la misma IA que implementó la etapa; falta una revisión independiente (Codex) antes del piloto.

## Qué se agregó

- Catálogo: productos con cupo, categorías y marcas, unidades y precisión, presentaciones con versiones inmutables y conversión exacta.
- Ubicaciones: «General» por empresa y jerarquía zona › pasillo › estante (ADR 0010 y 0011).
- Existencias: saldo por producto y ubicación que solo cambia junto con un movimiento inmutable (ADR 0012).
- Movimientos: entrada, saldo inicial, salida, salida rápida de varias líneas, reubicación, ajuste con motivo y reversa; claves de confirmación para no duplicar; verificación tras perder la conexión.
- Consultas: lista paginada con búsqueda y filtros, ficha de producto, historial con filtros, mínimos y existencias bajas, panel de inicio.
- Conteos físicos: captura, comparación con referencia, movimientos posteriores y aplicación como un solo ajuste.
- Tarea de reconciliación de saldos contra el historial (`npm run stock:reconcile`).

## Amenazas consideradas y control

| Amenaza | Control | Prueba |
| --- | --- | --- |
| Ver o mover existencias de otra empresa enviando sus ids (producto, ubicación, presentación, movimiento, conteo, captura) | Todo se busca con el cliente de empresa (`forOrganization`), llaves compuestas con `organizationId` en cada relación y `lockRows` con filtro de empresa; un id ajeno responde «no existe» | `two-companies.int.test.ts`, casos «another company» en cada archivo de `tests/inventory/` |
| Llamar una acción sin el rol o sin el módulo (botón oculto, petición directa) | Cada servicio empieza con `assertModulePermission`; aplicar un conteo exige además `inventory.adjustment.create`; cada acción está registrada en `REVIEWED` | `negative-by-role.int.test.ts` (NEG-01, 05, 21, 22, 23), `server-actions.int.test.ts` |
| Escribir con el plan vencido | Permisos de escritura bloqueados en solo lectura; las pantallas ocultan las acciones | `subscription-states.int.test.ts`, guardas de cada pantalla |
| Enviar el factor, el saldo o el resultado de una conversión desde el navegador | El navegador solo manda lo tecleado e ids; factor, versión y cantidad base se leen y calculan en el servidor dentro de la transacción | `conversion.int.test.ts`, `entries.int.test.ts`, `quick-exit.int.test.ts`, `counts.int.test.ts` |
| Dejar existencias negativas con solicitudes simultáneas | Candado por producto en orden fijo, lectura después del candado (READ COMMITTED), resta condicionada y `CHECK` en la tabla | `exit-concurrency`, `exits`, `quick-exit` y `transfers.int.test.ts`, `stock-schema.int.test.ts` |
| Duplicar un movimiento reintentando o con doble clic | Clave de confirmación única por empresa; la repetición responde con el movimiento original; una clave reutilizada para otra cosa se rechaza | `idempotency.int.test.ts`, `lost-answer.int.test.ts`, `phase1-cases.int.test.ts` (MOV-02) |
| Aplicar un conteo dos veces o pisar lo que se movió después de contar | Estado del conteo leído bajo candado + clave propia del ajuste; la diferencia se calcula contra la referencia, no contra el saldo de hoy; conflicto = no se aplica nada | `count-apply.int.test.ts`, `counts.int.test.ts` |
| Reescribir o borrar historia (movimientos, líneas, versiones de presentación, bitácora) | Disparadores que rechazan `UPDATE`/`DELETE`; corregir es reversar | `stock-schema.int.test.ts`, `reversals.int.test.ts`, `phase1-cases.int.test.ts` (MOV-03) |
| Ajustar existencias sin dejar rastro | Motivo obligatorio (servicio y `CHECK`) y evento en la bitácora para ajustes, reversas y conteos aplicados | `adjustments.int.test.ts`, `reversals.int.test.ts`, `count-apply.int.test.ts` |
| Inyección por búsquedas y filtros | Prisma parametriza; los comodines `%`, `_` y `\` se escapan; un filtro desconocido se ignora | `product-list.int.test.ts`, `movement-history.int.test.ts` |
| Cantidades tramposas (fracciones de pieza, cero, negativas, enormes, notación rara) | `parseQuantity` con la regla del producto, decimales exactos y topes | `quantity.test.ts`, `phase1-cases.int.test.ts` (UNI-04) |
| Agotar el servidor con listas o cargas grandes | Listas paginadas en la base; topes: 50 líneas por salida rápida, 2,000 productos y 50 capturas por producto en un conteo, texto con longitud máxima | Pruebas de cada servicio |
| Rebasar el cupo de productos | Contador con `UPDATE` condicional en la misma transacción del alta | `quota.int.test.ts`, `products.int.test.ts` |
| Archivar un producto o una ubicación con existencias, o moverlos a mitad de un movimiento | Candados producto → ubicación y revisión bajo candado | `archive-with-stock.int.test.ts`, `product-archive.int.test.ts` |
| Un saldo que deja de coincidir con su historial (defecto o manipulación directa de la base) | `reconcileCompany` y la tarea `stock:reconcile`, que solo leen y avisan | `stock-schema.int.test.ts`, `phase1-cases.int.test.ts` |

## Hallazgos

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| INV-S01 | Media | La clave del ajuste de un conteo tenía un formato que también aceptan los formularios: alguien de la misma empresa podía usarla antes en otro movimiento y dejar el conteo sin poder aplicarse. | **Corregido:** la clave usa `:` (`count:<id>`), carácter que la validación de formularios rechaza. Prueba en `count-apply.int.test.ts`. |
| INV-S02 | Media | En la captura de conteos, una captura enviada mientras la anterior terminaba de repintar la pantalla se descartaba en silencio (pérdida de datos, no de seguridad). | **Corregido en INV-33:** bandera propia en lugar de la transición de React. |
| INV-S03 | Baja | La tarea de reconciliación no está programada: hoy se corre a mano. Una diferencia podría tardar en notarse. | Pendiente: programarla diario con la cola de trabajos (IMP-01) o en el servidor (BAS-09..11) y alertar con su código de salida. |
| INV-S04 | Baja | Aplicar un conteo muy grande mantiene candados sobre sus productos hasta 60 s; durante ese tiempo sus movimientos esperan. Solo afecta a la propia empresa. | Aceptado. Revisar con datos reales del piloto. |
| INV-S05 | Baja | El detalle de un conteo muestra el saldo del sistema con solo `inventory.count.read`. Hoy todos los roles con ese permiso tienen también `inventory.stock.read`. | Aceptado; si la matriz separa esos permisos, exigir ambos en `getCount`. |
| INV-S06 | Baja | Las búsquedas de producto desde formularios (salida rápida, conteos) no tienen límite de frecuencia. Requieren sesión y solo leen de la propia empresa. | Aceptado. Reconsiderar con el límite general de peticiones del despliegue. |
| INV-S07 | Informativa | El lector de códigos se probó con teclado simulado; falta el aparato real. | Pendiente del fundador (recorrido F12 de la guía de pruebas). |
| INV-S08 | Informativa | El historial lista como autor a quien confirmó; si la persona deja la empresa se muestra «Alguien que ya no está en el equipo» y su id queda en la fila. | Correcto por diseño (rastro); considerarlo en el aviso de privacidad (PIL). |

## Siguiente revisión

Al cerrar la etapa IMP (archivos subidos por el cliente, trabajos en segundo plano y exportaciones).
