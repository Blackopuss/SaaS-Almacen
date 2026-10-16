# Revisión de amenazas — etapa CMP (CMP-01 a CMP-18)

Fecha: 2026-10-16. Complementa `REVISION_PLT.md`, `REVISION_USR.md`, `REVISION_MOD.md`, `REVISION_INV.md` y `REVISION_IMP.md`. Hecha por la misma IA que implementó la etapa. **Ningún paso de CMP tiene revisión independiente** (Codex sin cuota durante la etapa): hacerla antes del piloto, empezando por recepciones, devoluciones y sugerencias (CMP-07 a CMP-14).

## Qué se agregó

- Contactos compartidos con faceta de proveedor (ADR 0016) y vínculo producto-proveedor con último costo (ADR 0017).
- Órdenes de compra con estados, PDF propio y envío por correo desde el worker (ADR 0018 a 0020).
- Recepciones totales y parciales, con destino por línea y contenido vigente de la presentación; cierre con faltante; devoluciones al proveedor (ADR 0021).
- Registro del último costo al recibir, sugerencia de compra desde mínimos, reportes exportables, guard del módulo y su desactivación.

## Amenazas consideradas y control

| Amenaza | Control | Prueba |
| --- | --- | --- |
| Usar Compras sin tener el módulo, o con el plan vencido | Todo servicio exportado empieza con `assertModulePermission` (rol → módulo); una prueba recorre todas las funciones del módulo en una empresa sin Compras y falla si una nueva no tiene guard; menú y pantallas lo ocultan; quitado el módulo queda en solo lectura | `tests/purchasing/module-guard.int.test.ts`, `deactivation.int.test.ts` |
| Ver costos sin `purchasing.cost.read` (NEG-04, NEG-25) | Las columnas de costo no se piden a la base para quien no puede verlas; los campos no existen en la respuesta; reportes y archivos omiten sus columnas; el PDF solo lo descarga quien ve costos. Una prueba siembra un costo reconocible y lo busca en todas las respuestas, reportes y archivos de Consulta | `tests/purchasing/module-guard.int.test.ts`, `reports.int.test.ts`, `orders.int.test.ts`, `product-suppliers.int.test.ts` |
| Recibir de más con recepciones simultáneas o repetidas (NEG-24) | Candados productos → ubicaciones → orden; lo pendiente se lee bajo el candado; clave de confirmación única por empresa y comparada con lo pedido (otra cantidad con la misma clave se rechaza) | `receipts.int.test.ts` (cinco a la vez contra tres pendientes, 7 + 6 contra 10, recepción y cancelación a la vez) |
| Devolver más de lo recibido o dejar saldo negativo | Límite acumulado por línea de recepción decidido con la orden bloqueada y repetido por un disparador; resta condicionada del saldo; misma clave de confirmación | `returns.int.test.ts` (concurrentes, repetidas, base de datos) |
| Separar documento y existencias (recibir sin entrada, devolver sin salida, reversar una recepción desde Inventario) (NEG-22) | Recepción y devolución escriben su movimiento en la misma transacción; documentos inmutables (disparadores); la reversa de Inventario rechaza `RECEIPT` y `RETURN` | `receipts.int.test.ts`, `returns.int.test.ts`, `purchase-flow.int.test.ts` |
| Cambiar el contenido de una caja para inflar o reducir lo recibido o devuelto | Lo que entra usa el contenido vigente al recibir y se guarda con su versión; lo que se devuelve sale con el factor de su recepción, nunca con el vigente | `receipts.int.test.ts`, `returns.int.test.ts`, `purchase-flow.int.test.ts` |
| Escribir en una orden ya enviada o en otro estado inválido | Tabla única de transiciones en código y en un disparador; líneas de orden no borrador no se escriben; recepción solo de órdenes enviadas o recibidas en parte; cerrada y cancelada son finales | `order-transitions.int.test.ts`, `order-close.int.test.ts` |
| Archivar un producto que todavía se espera de un proveedor (NEG-21) | `archiveProduct` rechaza si una orden enviada o recibida en parte lo espera; confirmar una orden bloquea antes sus productos, así archivar y confirmar a la vez quedan en fila | `order-close.int.test.ts` |
| Generar dos veces la misma compra desde la sugerencia | El navegador solo manda ids; el servidor bloquea los productos y recalcula; los borradores cuentan como «en camino» | `suggestions.int.test.ts` |
| Inyectar cabeceras o adjuntos en el correo al proveedor; mandarlo a otro destinatario | `sendEmail` rechaza saltos de línea y adjuntos no permitidos; el destinatario sale de la ficha; límites por orden y por empresa | `order-delivery.int.test.ts` |
| PDF con contenido activo o texto que rompe su estructura | Escritor propio con texto escapado, sin JavaScript ni acciones; prueba que extrae el texto y revisa la tabla de objetos | `order-pdf.int.test.ts` |
| Datos de otra empresa (órdenes, recepciones, ubicaciones, productos, proveedores) | `forOrganization` y llaves compuestas; las ubicaciones y líneas que llegan del formulario se buscan solo en la empresa | `two-companies.int.test.ts`, pruebas de cada servicio («de otra empresa») |
| Acciones sin sesión o con identidad del cliente | Persona y empresa salen de `requireOrganizationContext`; cada acción en `REVIEWED`; descargas por rutas `GET` con `attachment` + `nosniff` + `no-store` | `server-actions.int.test.ts` |
| Quitar Compras y perder trabajo a medias | La consola avisa de órdenes y envíos pendientes antes de quitarlo; nada se cancela ni se borra; queda en solo lectura y sigue si vuelve | `deactivation.int.test.ts` |

