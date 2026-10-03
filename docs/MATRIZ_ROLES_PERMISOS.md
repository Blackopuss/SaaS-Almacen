# Matriz de roles × permisos — Inventario y Compras

**Estado: Aprobada por el fundador el 2026-10-03 (FUN-07).** Fuente de verdad del catálogo en código (USR-01); `src/platform/authorization` se prueba contra estas tablas.  
**Fecha: 2026-10-03**

Este documento propone permisos y su asignación para el lanzamiento. No constituye aprobación, implementación ni cierre de FUN-07. Su criterio «Listo cuando» exige una tabla aprobada por el fundador; FUN-05 también es prerrequisito y esta propuesta no acredita entrevistas ni su validación.

## Fuentes y criterio de interpretación

- [Plan de implementación v0.6](PLAN_IMPLEMENTACION.md): secciones 1 y 3 (alcance e integridad), sección 4 «Módulos y modelo comercial», en particular «Usuarios y roles», y pasos FUN-07, USR-01 a USR-11, MOD-01 a MOD-11, INV-01 a INV-35, IMP-01 a IMP-12 y CMP-01 a CMP-18, incluidos sus pasos con sufijo.
- [Fase 1 — Definición](FASE_01_DEFINICION.md): alcance operativo, reglas D04, importación, aislamiento y trazabilidad. Sus referencias a un perfil único, invitaciones diferidas y Compras posterior son históricas, reemplazadas por el plan v0.6 y la decisión posterior registrada en memoria. Sus IDs INV/UNI/MOV son casos de aceptación, no los pasos actuales del plan.
- [Memoria del proyecto](../MEMORY.md): decisión del 2026-10-02 de varios usuarios con roles predefinidos combinables, Inventario obligatorio, Compras en el lanzamiento, cupos por empresa y estado real de PLT-10. Las propuestas antiguas de perfil único no prevalecen sobre esa decisión.
- [ADR 0005 — Alta de empresa con titular](adr/0005-empresas.md): titular creado junto con su membresía, MFA, una empresa por cuenta al crearla y futuras invitaciones a empresas existentes.
- [Reglas del proyecto](../AGENTS.md): contexto de empresa, reglas en servicios, cantidades exactas y conservación del historial.

Los cinco perfiles provienen del plan. Los identificadores, la granularidad y las asignaciones detalladas de esta matriz son propuestas para USR-01, no permisos ya existentes en código. Las decisiones que las fuentes no resuelven se señalan en «Preguntas para el fundador».

## Perfiles de lanzamiento

| Perfil | Identificador propuesto | Descripción |
| --- | --- | --- |
| Titular | Condición `Organization.ownerUserId`, sin rol asignable | Una persona por empresa con operación completa de lo contratado y autoridad exclusiva sobre contratación, cancelación, método de pago y transferencia de titularidad. |
| Administrador | `administrator` | Opera todos los módulos contratados y administra configuración y equipo dentro de los límites que protegen al titular y evitan elevar privilegios. |
| Almacén | `warehouse` | Administra catálogo, ubicaciones, movimientos y conteos de Inventario, sin operar Compras. |
| Comprador | `buyer` | Administra proveedores, órdenes, recepciones y devoluciones de Compras, y consulta Inventario. |
| Consulta | `viewer` | Consulta información operativa y, según esta propuesta, la exporta, sin modificar datos de negocio. |

**El titular es la persona referenciada por `Organization.ownerUserId`; no es un rol combinable ni un valor aceptable en `MembershipRole` o en una invitación.** La columna Titular permite comparar sus facultades con las de los roles, pero no propone un quinto rol asignable. La condición de titular se comprueba en servidor para la empresa activa, además de la membresía vigente.

Cajero y Vendedor pertenecen a fases posteriores de Ventas/CRM y no se habilitan en este lanzamiento. «Personal de plataforma» ya aparece en MOD-09: es una autoridad interna separada, no un rol de los clientes ni una combinación que pueda asignar su equipo. No se proponen roles nuevos ni roles personalizables.

## Reglas de autorización de la propuesta

