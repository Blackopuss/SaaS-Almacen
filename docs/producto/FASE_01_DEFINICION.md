# Fase 1 — Definición del inventario para ferreterías

Fecha: 2026-10-02. Estado: ejecución iniciada; entregables internos preparados, validación externa pendiente.

Esta fase corresponde a D01–D06 del plan. Los resultados siguientes combinan requisitos del fundador con decisiones propuestas para el prototipo; no representan entrevistas realizadas ni aprobación de precios. El nombre «almacén.» del prototipo es provisional.

## Estado y evidencia

| Jornada | Entregable de esta fase | Estado real |
| --- | --- | --- |
| D01 | Perfil de cliente, problema y cinco hipótesis, abajo | Preparado con información del fundador; pendiente contrastar con clientes |
| D02 | Guion, criterios de selección y registro de entrevistas | Preparado; cero entrevistas realizadas, cinco por agendar |
| D03 | Alcance, definición de producto facturable y tarjetas de precios | Borrador preparado; validación comercial pendiente de D02 |
| D04 | Reglas y casos de aceptación | Especificación preparada; reglas seleccionadas ejercitadas en el prototipo |
| D05 | Prototipo navegable en `prototype/` y protocolo de usabilidad | Implementado para revisión; ninguna prueba con tenderos realizada |
| D06 | Mapa de datos, riesgos, presupuesto y solicitudes de revisión | Preparado; cotizaciones, responsable fiscal/jurídico y presupuesto pendientes |

No se marca la fase completa: faltan entrevistas y validación con usuarios. Se puede preparar técnicamente D07 con los supuestos registrados; cualquier decisión que cambie tras el piloto debe actualizar el plan.

## D01 — Cliente, problema y resultado

Cliente inicial: dueño o encargado de una ferretería en México, una instalación con mostrador/bodega y zonas, pasillos y estantes; aproximadamente 1,000 referencias según la estimación del fundador. También se atenderán inventarios pequeños, desde 100 productos. Usuarios simultáneos y movimientos diarios no están medidos.

Situación que buscamos comprobar: administra existencias en Excel o registros manuales; necesita consultar cantidad y lugar sin recorrer el establecimiento ni reconciliar hojas. Tiene conexión a internet y puede usar computadora o celular. Su prioridad inicial es el inventario; ventas, compras y facturación de sus propias ventas quedan para expansiones.

Resultado de producto: abrir Inventario → buscar un producto → ver cantidad/unidad y estante → registrar entrada, salida o reubicación con su equivalencia → consultar el cambio en Movimientos.

| Hipótesis | Cómo comprobarla | Señal provisional de aceptación |
| --- | --- | --- |
| H01: cantidad y ubicación son un problema frecuente | Pedir el último caso real y el procedimiento usado | Al menos 3 de 5 entrevistados describen un caso reciente y su costo operativo |
| H02: una instalación cubre la entrada al mercado | Dibujar con cada negocio sus ubicaciones y flujo | Al menos 3 pueden pilotear sin traspasos entre sucursales |
| H03: las presentaciones configurables resuelven sus entradas | Obtener 10 productos con unidad y empaque del piloto | Todas las equivalencias se expresan sin aproximar cantidades |
| H04: el límite por producto se entiende y acepta | Explicar SKU con ejemplos y mostrar precio/cupo | Al menos 4 de 5 distinguen referencias de unidades físicas sin ayuda adicional |
| H05: la interfaz permite operar sin capacitación extensa | Prueba de tareas con el prototipo | Al menos 4 de 5 localizan cantidad/ubicación en 15 s y registran entrada en 60 s tras breve introducción |

Estas metas son propuestas. Si fallan, revisar el problema, la interfaz o el alcance antes de ampliar módulos.

## D02 — Investigación preparada

Instrumento ampliado para aplicar: [Cuestionario de investigación de almacén](CUESTIONARIO_ALMACEN.md), con 24 preguntas operativas, 6 comerciales, profundizaciones por segmento y síntesis de requisitos. Usar ese cuestionario como guion principal; las diez preguntas siguientes permanecen como resumen de la versión inicial. Primero recoger problemas y presupuesto espontáneos; presentar prototipo, modelo de cobro o tarjetas de precio después para evitar orientar las respuestas.