## Hallazgos

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| CMP-S01 | Media | Hasta CMP-10, una clave de confirmación de recepción repetida por la misma persona con **otras** cantidades se tomaba como reintento y respondía «ya estaba registrada» sin recibir lo nuevo: la persona podía creer que recibió algo que no. | **Corregido en CMP-10:** la clave solo es reintento si coincide lo pedido; si no, se rechaza. Igual en devoluciones. |
| CMP-S02 | Media | Hasta CMP-11, archivar un producto y confirmar una orden que lo pide podían cruzarse y dejar una orden enviada de un producto archivado (que ya no se podía recibir). | **Corregido en CMP-11:** confirmar bloquea primero los productos. |
| CMP-S03 | Baja | El aviso de trabajo a medias al quitar Compras se calcula antes de guardar: una orden enviada en ese instante no aparece en el aviso. | Aceptado: nada se destruye al quitar el módulo (queda en solo lectura). |
| CMP-S04 | Baja | Reportes y sugerencias leen hasta 5,000 líneas o mínimos; con más, el reporte lo dice y la sugerencia toma los primeros. No hay límite de frecuencia para descargar reportes. | Pendiente con IMP-S05 (límite por persona al definir el despliegue) y medir con datos del piloto. |
| CMP-S05 | Baja | Recibir de un proveedor un producto que no estaba ligado a él crea el vínculo (para guardar su último costo). Es un cambio de catálogo implícito. | Aceptado (ADR 0021); se ve en la ficha del proveedor y del producto. |
| CMP-S06 | Baja | Todavía no hay proveedor de correo real: en desarrollo los correos quedan en `/correos`. SPF, DKIM y DMARC pendientes. | Pendiente para BAS-09..11 / PIL. |
| CMP-S07 | Informativa | Una devolución no vuelve a dejar pendiente lo devuelto en la orden; si el proveedor lo repone se pide en otra orden. | Decisión a confirmar por el fundador (ADR 0021). |
| CMP-S08 | Informativa | Dos fallas de pruebas «a veces» durante la etapa resultaron de la prueba, no del sistema: un id aleatorio que contenía «987» parecía un costo filtrado. Las búsquedas de costos en pruebas usan ahora el importe completo. | Corregido. |
| CMP-S09 | Informativa | Una corrida de CI (CMP-15) murió con «exit code 132» (instrucción ilegal en la máquina de GitHub) sin prueba fallida; la siguiente, con el mismo código, pasó. | Vigilar; si se repite, fijar la imagen del runner. |

## Siguiente revisión

Antes del piloto (PIL): revisión independiente de CMP-07 a CMP-18 y de los pendientes de despliegue.