1. **Denegar por defecto.** Solo se admiten permisos declarados y concedidos expresamente. Un permiso nuevo o desconocido no se concede a nadie automáticamente, tampoco por un comodín del titular. «Sí» permite evaluar la operación; no omite sus demás validaciones.
2. **Unión de roles por membresía.** Los permisos de Administrador, Almacén, Comprador y Consulta se unen dentro de una misma empresa y consumen un solo lugar de usuario. «No» significa que ese rol no concede el permiso; no es una prohibición que anule el «Sí» de otro rol. Almacén + Comprador puede comprar por Comprador; Consulta + Almacén puede escribir por Almacén. Los casos «Consulta no escribe» y «Almacén no compra» se prueban también con cada rol aislado.
3. **Validar en servidor:** sesión y MFA cuando corresponda → membresía activa y empresa → permiso y restricciones sobre el destinatario/recurso → módulo y estado de suscripción → cupo y reglas de negocio. Ningún identificador recibido, menú oculto o tarea en segundo plano sustituye esas comprobaciones. Una membresía o un permiso de otra empresa nunca se suma a los de la empresa activa.
4. **Titular protegido.** Ningún administrador puede cambiar `ownerUserId`, desactivar o degradar al titular, modificar sus roles como vía indirecta de degradación, ni concederse facultades reservadas. Se propone que solo el titular nombre, modifique o desactive administradores; un administrador gestiona únicamente miembros no titulares y no administradores, asignando Almacén, Comprador o Consulta dentro de sus propios permisos (pregunta 6). Tampoco modifica sus propios roles. Aplicar estas reglas a invitaciones, cambios individuales y operaciones masivas.
5. **Transferencia específica.** Solo el titular actual inicia la transferencia mediante `platform.ownership.transfer`; debe ser atómica, dejar exactamente un titular y no depender de una asignación de roles. Se propone destinatario con membresía activa, MFA y aceptación explícita, más reautenticación del titular actual. El destino deja de depender de roles combinables para sus facultades de titular; el tratamiento del anterior titular se somete a la pregunta 8.
6. **Módulos y vigencia.** Inventario es obligatorio; Compras requiere Inventario y Contactos. Un rol no contrata ni activa derechos por sí mismo. No se puede quitar Inventario mientras Compras permanezca activo. Sin haber contratado Compras no hay acceso a sus operaciones; al desactivarlo se conserva el historial en lectura/exportación conforme al contrato, con el permiso correspondiente. Suscripción vencida: solo lectura y exportación de datos existentes, sin nuevas operaciones (MOD-11). Las gestiones del titular necesarias para renovar o cancelar siguen su flujo comercial y no habilitan escritura operativa anticipadamente.
7. **Cupos independientes de roles.** Altas, duplicados y reactivaciones de productos, invitaciones y reservas de importación validan cupo atómicamente. Invitaciones pendientes cuentan; varios roles no duplican el consumo. Un administrador puede invitar dentro de la capacidad contratada, pero no comprar usuarios adicionales. Alcanzar el cupo no bloquea movimientos de productos existentes ni exportaciones permitidas.
8. **Sin atajos sobre stock.** Editar ficha no modifica cantidad; las confirmaciones generan movimientos inmutables, con autor, motivo, fecha y contexto de empresa. Ajustar exige motivo; reversar conserva factor y cantidades originales. Ningún perfil edita o elimina movimientos confirmados, saldos directamente ni eventos de auditoría. Las restricciones de negativos, concurrencia, precisión y archivo aplican también al titular.
9. **Efectos entre módulos.** Recibir y devolver requieren permisos de Compras y generan el movimiento de Inventario en la misma transacción. Comprador no necesita ni recibe por ello el permiso de entrada/salida manual. La reversa genérica de Inventario se limita a movimientos propios de Inventario; no revierte aisladamente recepciones o devoluciones y deja desincronizado su documento. Una corrección de Compras utiliza su flujo específico, con sus límites acumulados.
10. **Exportar no autoriza importar.** Consulta puede generar y descargar exportaciones de información que puede leer; la creación técnica del archivo/job no modifica datos de negocio. Importar, incluso previsualizar un archivo privado para importación, exige permiso de importación. Los jobs conservan empresa y actor, revalidan permisos pertinentes antes de ejecutar cada lote o reintento y no continúan escrituras tras revocación. Las descargas verifican acceso vigente y nunca exponen archivos ajenos.

## Catálogo de permisos y matriz

Cada fila es a la vez una entrada del catálogo y su asignación propuesta: identificador estable en inglés con tres segmentos `modulo.recurso.accion`, alcance, paso de origen y columnas **Sí/No**. Las abreviaturas de columnas son **T** = Titular, **A** = Administrador, **AL** = Almacén, **CO** = Comprador y **CN** = Consulta. Todos los «Sí» están sujetos a las reglas anteriores.

Los prefijos describen la capacidad funcional, no la ubicación física del servicio. Por ejemplo, `inventory.product.create` puede implementarse en `platform/catalog`, y los proveedores de Compras en `platform/contacts`, conservando el catálogo y los contactos compartidos que exige el plan.

### Plataforma — empresa y equipo

| Permiso | Alcance y referencia | T | A | AL | CO | CN |
| --- | --- | --- | --- | --- | --- | --- |
| `platform.organization.read` | Ver nombre y configuración operativa básica de la empresa activa; sección 4 y ADR 0005. | Sí | Sí | Sí | Sí | Sí |
| `platform.organization.update` | Editar configuración del negocio; excluye titularidad, cobro y derechos contratados; sección 4. | Sí | Sí | No | No | No |
| `platform.team.read` | Listar miembros, estado, roles e invitaciones; USR-08. | Sí | Sí | No | No | No |
| `platform.team.invite` | Invitar por correo con roles permitidos y cupo disponible; USR-04, MOD-08. | Sí | Sí | No | No | No |
| `platform.invitation.resend` | Reenviar una invitación que el actor puede gestionar; USR-08. | Sí | Sí | No | No | No |
| `platform.invitation.cancel` | Cancelar una invitación que el actor puede gestionar y liberar su cupo; USR-08. | Sí | Sí | No | No | No |
| `platform.team.assign_roles` | Asignar o combinar roles respetando destinatario y límites del actor; USR-06, USR-03B. | Sí | Sí | No | No | No |
| `platform.team.disable` | Desactivar miembro permitido, revocar sesiones y conservar autoría; USR-07, USR-03B. | Sí | Sí | No | No | No |
| `platform.ownership.transfer` | Transferir titularidad mediante flujo exclusivo y atómico; USR-03B. | Sí | No | No | No | No |
| `platform.audit.read` | Consultar bitácora de empresa, equipo y operaciones sensibles, sin secretos; USR-11, PLT-14 y sección 5; pregunta 7. | Sí | Sí | No | No | No |