Seleccionar cinco ferreterías: dos de catálogo pequeño, dos cercanas a 1,000 referencias y una con varios miles. Son cuotas de reclutamiento propuestas, no negocios contactados. Buscar diferencias de dispositivos, familiaridad con Excel y empaques.

Guion de 25–30 minutos:

1. ¿Cómo supiste la última vez cuántas piezas había de un producto y dónde estaban?
2. Muéstrame el recorrido habitual usando un ejemplo ficticio o anonimizado.
3. ¿Qué ocurre cuando llega una caja y salen piezas sueltas? ¿Y con metros o kilos?
4. ¿Quién registra cambios y cuántos se hacen aproximadamente en un día?
5. ¿Cómo resuelves mercancía que aparece, falta o cambia de estante?
6. ¿Cuántas referencias distintas manejas? ¿Qué columnas tiene tu Excel?
7. ¿Qué pasa cuando se cae internet y qué dispositivos/lectores usas?
8. Mostrar las tareas del prototipo sin explicar dónde pulsar. Registrar tiempo y errores.
9. Mostrar una tarjeta de capacidad/precio, alternando su orden entre entrevistas. ¿Lo contratarías hoy? ¿Qué impediría hacerlo?
10. ¿Aceptarías un piloto con un catálogo de prueba y después un subconjunto conciliado de tu inventario?

Pedir permiso para tomar notas y acordar cómo se usarán; no copiar nombres de clientes, proveedores o documentos personales innecesarios. No subir inventario real al prototipo. Este guion está listo para usar, no se ha enviado a terceros.

| Registro | Segmento | Estado | Hallazgo / evidencia | Próximo paso |
| --- | --- | --- | --- | --- |
| E01 | Catálogo pequeño | Por agendar | Sin datos | Conseguir contacto |
| E02 | Catálogo pequeño | Por agendar | Sin datos | Conseguir contacto |
| E03 | Cerca de 1,000 SKU | Por agendar | Sin datos | Conseguir contacto |
| E04 | Cerca de 1,000 SKU | Por agendar | Sin datos | Conseguir contacto |
| E05 | Varios miles de SKU | Por agendar | Sin datos | Conseguir contacto |

## D03 — Alcance de la primera versión

Un solo perfil de usuario: acceso completo a las funciones contratadas de su empresa. No habrá perfiles separados de consulta, operador o gerente. La autorización del servidor seguirá validando cuenta, empresa, suscripción, cuota y recurso.

Para mantener el primer recorrido simple, el diseño empieza con la cuenta que crea el negocio. El número de cuentas simultáneas por empresa no está confirmado; las invitaciones quedan diferidas como decisión de alcance propuesta. «Un solo tipo de usuario» no se interpreta como autorización para compartir contraseñas.

Incluido en v1: catálogo; descripción/código/unidad; unidades y presentaciones; zonas/pasillos/estantes; existencias por ubicación; entradas/salidas; reubicación; conteo/ajuste; historial; mínimos; importación/exportación; plan por capacidad; acceso seguro; cobro y soporte.

Después de v1: cuentas invitadas/roles diferenciados si se requieren; multi-almacén; compras; ventas/POS; caja; facturación de ventas del cliente; lotes/series; valuación contable; API; offline; empaques físicamente sellados y transformaciones entre productos. La facturación de nuestra suscripción sí debe resolverse antes de comercializar.

Producto facturable propuesto: un SKU activo. Una caja de 100 tornillos y sus piezas comparten un producto. Almacenar ese producto en dos estantes no consume otro cupo. Otra medida con SKU propio sí consume otro. Al llegar al cupo, se mantienen las operaciones sobre el catálogo existente. No se borran referencias para reducir capacidad.

Capacidades propuestas: 100 / 500 / 1,000 / 3,000 / 10,000. Tarifas por validar. La capacidad no limita unidades físicas ni convierte cada movimiento en cargo.

### Tarjetas para investigar disposición a pagar

Los siguientes importes en MXN/mes son hipótesis internas de entrevista, creadas para comparar sensibilidad a precio. No son tarifas públicas, precios de competidores, cotizaciones ni una proyección de rentabilidad. Presentarlas con la misma definición de capacidad y funciones; pedir revisión fiscal antes de anunciar precios finales/impuestos. Los niveles intermedios se resolverán después de validar estos puntos de referencia.

| Capacidad de ejemplo | Tarjeta A | Tarjeta B | Tarjeta C |
| --- | --- | --- | --- |
| 100 productos | 99 | 149 | 199 |
| 1,000 productos | 299 | 399 | 499 |
| 10,000 productos | 799 | 999 | 1,299 |

