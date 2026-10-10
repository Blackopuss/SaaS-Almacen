# Revisión de amenazas — etapa IMP (IMP-01 a IMP-12)

Fecha: 2026-10-10. Complementa `REVISION_PLT.md`, `REVISION_USR.md`, `REVISION_MOD.md` y `REVISION_INV.md`. Hecha por la misma IA que implementó la etapa. Codex revisó de forma independiente IMP-08B e IMP-09 (cinco hallazgos, todos corregidos); **IMP-10, IMP-11 e IMP-12 no tienen revisión independiente** porque Codex agotó su cuota: hacerla antes del piloto.

## Qué se agregó

- Cola de trabajos en MySQL con worker aparte, reintentos con límite y liberación de lo retenido cuando un trabajo falla en definitiva (ADR 0013).
- Archivos privados por empresa, con enlaces de descarga firmados y de corta vida (ADR 0014).
- Importación de productos desde Excel o CSV: plantilla, lectura como texto, elección de columnas y separador decimal, validación por celda, clasificación contra el catálogo, confirmación con reserva de cupo, aplicación por lotes en el worker, existencias iniciales como movimientos, cancelación y liberación de reservas.
- Importación de salidas diarias con folio que impide duplicados y fecha hasta la que están importadas (ADR 0015).
- Exportación de catálogo, existencias e historial.
- Guía de primer uso en Inicio.

## Amenazas consideradas y control