Aceptar una invitación (USR-05) no exige un rol previo en esa empresa ni concede `platform.team.invite`: exige cuenta autenticada correspondiente al correo invitado, token vigente de un solo uso, empresa y roles válidos y cupo reservado. Al aceptar se revalida que la invitación no se haya cancelado ni convertido en una vía de escalamiento. Perfil, contraseña, MFA y sesiones propias siguen los controles de identidad de PLT; no otorgan acceso al equipo ni a sesiones ajenas.

La lectura de auditoría no evita permisos sobre información comercial: ocultar detalles de pago sin `platform.billing.read` y costos sin `purchasing.cost.read`. Los eventos se generan desde servicios; ninguna fila permite editarlos o borrarlos.

### Plataforma — módulos, plan y suscripción

| Permiso | Alcance y referencia | T | A | AL | CO | CN |
| --- | --- | --- | --- | --- | --- | --- |
| `platform.module.read` | Consultar módulos disponibles y derechos efectivos para navegación; MOD-01/02/04/05. | Sí | Sí | Sí | Sí | Sí |
| `platform.capacity.read` | Consultar uso y límites de productos/usuarios, sin datos de pago; MOD-07/08/10, INV-35. | Sí | Sí | Sí | Sí | Sí |
| `platform.plan.read` | Consultar «Mi plan»: nivel, condiciones contratadas, módulos y vigencia; MOD-03/10. | Sí | Sí | No | No | No |
| `platform.plan.change` | Solicitar cambio de capacidad o usuarios adicionales, mostrando total y fecha efectivos; sección 4, USR-03A. | Sí | No | No | No | No |
| `platform.module.activate` | Contratar/solicitar activación de módulo disponible con sus dependencias; MOD-02/06, USR-03A. | Sí | No | No | No | No |
| `platform.module.deactivate` | Solicitar baja de módulo con advertencias de pendientes y conservación de historia; MOD-06, CMP-17. | Sí | No | No | No | No |
| `platform.subscription.create` | Contratar la suscripción y consentir sus condiciones; USR-03A, sección 4. | Sí | No | No | No | No |
| `platform.subscription.cancel` | Cancelar la suscripción conforme a sus condiciones; USR-03A, MOD-11. | Sí | No | No | No | No |
| `platform.billing.read` | Consultar información de pago y comprobantes de la suscripción; sección 4; alcance propuesto solo para titular. | Sí | No | No | No | No |
| `platform.billing.manage` | Cambiar método de pago y gestionar su autorización; no permite alterar derechos efectivos directamente; USR-03A. | Sí | No | No | No | No |
| `platform.provisioning.manage` | Asignar nivel, módulos y vigencia desde consola interna con MFA y auditoría; MOD-09. Exclusivo de personal de plataforma. | No | No | No | No | No |

«Administrador no cobra» significa aquí que no contrata, cancela, altera conceptos con costo ni administra métodos de pago de la suscripción. No se introduce cobro de ventas ni caja: pertenecen a Ventas. La salida rápida «por venta» de INV-28 no cobra ni emite ticket.

Los permisos comerciales del titular autorizan su consentimiento o solicitud, no la escritura arbitraria de `Entitlement`, límites o fechas de vigencia. En el lanzamiento con cobro asistido, personal de plataforma ejecuta MOD-09 tras la autorización correspondiente; la automatización de BIL vendrá después. Tampoco el titular registra pagos SPEI como personal interno. Registrar/versionar contratos de módulo, planes y precios (MOD-01/02/03) es configuración interna, no una facultad para editar precios desde una empresa cliente.

### Inventario — catálogo, unidades, ubicaciones y consulta