Registrar razones y objeciones, no solo «sí/no». Ninguna tarjeta cambia la seguridad incluida. Revisar costo de soporte y margen antes de escoger. Las entrevistas o un cálculo posterior pueden descartar las tres tarjetas.

## D04 — Reglas y casos verificables

| ID | Regla / ejemplo | Resultado esperado |
| --- | --- | --- |
| INV-01 | TOR-001 tiene 120 piezas en A y 80 en B | Total 200, con desglose visible |
| INV-02 | Mover 20 de A a B | 100 en A, 100 en B; total 200 |
| INV-03 | Sacar 15 de A después del movimiento | 85 en A, 100 en B; total 185 |
| UNI-01 | Producto sin saldo; entrar 3 cajas de 100 | 300 piezas; conservar cantidad capturada y factor |
| UNI-02 | Sacar 25 piezas; cambiar caja a 120; entrar una caja | 395 piezas; la entrada anterior sigue siendo de 300 |
| UNI-03 | 200 m de cable menos 2.75 m | 197.25 m; cálculo exacto |
| UNI-04 | Registrar 0.5 piezas, factor cero o negativo | Rechazar sin alterar nada |
| MOV-01 | Salida mayor que saldo de la ubicación | Rechazar aunque haya stock en otro estante |
| MOV-02 | Reintentar la misma confirmación | Un solo movimiento y un solo cambio de saldo |
| MOV-03 | Corregir un movimiento confirmado | Reversa trazable con equivalencia original; no editar historia |
| IMP-01 | Archivo con cantidad o ubicación inválida | Vista previa informa; ninguna importación silenciosa |
| IMP-02 | Importar SKU existente | Detectar como actualización en producción; prototipo rechaza duplicados explícitamente |
| CAP-01 | 99/100 productos, dos altas simultáneas | Solo una se confirma en el servidor de producción |
| CAP-02 | 100/100 y entrada de 10,000 piezas de SKU existente | Permitida sin consumir otro cupo |
| SEC-01 | Usuario de empresa A solicita producto de B | Rechazar incluso con identificador conocido |
| NET-01 | Se pierde respuesta del servidor al guardar | Resolver por identificador antes de reintentar; no mostrar éxito sin evidencia |

La propuesta para precisión de producción se decidirá con datos del piloto en U01. El prototipo usa hasta tres decimales e integers escalados para evitar errores de coma flotante; esa limitación es explícita en su validación. No prueba transacciones, concurrencia, aislamiento ni seguridad de producción.

## D05 — Prototipo y prueba de usabilidad

Abrir el servidor local de `prototype/` y visitar `http://127.0.0.1:4173`. Ejecutar desde la raíz del proyecto:

```powershell
python prototype/serve.py
```

Incluye ocho productos ficticios, cuatro ubicaciones y plan de ejemplo de 1,000 referencias. Permite búsqueda/filtros, ficha, entrada/salida/reubicación, alta de productos con presentación, historial y pegado de filas tabuladas desde Excel con revisión previa. La demostración reinicia datos al recargar y no llama servicios externos.

La interfaz es una exploración en HTML/CSS/JavaScript sin dependencias de ejecución. No reemplaza el stack Next.js/TypeScript propuesto ni implementa backend, MySQL, login, cobro o carga de XLSX. Conteos, exportación y configuración de ubicaciones se especifican pero todavía no están construidos. Esto permite discutir el flujo antes de invertir en la infraestructura.

Tareas para el piloto:

1. Encontrar cuántos tornillos hay y en qué dos lugares están.
2. Registrar una entrada de tres cajas de 100 tornillos e identificar su equivalencia.
3. Intentar sacar más existencias de las disponibles y explicar el mensaje.
4. Reubicar 20 piezas y comprobar que no cambió el total.
5. Crear un producto con una caja configurable y registrar sus primeras existencias.
6. Pegar el ejemplo de Excel, revisar y confirmar sus dos productos.
7. Encontrar el movimiento recién registrado y su motivo.

| Participante | Tarea | Tiempo | Ayudas | Error/observación | Estado |
| --- | --- | --- | --- | --- | --- |
| Pendiente | 1–7 | Sin medir | Sin medir | No se ha realizado la prueba | Por agendar |