| Amenaza | Control | Prueba |
| --- | --- | --- |
| Archivo malicioso: macros, fórmulas, vínculos externos, XML con entidades, «bomba» de compresión, tipo falso | El lector propio solo abre libro, textos y hojas; nunca evalúa fórmulas ni abre otras partes; rechaza XML con entidades; topes de filas, columnas y tamaño al desempacar; el tipo lo decide el servidor por la extensión y el contenido | `spreadsheet-reader.int.test.ts`, `files.int.test.ts` |
| Leer o descargar el archivo de otra empresa, o reutilizar un enlace | Archivos fuera de la raíz web bajo una clave armada con ids; `readStoredFile` con la empresa de la sesión o del trabajo; enlace firmado de 5 minutos ligado a sesión y empresa | `files.int.test.ts`, `two-companies.int.test.ts` |
| Usar el nombre del archivo como ruta | El nombre solo se muestra; nunca forma parte de una ruta | `files.int.test.ts` |
| Importar para hacer lo que el rol no permite a mano (crear productos, saldos iniciales, salidas) | `importPermissions` calcula lo que el archivo hace; se exige a quien confirma y se guarda con la importación; las salidas exigen `inventory.exit.create` | `import-stock.int.test.ts`, `exit-import.int.test.ts`, `import-confirmation.int.test.ts` |
| Un trabajo sigue actuando a nombre de alguien que ya perdió el acceso (NEG-20) | Antes de cada lote el worker vuelve a comprobar los permisos de quien confirmó (rol, membresía, plan); si no los tiene, lo pendiente no se aplica, lo aplicado se conserva y las reservas vuelven | `import-release.int.test.ts`, `exit-import.int.test.ts` |
| Un trabajo actúa en otra empresa manipulando su contenido | El manejador recibe la empresa de la fila del trabajo, nunca del `payload`, y trabaja con `forOrganization` | `jobs.int.test.ts`, `import-apply.int.test.ts`, `exit-import.int.test.ts` |
| Rebasar el cupo del plan con importaciones y altas simultáneas (NEG-19) | Reserva de todos los lugares en un `UPDATE` condicional al confirmar; cada alta usa un lugar reservado; contador único compartido con las altas manuales | `import-confirmation.int.test.ts`, `import-apply.int.test.ts`, `quota.int.test.ts` |
| Lugares del plan retenidos para siempre por una importación que no termina | Cancelar, fallar en definitiva, worker abandonado sin intentos o pérdida de acceso devuelven solo lo no usado, con la fila de la importación bloqueada; un trabajo vivo nunca pierde sus lugares | `import-release.int.test.ts`, `jobs.int.test.ts` |
| Duplicar productos, saldos o salidas al reintentar o con dos workers | Elementos fijados al confirmar y marcados en la misma transacción que su efecto; candado de la importación por lote; clave única por movimiento; para salidas, identidad producto + folio con índice único | `import-apply.int.test.ts`, `import-stock.int.test.ts`, `exit-import.int.test.ts` |
| Descontar dos veces una venta subiendo el archivo de nuevo o uno traslapado | `appliedKey` único por empresa, escrito solo al registrar la salida; la revisión avisa antes de confirmar | `exit-import.int.test.ts` |
| Dejar existencias negativas o saltarse las reglas del saldo inicial desde un archivo | Mismos candados (producto → ubicación) y la misma resta condicionada que los movimientos manuales; `checkImportedStock` antes de tocar el producto | `import-stock.int.test.ts`, `exit-import.int.test.ts`, que terminan con `reconcileStock` vacío |
| Cambiar lo que se va a aplicar después de confirmar (archivo, catálogo, presentación) | Los productos y sus cantidades se copian al confirmar; el worker no vuelve a leer el archivo; las salidas se convierten al registrarse, como cualquier movimiento, y eso se muestra | `import-apply.int.test.ts`, `import-stock.int.test.ts` |
| Números ambiguos («1,5») o tramposos | Separador decimal elegido por la persona, sin valor por defecto; `normalizeDecimal` rechaza lo dudoso; después, las reglas de cantidad del producto; nunca `Number()` sobre una celda | `imports.int.test.ts`, `import-validation.int.test.ts`, `exit-import.int.test.ts` |
| Fechas ambiguas (mes/día) en salidas | Solo año-mes-día o día/mes/año; fechas imposibles, futuras o números de serie de Excel se rechazan | `exit-import.int.test.ts` |
| Inyección de fórmulas al abrir un archivo exportado | Todo CSV y XLSX sale por `buildCsv`/`buildXlsx`: celdas de texto y apóstrofo ante `=`, `+`, `-`, `@`, tabulador y retorno | `exports.int.test.ts`, `import-template.int.test.ts` |
| Exportar más de lo que la persona puede ver, o datos de otra empresa (NEG-25) | `inventory.export.create` más el permiso de lectura de lo exportado; solo filas de la empresa de la sesión; sin acceso responde como si no existiera | `exports.int.test.ts` |
| Sacar datos sin dejar rastro | Cada exportación queda en la bitácora con contenido, formato y filas; confirmar, aplicar, cancelar y fallar una importación también | `exports.int.test.ts`, `import-release.int.test.ts`, `team-audit.int.test.ts` |
| Llamar una acción con datos de otra empresa o sin sesión | Persona y empresa salen de la sesión; cada Server Action está en `REVIEWED`; las descargas son rutas `GET` con `requireOrganizationContext` | `server-actions.int.test.ts`, verificación en navegador (sin sesión → redirige) |
| Agotar el servidor con archivos o exportaciones enormes | 10 MB por archivo, 20,000 filas y 60 columnas al leer, 80 MB al desempacar; 50,000 filas por exportación, leídas por páginas; lotes de 50 en el worker | Pruebas de cada servicio |
| Trabajo envenenado que se reintenta sin fin | Máximo de intentos por trabajo (5 por defecto) con espera creciente; después queda `FAILED` y se libera lo que retenía | `jobs.int.test.ts` |