| Permiso | Alcance y referencia | T | A | AL | CO | CN |
| --- | --- | --- | --- | --- | --- | --- |
| `inventory.product.read` | Lista, búsqueda, filtros, ficha, atributos y archivados; INV-01/10/11/12/26/29. | Sí | Sí | Sí | Sí | Sí |
| `inventory.product.create` | Alta y eventual duplicación por el mismo servicio con cupo; INV-02, MOD-07. | Sí | Sí | Sí | No | No |
| `inventory.product.update` | Editar ficha, categoría, marca, códigos, precisión e incremento válidos; nunca saldo; INV-03/06. | Sí | Sí | Sí | No | No |
| `inventory.product.archive` | Archivar sin stock ni operaciones pendientes, sin borrar historial; INV-04/19B, CMP-11. | Sí | Sí | Sí | No | No |
| `inventory.product.reactivate` | Reactivar producto archivado consumiendo cupo; INV-04, MOD-07. | Sí | Sí | Sí | No | No |
| `inventory.unit.read` | Consultar catálogo de unidades/dimensiones sembrado por el sistema; INV-05. | Sí | Sí | Sí | Sí | Sí |
| `inventory.presentation.read` | Ver presentaciones, factores, versiones y equivalencias autorizadas; INV-07/08/09. | Sí | Sí | Sí | Sí | Sí |
| `inventory.presentation.create` | Crear presentación por producto con factor directo válido; INV-07. | Sí | Sí | Sí | No | No |
| `inventory.presentation.update` | Cambiar presentación/factor mediante nueva versión, sin reescribir el pasado; INV-08. | Sí | Sí | Sí | No | No |
| `inventory.location.read` | Consultar instalación, General y jerarquía de ubicaciones; INV-13/14/26. | Sí | Sí | Sí | Sí | Sí |
| `inventory.location.create` | Crear zonas, pasillos y estantes de la instalación; INV-14. | Sí | Sí | Sí | No | No |
| `inventory.location.update` | Editar nombres y jerarquía sin ciclos ni relaciones ajenas; INV-14. | Sí | Sí | Sí | No | No |
| `inventory.location.archive` | Archivar ubicación sin stock ni pendientes, conservando referencias; sección 3, INV-14. | Sí | Sí | Sí | No | No |
| `inventory.stock.read` | Consultar existencias totales y por ubicación, con equivalencias; INV-15/26. | Sí | Sí | Sí | Sí | Sí |
| `inventory.movement.read` | Ver historial y filtros por fecha, producto, usuario y tipo; INV-27. | Sí | Sí | Sí | Sí | Sí |
| `inventory.minimum.read` | Consultar mínimos y productos con existencias bajas; INV-30. | Sí | Sí | Sí | Sí | Sí |
| `inventory.minimum.update` | Configurar mínimo por producto; INV-30. | Sí | Sí | Sí | No | No |
| `inventory.dashboard.read` | Panel con existencias bajas, últimos movimientos y uso del cupo; INV-35. | Sí | Sí | Sí | Sí | Sí |

Consultar equivalencias (INV-09) no concede permiso para confirmar el movimiento que las utiliza. La unidad base no cambia libremente después del primer movimiento. El catálogo global de unidades y la creación automática de instalación/General son tareas del sistema, no permisos para crear sucursales o editar unidades globales. No se propone borrado físico de productos o ubicaciones.

### Inventario — movimientos, conteos, importar y exportar

| Permiso | Alcance y referencia | T | A | AL | CO | CN |
| --- | --- | --- | --- | --- | --- | --- |
| `inventory.entry.create` | Entrada manual en unidad base o presentación; INV-16/17/29. | Sí | Sí | Sí | No | No |
| `inventory.opening.create` | Registrar saldo inicial guiado como movimiento; INV-18. | Sí | Sí | Sí | No | No |
| `inventory.exit.create` | Salida manual y salida rápida multilínea con motivo/referencia, sin cobro; INV-19/28/29. | Sí | Sí | Sí | No | No |
| `inventory.transfer.create` | Reubicar entre ubicaciones de la misma instalación y empresa, atómicamente; INV-23. | Sí | Sí | Sí | No | No |
| `inventory.adjustment.create` | Ajustar con motivo obligatorio y auditoría; INV-24; pregunta 1. | Sí | Sí | Sí | No | No |
| `inventory.movement.reverse` | Reversar movimiento de Inventario con motivo y valores originales, sin editarlo; INV-25; pregunta 1. | Sí | Sí | Sí | No | No |
| `inventory.count.read` | Consultar sesiones de conteo, capturas y diferencias; INV-31/32. | Sí | Sí | Sí | No | Sí |
| `inventory.count.create` | Abrir conteo con alcance y referencia temporal; INV-31. | Sí | Sí | Sí | No | No |
| `inventory.count.update` | Capturar/corregir cantidades del conteo abierto y previsualizar diferencias; INV-31/32. | Sí | Sí | Sí | No | No |
| `inventory.count.apply` | Aplicar ajustes del conteo con motivo, movimientos posteriores e idempotencia; exige también `inventory.adjustment.create`; INV-33; pregunta 1. | Sí | Sí | Sí | No | No |
| `inventory.import.create` | Descargar plantilla, subir CSV/XLSX, mapear, validar y previsualizar productos/saldos/salidas; IMP-02/03/04/05/06/09/10. | Sí | Sí | Sí | No | No |
| `inventory.import.read` | Consultar archivo, errores, progreso, resultado parcial y fecha de actualización de una importación autorizada; IMP-02/05/08/10. | Sí | Sí | Sí | No | No |
| `inventory.import.confirm` | Confirmar importación y reservas; exige además cada permiso de la operación importada; IMP-07/08/09/10. | Sí | Sí | Sí | No | No |
| `inventory.import.cancel` | Cancelar trabajo y liberar solo reservas no consumidas, sin revertir lo ya aplicado; IMP-08B. | Sí | Sí | Sí | No | No |
| `inventory.export.create` | Generar/descargar exportación segura de catálogo, existencias e historial legibles por el actor; IMP-11, sección 4; pregunta 5. | Sí | Sí | Sí | Sí | Sí |