Pruebas técnicas locales: `node --test prototype/model.test.mjs`. La verificación visual automatizada adicional está en `prototype/verify-ui.cjs`, usa Playwright y Edge del entorno, con capturas en `prototype/qa/`. Resultados y límites se registran en `prototype/README.md`. Pasar estas pruebas no equivale a validar usabilidad con clientes.

## D06 — Datos, amenazas, operación y presupuesto

Flujo de producción propuesto: navegador autenticado → servicio con contexto de empresa → validación de suscripción/cupo/propiedad → transacción de inventario en MySQL → auditoría. Importación: archivo privado → validación/vista previa → confirmación → worker con cupos reservados y reintentos → resultado y eliminación del archivo según retención.

| Datos | Uso | Acceso propuesto / pendiente |
| --- | --- | --- |
| Cuenta, email, sesiones, recuperación | Autenticación y servicio | Cuenta propia; soporte por procedimiento restringido |
| Empresa, catálogo, ubicaciones, cantidades | Inventario | Único perfil del cliente limitado a su empresa |
| Movimientos y auditoría | Trazabilidad y conciliación | Cliente; acceso operativo extraordinario auditado |
| Archivos de importación | Migración | Privados; retención mínima a definir |
| Identificadores de cobro y contrato | Suscripción | Cliente/servicio; pago alojado para no capturar tarjeta en la app |
| Respaldos y logs | Recuperación/diagnóstico | Operación restringida; no registrar secretos |

| Riesgo concreto | Mitigación planificada | Evidencia exigida antes de vender |
| --- | --- | --- |
| Acceso a inventario de otra ferretería | Contexto de empresa y relaciones compuestas | Pruebas negativas con dos empresas |
| Salidas dobles / doble clic | Transacción e idempotencia | Concurrencia y reintento contra MySQL |
| Caja con contenido cambiado altera el pasado | Versiones y factor histórico | Reversa y reportes conservan cantidades |
| Importación excede cupo o mezcla referencias | Vista previa, reservas y validación por empresa | Importación simultánea con alta manual |
| Pérdida de datos | Respaldo/restauración ensayados | RPO/RTO medidos |
| Robo de cuenta | Biblioteca mantenida, sesiones, MFA y recuperación | Casos de expiración, revocación y recuperación |

La matriz de seguridad y las fuentes jurídicas están en el plan principal. No se ha completado una revisión legal ni seleccionado proveedor. Preparar y entregar al profesional que el fundador designe estas solicitudes:

- Revisión jurídica: identidad del vendedor, mercado México, condiciones de suscripción/cancelación, definición de cupo, conservación/exportación, tratamiento de datos, proveedores y textos versionados.
- Revisión fiscal: circuito de comprobantes por nuestra suscripción, precios/impuestos, cobro recurrente y conciliación. Separarlo de facturar ventas de las ferreterías.
- Cotización de infraestructura: web y worker, MySQL administrado, almacenamiento privado, correo, logs y respaldos; pedir región, límites, recuperación y costo total.

Solicitudes preparadas, no enviadas. Responsable de seguimiento: fundador, o la persona que designe.

### Hoja de presupuesto pendiente de cotizar

| Concepto | Tipo | Importe mensual |
| --- | --- | --- |
| Web y worker | Fijo + variable | Pendiente |
| MySQL administrado y recuperación | Fijo + crecimiento | Pendiente |
| Archivos, backups y transferencias | Variable | Pendiente |
| Correos y monitoreo | Fijo + variable | Pendiente |
| Cobro recurrente | Comisión + componentes aplicables | Pendiente |
| Soporte/mantenimiento | Horas × costo/hora | Pendiente |
| Jurídico/fiscal/revisión de seguridad | Inicial y recurrente | Pendiente |

Margen de contribución por cliente = ingreso neto de impuestos − comisiones − costo variable − soporte asignado. Clientes de equilibrio = costos fijos / margen de contribución positivo. Cotizar y calcular para 10, 50 y 100 clientes; no declarar viable una tarifa sin esas entradas.

## Siguiente paso

Revisar los recorridos del prototipo con el fundador, conseguir cinco entrevistas y contrastar las unidades/empaques con una muestra anonimizada. Después cerrar alcance y estimación en D06 y avanzar con D07–D12. Si se decide adelantar la base técnica, mantener explícitas las hipótesis pendientes; no declarar validación comercial completada.
