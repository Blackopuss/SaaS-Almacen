# ADR 0015 — Importación de salidas diarias

Fecha: 2026-10-10 · Estado: aceptada (con puntos a confirmar por el fundador) · Paso: IMP-10

## Contexto

El primer lanzamiento vende Inventario + Compras, sin punto de venta. Una ferretería que vende con otro sistema, o con notas, tendría que capturar a mano cada salida o su inventario dejaría de ser creíble en días. La salida rápida (INV-28) cubre el mostrador; falta una forma de traer, una vez al día, lo que ya quedó registrado en otro lado.

El riesgo propio de esta función es descontar dos veces: el mismo archivo subido de nuevo por error, o el archivo de hoy que también trae las ventas de ayer. Y su pregunta natural es «¿mi stock ya incluye lo de ayer?».

## Decisión

- **Una fila es un producto que salió en una venta**, con fecha, folio (el «identificador externo»: ticket, nota, número de venta), clave o código de barras, cantidad y, opcionalmente, presentación y ubicación. Un ticket con tres productos son tres filas con el mismo folio.
- **El folio es lo que impide duplicados.** La identidad de una salida importada es _producto + folio_ (sin distinguir mayúsculas ni acentos), por empresa. Se guarda en `exit_import_row.appliedKey` solo cuando la salida se registra, en la misma transacción que el movimiento, con un índice único. Una fila cuya identidad ya existe —la haya traído este archivo u otro— queda como duplicada y no mueve nada. Por eso volver a subir un archivo es siempre seguro, y es además la forma de reintentar lo que no entró.
- **No hay paso para elegir columnas.** Un archivo de salidas se hace todos los días: las columnas se reconocen por su título (los de la plantilla o los habituales) y, si falta una obligatoria, el archivo se rechaza diciendo cuál. El separador decimal sí lo elige la persona en cada subida; no se adivina.
- **Fechas sin ambigüedad.** Se aceptan `año-mes-día` y `día/mes/año`; nunca `mes/día`. Una fecha futura o una celda de fecha de Excel sin formato de texto (un número de serie) se rechaza con la explicación. La fecha es un día del calendario de la empresa.
- **Revisar no escribe; confirmar fija; el worker registra.** La revisión relee el archivo y lo compara con el catálogo y las ubicaciones de ese momento. Confirmar exige que todas las filas estén bien, copia las filas (producto, presentación, ubicación, cantidad, día, folio) y encola el trabajo en la misma transacción. El worker registra por lotes; cada fila es una salida (`EXIT`) como las manuales: se convierte con la presentación vigente al registrarla, bloquea producto y ubicación, y el saldo nunca baja de cero.
- **Una salida que no cabe no detiene a las demás.** Queda «no se pudo descontar» con su motivo (no hay existencias, producto o ubicación archivados). Tras corregir el inventario, se sube el mismo archivo y solo entra lo que faltaba.
- **«Actualizado hasta».** Se deriva de las filas registradas: el último día con una salida importada, cuántas se están registrando y cuántas siguen sin descontarse. No se guarda ninguna bandera.
- **Permisos.** Subir: `inventory.import.create`. Confirmar: `inventory.import.confirm` y `inventory.exit.create` (importar no elude el permiso de registrar salidas), y el worker los vuelve a comprobar antes de cada lote. Cancelar: `inventory.import.cancel`; lo ya registrado se queda.

## Consecuencias

- Reversar a mano una salida importada no permite volver a importarla con el mismo folio: la corrección se hace con otro movimiento. Es coherente con «un movimiento se corrige con reversa», pero conviene decirlo en la ayuda.
- La fecha del movimiento es el momento en que se registró; el día de la venta va en su motivo y en la fila importada. Si más adelante los movimientos tienen «fecha de ocurrencia», esta importación debe llenarla.
- Se registra un movimiento por fila, no uno por ticket: el historial muestra varias salidas con el mismo folio. Agruparlas por ticket es posible después sin cambiar la identidad de las filas.
- Quien venda con el módulo Ventas (VEN) no debe además importar esas mismas ventas: VEN-25 debe advertirlo.

## A confirmar por el fundador

1. Si prefiere una salida por ticket en lugar de una por producto.
2. Si los sistemas de venta de los pilotos exportan fecha, folio y clave con otros títulos o formatos (se agregan a los sinónimos).
3. Si debe poder importarse con fecha de otro año o con más de cierto atraso sin aviso.