Importar no permite eludir controles manuales: productos nuevos requieren `inventory.product.create`; actualizaciones, `inventory.product.update`; reactivaciones, `inventory.product.reactivate`; presentaciones nuevas o modificadas, su permiso correspondiente; saldos iniciales, `inventory.opening.create`; salidas diarias, `inventory.exit.create`. Validar todo antes de confirmar y otra vez al ejecutar lo pertinente. Archivo, ejecución, lectura y cancelación de un job permanecen dentro de la empresa y de las operaciones autorizadas al actor.

Los conteos aplicados son inmutables; `inventory.count.update` no los reabre. La reversa verifica también el permiso de la operación de origen y sus reglas de stock. No existe un permiso para ignorar stock negativo, forzar archivo con existencias, sobrescribir factores históricos o confirmar sin conexión.

### Compras — proveedores y costos

| Permiso | Alcance y referencia | T | A | AL | CO | CN |
| --- | --- | --- | --- | --- | --- | --- |
| `purchasing.supplier.read` | Buscar y consultar contactos en su faceta de proveedor; CMP-01/02. | Sí | Sí | No | Sí | Sí |
| `purchasing.supplier.create` | Crear proveedor con validación y advertencia de duplicados; CMP-02. | Sí | Sí | No | Sí | No |
| `purchasing.supplier.update` | Editar datos compartidos necesarios del proveedor; no concede futuras operaciones de clientes/CRM; CMP-01/02. | Sí | Sí | No | Sí | No |
| `purchasing.product_supplier.read` | Ver relación producto-proveedor, código y presentación de compra; CMP-03. | Sí | Sí | No | Sí | Sí |
| `purchasing.product_supplier.create` | Vincular producto existente con proveedor de la empresa; CMP-03. | Sí | Sí | No | Sí | No |
| `purchasing.product_supplier.update` | Editar código o presentación de compra del vínculo; no cambia el factor del catálogo; CMP-03. | Sí | Sí | No | Sí | No |
| `purchasing.cost.read` | Consultar costos e importes de compras y último costo; CMP-03/13; pregunta 4 (fundador: privados de Compras). | Sí | Sí | No | Sí | No |
| `purchasing.cost.record` | Capturar costo dentro de orden/recepción autorizada; actualizar último costo al registrar compra, sin valuación contable; CMP-04/13. | Sí | Sí | No | Sí | No |

Los costos no se filtran indirectamente por ficha de producto, historial, panel, exportación o respuesta de API a quien no tenga `purchasing.cost.read`. Decisión del fundador (pregunta 4): los precios son privados de Compras; Consulta no los ve en ninguna pantalla, PDF, reporte ni exportación. `purchasing.cost.record` exige también el permiso para crear/editar la orden o confirmar la recepción; no ofrece edición libre del costo histórico ni de documentos recibidos. Archivar proveedores no tiene un paso explícito en CMP y no se habilita implícitamente con edición.

### Compras — órdenes, recepciones, devoluciones y reportes

| Permiso | Alcance y referencia | T | A | AL | CO | CN |
| --- | --- | --- | --- | --- | --- | --- |
| `purchasing.order.read` | Consultar órdenes, líneas, estados y pendientes; CMP-04/05/11. Sin `purchasing.cost.read` se ocultan precios e importes. | Sí | Sí | No | Sí | Sí |
| `purchasing.order.create` | Crear borrador y líneas con presentación/versiones; CMP-04. | Sí | Sí | No | Sí | No |
| `purchasing.order.update` | Editar borrador; documentos enviados/recibidos no se reescriben libremente; CMP-04/05. | Sí | Sí | No | Sí | No |
| `purchasing.order.submit` | Confirmar transición válida de borrador a enviada; no implica aprobación por otra persona; CMP-05; pregunta 3. | Sí | Sí | No | Sí | No |
| `purchasing.order.export` | Generar y descargar PDF de orden autorizada, sujeto a lectura de sus datos; CMP-06A. El PDF lleva precios, por eso Consulta no lo descarga (pregunta 4). | Sí | Sí | No | Sí | No |
| `purchasing.order.send` | Enviar por correo y reintentar entrega con destinatario validado; exige orden en estado válido y `purchasing.order.submit` si cambia a enviada; CMP-06B. | Sí | Sí | No | Sí | No |
| `purchasing.order.cancel` | Cancelar conforme a transición válida, sin borrar recepciones ni historia; CMP-05. | Sí | Sí | No | Sí | No |
| `purchasing.order.close` | Cerrar con faltante registrado, sin inventar recepción del remanente; CMP-11. | Sí | Sí | No | Sí | No |
| `purchasing.receipt.read` | Consultar recepciones, líneas, ubicación y pendientes; CMP-07/08/09. | Sí | Sí | No | Sí | Sí |
| `purchasing.receipt.create` | Confirmar recepción total/parcial y entrada atómica en destino con factor vigente visible; CMP-07/08/09/10; pregunta 2. | Sí | Sí | No | Sí | No |
| `purchasing.return.read` | Consultar devoluciones ligadas a recepción; CMP-12. | Sí | Sí | No | Sí | Sí |
| `purchasing.return.create` | Devolver al proveedor con límite acumulado por recepción y salida atómica; CMP-12. | Sí | Sí | No | Sí | No |
| `purchasing.suggestion.read` | Consultar sugerencias desde mínimos y proveedores; CMP-14. | Sí | Sí | No | Sí | Sí |
| `purchasing.suggestion.generate` | Generar borradores por proveedor desde sugerencias; exige `purchasing.order.create`; CMP-14. | Sí | Sí | No | Sí | No |
| `purchasing.report.read` | Consultar pendientes y compras por proveedor; los costos e importes solo con `purchasing.cost.read`; CMP-15. | Sí | Sí | No | Sí | Sí |
| `purchasing.report.export` | Exportar reportes de Compras que se pueden leer, sin costos para quien no los ve; CMP-15; preguntas 4 y 5. | Sí | Sí | No | Sí | Sí |