## Hallazgos

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| IMP-S01 | Media | Confirmar una importación solo exigía `inventory.import.confirm`: un rol con ese permiso pero sin el de crear productos o capturar saldos iniciales habría podido hacerlo por archivo. La matriz lo prohíbe expresamente. | **Corregido en IMP-09:** `importPermissions` al confirmar y antes de cada lote. Hoy ningún rol tiene `import.confirm` sin los demás, así que no hubo exposición real. |
| IMP-S02 | Media | El worker aplicaba lo pendiente aunque quien confirmó hubiera perdido el acceso o el plan estuviera vencido (NEG-20). | **Corregido en IMP-08B** (productos) e IMP-10 (salidas). Queda una ventana de un lote (hasta 50 elementos) entre la comprobación y la escritura. |
| IMP-S03 | Media | Entre IMP-07 e IMP-08B los lugares reservados por una importación fallida no se devolvían. | **Corregido en IMP-08B.** Hallazgos de Codex en la corrección (trabajos fallidos antiguos marcados sin liberar; tipos sin manejador marcados como liquidados): corregidos. |
| IMP-S04 | Media | Codex, IMP-09: el mismo producto en dos filas con presentaciones de distinto contenido rompía el lote y lo dejaba reintentando; el control de «una vez por ubicación» revisaba solo 500 líneas; una cantidad capturada enorme desbordaba la columna. | **Corregidos:** una presentación por producto y archivo (validación), consultas exactas sin tope y límite también para lo capturado. |
| IMP-S05 | Baja | No hay límite de frecuencia para subir archivos ni para exportar. Cada exportación puede leer hasta 50,000 filas y cada subida hasta 10 MB; ambas requieren sesión y permiso. | Pendiente: límite por persona al definir el despliegue (BAS-09..11), junto con INV-S06. |
| IMP-S06 | Baja | Los archivos subidos para importar se conservan sin plazo. Contienen el catálogo y las ventas del cliente. | Pendiente: política de conservación y borrado (BIL-13, aviso de privacidad en PIL). |
| IMP-S07 | Baja | Si el worker no está corriendo, una importación confirmada espera indefinidamente con su cupo apartado. La pantalla lo dice («en espera») y se puede cancelar, pero nadie recibe aviso. | Pendiente: el worker como servicio con reinicio y alerta de cola detenida o trabajos `FAILED` (BAS-09..11). |
| IMP-S08 | Baja | Un trabajo fallido de un tipo que ningún worker conoce queda sin liquidar hasta que exista su manejador. Es deliberado (no se da por liberado lo que no se sabe liberar), pero puede pasar inadvertido. | Aceptado; cubrirlo con la alerta de IMP-S07. |
| IMP-S09 | Baja | Un lote mantiene bloqueados hasta 50 productos y sus ubicaciones hasta 60 s; durante ese tiempo sus movimientos manuales esperan. Solo afecta a la propia empresa. | Aceptado. Medir con archivos reales del piloto. |
| IMP-S10 | Baja | Las exportaciones no distinguen columnas sensibles porque todavía no existen (costos, CMP-16). | Pendiente para CMP-16: omitir columnas según permiso (NEG-25 queda parcialmente abierto). |
| IMP-S11 | Informativa | Una salida importada y después reversada a mano no puede volver a importarse con el mismo folio. | Correcto por diseño (ADR 0015); explicarlo en la ayuda. |
| IMP-S12 | Informativa | La guía de primer uso no guarda nada: se deriva de lo que existe. No agrega superficie. | — |
| IMP-S13 | Media | Encontrado al cerrar CMP-02 por una falla ocasional de `import-confirmation.int.test.ts`: el contador de cupo se creaba dentro de cada transacción con `INSERT IGNORE`, que al encontrar la fila deja un candado compartido hasta el final; dos o más altas simultáneas con ese candado se interbloqueaban al actualizar el contador y una terminaba en error (no en cupo rebasado: la integridad nunca estuvo en riesgo). Venía desde MOD-07. | **Corregido:** el contador se crea al asignar el plan, con la empresa bloqueada (`ensureQuotaRows` en `provisionCompany`), y `ensureRow` primero lee y solo inserta si falta. Queda una ventana teórica para empresas cuyo límite no se asignó con `provisionCompany` (sembrados y datos de prueba) cuando tres o más altas llegan a la vez la primera vez. La falla no se pudo reproducir a voluntad; la corrección se apoya en el análisis de candados y en una prueba de concurrencia que la vigila. |

## Siguiente revisión

Al cerrar la etapa CMP (proveedores, órdenes, recepciones, costos y envío de correos desde el worker).