No se propone una aprobación separada de órdenes ni un permiso activo `purchasing.order.approve`: CMP-05 solo define borrador → enviada → parcial → recibida o cancelada. Ese identificador sería una **sugerencia de ampliación**, denegada mientras no se apruebe el flujo de la pregunta 3. No se introducen pagos a proveedores, cuentas por pagar, importación masiva de órdenes ni un módulo de contabilidad.

## Cobertura de pasos sin permiso interactivo propio

No todo paso del plan es una acción asignable a una persona. Los siguientes controles se aplican a los permisos anteriores y no se convierten en facultades para saltarlos:

| Pasos | Cobertura propuesta |
| --- | --- |
| USR-01/02/09/10 | Catálogo, unión de roles, autorización central, UI y pruebas negativas basadas en esta matriz. |
| USR-03A/03B, USR-04/05/06/07/08/11 | Facultades exclusivas, protección del titular, ciclo de invitación, gestión de equipo y auditoría; aceptación de invitación por identidad/token, no por rol previo. |
| MOD-01/02/03/04 | Contratos, registro y precios versionados internos; derechos efectivos calculados, nunca editables por permisos del cliente. |
| MOD-05/06/07/08/10/11 | Guard transversal, dependencias, cupos, «Mi plan» y restricciones de vigencia; sin permiso para evadirlos. |
| MOD-09 | `platform.provisioning.manage`, denegado a todos los perfiles de empresa; personal interno con MFA y auditoría. |
| INV-01/05/06/09/13/15 | Esquemas, unidades sembradas, precisión, conversión y ubicación automática; consultar/configurar lo permitido no autoriza DDL ni saldos directos. |
| INV-19B/20/21/22/29/32/34 | Archivo protegido, concurrencia, idempotencia, reconexión, lector, detección de cambios durante conteo y reconciliación automática. El lector usa los permisos de búsqueda/entrada/salida; la reconciliación detecta diferencias, no concede reparación silenciosa del saldo. |
| IMP-01/02/07/08/08B/12 | Worker y archivos privados, reservas y liberación segura; guía de primer uso sin permisos adicionales. El job hereda restricciones, no autoridad superior. |
| CMP-01/05/10/13/16/17/18 | Contactos compartidos, estados válidos, concurrencia, costo sin valuación, guard de Compras, desactivación y pruebas integrales; no crean facultades de otros módulos. |

Los demás pasos operativos de INV y CMP aparecen en las filas correspondientes del catálogo. Registrar auditoría de equipo/stock/cobro es un efecto obligatorio del servicio, no un permiso de escritura de bitácora para usuarios. No se propone aún una pantalla de auditoría exportable independiente: los historiales operativos y sus exportaciones conservan sus permisos propios.

## Decisiones del fundador (2026-10-03)

1. **Ajustes, reversas y conteos de Almacén sin aprobación: sí**, pero siempre con la **justificación** de la acción (motivo obligatorio, guardado en la bitácora).
2. **Almacén no recibe órdenes ni devuelve al proveedor.** Lo reporta y lo consulta con la persona de Compras, que es quien registra la recepción o devolución. (Si alguien hace ambas cosas, se le asignan los dos roles.)
3. **El Comprador envía, cancela y cierra órdenes sin otra autorización: sí.** El Comprador es responsable de los gastos.
4. **Consulta no ve precios ni costos**: son privados de Compras. Tampoco en PDF de órdenes, reportes ni exportaciones.
5. **Consulta puede descargar**, solo los datos que ya puede ver (sin precios).
6. **Solo el titular nombra, cambia o quita administradores.** El administrador gestiona únicamente Almacén, Comprador y Consulta y no cambia su propio rol.
7. **La bitácora completa la ven solo el titular y los administradores.** Los demás ven el historial operativo que su rol permite.
8. **Transferencia de titularidad:** los roles del titular anterior se eligen al transferir, con Consulta propuesto por defecto; nunca pasa a Administrador en automático. El nuevo titular acepta explícitamente y debe tener MFA activa.

## Preguntas para el fundador

Preguntas originales de la propuesta; las respuestas están en «Decisiones del fundador».

1. **¿Almacén puede ajustar, reversar movimientos propios de Inventario y aplicar conteos sin aprobación de Administrador?** Recomendación: sí en el lanzamiento, con motivo obligatorio, auditoría y límites de integridad; separar captura y aplicación mediante permisos permite restringirlo después si el piloto lo exige.
2. **¿Quien solo tiene Almacén debe recibir órdenes y devolver mercancía al proveedor?** Recomendación: no; mantener «Almacén no compra» incluyendo recepciones/devoluciones de Compras y combinar Almacén + Comprador cuando esa persona deba realizar ambas funciones. Esa combinación también concede órdenes y proveedores; no simular un rol de recepción restringida que el plan no contempla.
3. **¿Comprador puede enviar/cancelar órdenes y cerrarlas con faltantes, o se necesita aprobación previa de otra persona o por importe?** Recomendación: permitirle el flujo completo definido por CMP sin aprobación adicional. Si se requiere autorización separada, aprobar primero estados, umbral y regla sobre autoaprobación, y entonces agregar `purchasing.order.approve` y reestimar el alcance.
4. **¿Consulta puede ver costos, importes y último costo de compra?** Recomendación: sí dentro de Compras, para conservar un rol de lectura sencillo; mantenerlos ocultos para Almacén. Si se prefiere reservar costos a Titular/Administrador/Comprador, cambiar también las respuestas, PDF y exportaciones para evitar filtraciones.
5. **¿Consulta puede descargar inventario, historial, PDF de órdenes y reportes de Compras?** Recomendación: sí, únicamente de los datos que puede leer, con auditoría y archivos privados. Generar un archivo no modifica datos de negocio; no concede envío de órdenes por correo ni importación.
6. **¿Solo el titular puede nombrar, cambiar o desactivar administradores?** Recomendación: sí; Administrador gestiona únicamente Almacén, Comprador y Consulta, sin modificar su propia asignación. Esto es más restrictivo que solo prohibir permisos superiores y evita elevación indirecta mediante otra cuenta.
7. **¿La bitácora completa de empresa/equipo se reserva a Titular y Administrador?** Recomendación: sí; los demás conservan únicamente los historiales operativos que permite su rol. Consulta no obtiene por ser lector general acceso a eventos de seguridad, equipo o cobro.
8. **¿Qué acceso conserva el titular anterior después de una transferencia?** Recomendación: exigir selección explícita de sus roles antes de confirmar, proponiendo Consulta por defecto y sin ascenderlo automáticamente a Administrador; nuevo titular con MFA y aceptación. Transferir, retirar las facultades exclusivas anteriores e invalidar cachés de autorización en una sola operación consistente.

## Casos de prueba negativos sugeridos para USR-10

Son casos propuestos, no pruebas implementadas ni ejecutadas. Ejecutar las llamadas directas a acciones/API/servicios además de revisar la UI, con dos empresas y cada rol aislado; luego repetir con combinaciones relevantes. Para un rechazo de escritura: ningún cambio en datos de negocio, movimientos, cupos o efectos externos; puede registrarse el intento denegado sin secretos. En lectura: no devolver datos del recurso ajeno o prohibido. Un reintento idempotente autorizado puede devolver el resultado original, pero nunca repetir sus efectos; no se exige un error en ese caso. Los casos de MOD/INV/IMP/CMP se incorporan conforme existan esos pasos, manteniendo USR-10 como base de regresión.

| Caso | Intento indebido o repetido | Resultado esperado |
| --- | --- | --- |
| NEG-01 | Consulta llama directamente alta/edición/archivo/reactivación de producto, movimiento, ajuste, conteo o escritura de Compras. | Denegado por permiso aunque el botón esté oculto; stock y documentos intactos. |
| NEG-02 | Consulta sube/previsualiza/confirma una importación o envía el PDF de una orden por correo. | Denegado; lectura/exportación no se convierte en importación ni envío comercial. |
| NEG-03 | Almacén crea proveedor/orden, envía o cancela orden, recibe, devuelve o genera borradores desde mínimos. | Denegado en todas las rutas de Compras; tener entrada/salida manual no lo habilita. |
| NEG-04 | Almacén o Consulta piden costos o los intentan obtener mediante ficha, historial, órdenes, PDF, reportes o exportación. | No se devuelven costos ni datos de Compras por rutas laterales. |
| NEG-05 | Comprador crea producto, cambia factor del catálogo, registra entrada/salida manual, ajuste o aplica conteo. | Denegado; los efectos de recepción/devolución no le conceden esos permisos directos. |
| NEG-06 | Administrador contrata/cancela, cambia método de pago, plan, usuarios facturables o activa/desactiva módulos. | Denegado incluso con todos los roles combinables; ninguna solicitud de cobro ni cambio de derechos. |
| NEG-07 | Administrador altera `ownerUserId`, desactiva/degrada al titular o cambia sus roles por llamada directa/masiva. | Denegado; permanece un único titular activo y protegido. |
| NEG-08 | Administrador se asigna facultades superiores, invita a un «titular», nombra a otro administrador o se cambia roles. | Denegado conforme a la propuesta de pregunta 6; no se aceptan roles desconocidos ni titular como rol. |
| NEG-09 | Se modifica una invitación de administrador mediante reenvío/cancelación por otro administrador. | Denegado por restricción de destinatario, igual que al crearla o cambiar roles. |
| NEG-10 | Titular o cualquier rol cliente llama a aprovisionamiento interno o edita precios/vigencia/derechos efectivos. | Denegado; titular de empresa no equivale a personal de plataforma. |
| NEG-11 | Cuenta sin membresía, desactivada, con sesión revocada o MFA obligatoria incompleta usa una URL conocida. | Sin acceso operativo; la revocación no espera a que se oculte el menú. |
| NEG-12 | Usuario de A inyecta IDs de producto, proveedor, ubicación, orden, miembro, job o archivo de B. | Lectura/escritura rechazada, incluso si tiene permiso equivalente en A o membresía distinta en B. |
| NEG-13 | Se combinan roles de empresas diferentes, se envía un permiso desconocido o se confía en roles enviados por el cliente. | Denegado por contexto o por defecto; solo cuentan asignaciones vigentes del servidor en la empresa activa. |
| NEG-14 | Se reutiliza token de invitación, se acepta vencido/cancelado/con otro correo, o se acepta una elevación ya no autorizada. | No se crea membresía ni se consumen lugares adicionales; se conserva la validez de las otras invitaciones. |
| NEG-15 | Con un lugar libre se confirman dos invitaciones simultáneas; se intenta ignorar las pendientes. | Solo una reserva prospera; roles combinados no alteran el contador de personas. |
| NEG-16 | Titular o Comprador usa Compras sin contratarlo, o pretende reactivar operaciones desde una URL de historial. | Operación denegada; historial de un módulo desactivado solo se consulta/exporta según contrato y permiso. |
| NEG-17 | Titular intenta quitar Inventario con Compras activo, o contratar Ventas/CRM aún no disponibles. | Rechazo por dependencias/disponibilidad; sin cambios parciales de derechos. |
| NEG-18 | Suscripción vencida intenta crear producto, importar, recibir, devolver o enviar una orden. | Escritura operativa denegada; lectura/exportación autorizadas y datos conservados. |
| NEG-19 | Alta/reactivación/importación intenta exceder cupo, incluso concurriendo entre rutas manuales y worker. | Sin exceso de activos más reservas; no borrar productos ni cargar automáticamente. |
| NEG-20 | Un job confirmado antes de revocar permisos continúa importando o enviando órdenes; un enlace permite descargar a alguien ya desautorizado. | Revalidar y denegar lo pendiente; conservar resultado parcial explícito y liberar únicamente reservas no usadas. |
| NEG-21 | Se cambia saldo desde ficha, se ajusta sin motivo, se edita movimiento confirmado o se archiva producto/ubicación con stock u orden pendiente. | Rechazo para todos, incluido titular; historial y saldo consistentes. |
| NEG-22 | Reversa usa factor actual en lugar del histórico, duplica la corrección o intenta deshacer una recepción por Inventario. | No se altera la historia ni se separa stock de documento; usar flujo de Compras para su corrección. |
| NEG-23 | Conteo se aplica dos veces, ignora movimientos posteriores o se modifica después de aplicado. | Sin doble ajuste ni sobrescritura de operaciones concurrentes. |
| NEG-24 | Recepciones/devoluciones simultáneas o repetidas exceden orden/recepción, usan ubicación ajena o causan stock negativo. | Rechazo sin documento o movimiento parcial; idempotencia y cantidades exactas. |
| NEG-25 | PDF/reporte/exportación revela campos sin permiso o archivo de otra empresa; se intenta ampliar alcance cambiando filtros. | Denegado o campos excluidos conforme a permisos; nunca filtrar datos por descarga. |
| NEG-26 | Dos transferencias concurrentes, destinatario no miembro/inactivo o usuario que ya dejó de ser titular intenta transferir/cobrar. | Solo una transferencia válida; un titular; facultades anteriores revocadas inmediatamente y roles residuales explícitos. |

Como controles positivos de estas pruebas negativas, comprobar que Almacén + Comprador obtiene la unión prevista, Consulta + Almacén escribe por Almacén, Administrador conserva operaciones de Inventario/Compras pero nunca cobro, y una exportación permitida a Consulta funciona sin alterar datos de negocio. No confundir denegación de una acción con bloqueo completo de la cuenta.

## Aprobación

El fundador respondió las ocho preguntas y aprobó esta matriz el 2026-10-03 (FUN-07). Cambiar un permiso o un rol requiere actualizar esta tabla y el catálogo en código a la vez; la prueba `src/platform/authorization/catalog.test.ts` falla si no coinciden.
