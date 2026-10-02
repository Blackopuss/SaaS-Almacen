# Plan de implementación — SaaS de inventario modular

Versión 0.4 · 1 de octubre de 2026 · Inventario para ferreterías con capacidad por plan, módulos y presentaciones configurables; exclusivamente con internet.

## 1. Producto y alcance

La propuesta de valor inicial es: **“Pasa de tu Excel a un inventario confiable, conoce tus existencias y paga por las funciones que necesitas.”**

El mercado inicial confirmado es México y el primer segmento son las ferreterías. La expansión posterior apunta a negocios con operaciones de almacén más grandes. Entrevistar a cinco ferreterías y conseguir tres interesadas en pilotear antes de ampliar funcionalidades. La facilidad de uso y el buen UI/UX son requisitos prioritarios.

El fundador estima alrededor de 1,000 productos para la primera ferretería. El servicio deberá atender desde unos 100 productos hasta miles y limitar el catálogo según el plan contratado. Esta cifra orienta el primer caso de uso; no es una medición del mercado ni un límite técnico ya probado.

El primer lanzamiento se centra exclusivamente en control de inventario: qué hay, cuánto hay y dónde está. Alcance físico confirmado: una ferretería con zonas, pasillos y estantes. Se propone incluir catálogo, existencias por ubicación, entradas, salidas, reubicaciones, ajustes, conteos, mínimos, historial e importación/exportación. Usuarios con permisos, suscripción, seguridad y soporte son la plataforma necesaria para vender ese inventario. Varias bodegas o sucursales quedan para una expansión posterior.

SAP es la referencia confirmada por el fundador, simplificado para ferreterías. No se ha indicado una edición ni se promete equivalencia funcional: la referencia se traducirá en operaciones concretas de inventario para este segmento. El alcance inicial sigue siendo exclusivamente inventario.

Quedan para expansiones: punto de venta, compras avanzadas, lotes/caducidades, series, facturación fiscal, contabilidad, integraciones y operación sin conexión. Si alguno es indispensable para el segmento elegido, sustituirá alcance del primer lanzamiento y se reestimará; no se añadirá silenciosamente al mismo plazo.

Hipótesis para poder planear: una persona con experiencia full-stack, seis horas efectivas por jornada, interfaz en español, MXN, una moneda por empresa, sin datos personales sensibles como requisito del producto. El usuario todavía no ha confirmado estas hipótesis. México y operación exclusivamente con internet sí están confirmados; no se implementará sincronización offline en v1.

### Alcance funcional propuesto para la ferretería

| Necesidad | Comportamiento de la primera versión |
|---|---|
| Qué es | Código/SKU, nombre, descripción, categoría, marca y unidad; código de barras y atributos como medida o material cuando apliquen |
| Cuánto hay | Existencia total de un producto y desglose por ubicación; sumar únicamente cantidades del mismo producto/unidad |
| Dónde está | Zonas, pasillos y estantes nombrados por el negocio; niveles opcionales |
| Qué cambió | Entrada, salida, reubicación y ajuste con fecha, usuario y motivo |
| Cuánto hay físicamente | Conteo por producto/ubicación, diferencias y ajuste trazable |
| Qué falta | Mínimo por producto y lista de existencias bajas |
| Cómo empezar | Importar su Excel, revisar errores y confirmar saldos iniciales por ubicación |
| Cómo buscar | Nombre, SKU y código de barras; filtros por categoría, marca y ubicación |

Ejemplo de aceptación: «Tornillo hexagonal 1/4 × 1 pulgada», SKU TOR-001, unidad pieza; 120 piezas en A-01 y 80 en B-03. La ficha muestra 200 piezas. Mover 20 de A-01 a B-03 cambia el desglose a 100/100 y conserva el total. Una salida de 15 desde A-01 deja 85/100, total 185, con autor y motivo. La descripción identifica el producto; la cantidad se cambia mediante movimientos.

Tamaños/materiales que identifican productos distintos tendrán SKU propio. Una caja de piezas del mismo producto será una presentación convertible, compartiendo inventario con las piezas. El usuario confirmó unidades amplias y factores de presentación configurados por el tendero desde la primera versión.

### Unidades y presentaciones configurables — incluidas en v1

Propuesta inicial de catálogo: conteo (pieza, par, docena), masa (kg, g), longitud (m, cm, mm), volumen (L, mL) y superficie (m²). Cada producto usa una unidad base y una precisión/incremento admitidos. Las presentaciones comerciales —caja, bolsa, rollo, saco, paquete— se definen por producto y empresa; su nombre por sí solo no determina cantidad ni unidad.

| Producto | Unidad base | Presentación configurada por el tendero | Efecto de una entrada |
|---|---|---|---|
| Tornillo TOR-001 | Pieza | Caja = 100 piezas | 3 cajas agregan 300 piezas |
| Cable CAB-001 | Metro | Rollo = 100 metros | 2 rollos agregan 200 m |
| Clavo CLA-001 a granel | Kilogramo | Bolsa = 5 kg | 3 bolsas agregan 15 kg |
| Pintura PIN-001 a granel | Litro | Cubeta = 19 L | 2 cubetas agregan 38 L |

El flujo de alta pregunta: «¿En qué unidad controlas este producto?» y «¿Manejas cajas, bolsas u otras presentaciones?». Si elige caja, solicita «¿Cuántas piezas contiene esta caja?», o la unidad base que corresponda. Cada movimiento muestra su equivalencia antes de confirmar: «3 cajas × 100 = 300 piezas».

Reglas propuestas de integridad:

- Guardar un único saldo en unidad base por producto/ubicación. Cajas y piezas no son inventarios paralelos que puedan sumarse dos veces.
- Convertir en servidor: cantidad base = cantidad capturada × factor de la presentación. Resolver el factor desde una versión autorizada, no confiar en un factor enviado libremente por el navegador.
- Factores positivos, finitos y asociados a empresa/producto. Una caja de un producto puede contener 100 piezas y la de otro 24. Versionar cambios con permiso y auditoría.
- Usar aritmética decimal exacta, límites de magnitud e incremento permitido por producto. Rechazar cantidades que no se puedan representar según esa configuración; no redondear stock silenciosamente. La precisión concreta se fijará en U01 con ejemplos del piloto.
- Pieza se maneja en enteros; metros, kilos y litros pueden fraccionarse. Si una presentación solo admite paquetes enteros, ofrecer la unidad base para registrar salidas parciales.
- Conservar en cada línea cantidad/unidad capturadas, factor aplicado, versión y cantidad base. Cambiar una caja de 100 a 120 piezas afecta movimientos futuros; los anteriores mantienen su equivalencia. Reversar utiliza el valor original.
- La unidad base no se edita libremente después del primer movimiento. Cambiarla requiere una migración explícita y conciliada, fuera del flujo normal de v1.
- Conversiones físicas solo entre unidades compatibles. No inferir kilos a piezas ni litros a kilos. Para paquetes de contenido variable, capturar la cantidad base medida en cada movimiento; no fingir un factor constante.
- Cada presentación apunta directamente a la unidad base para evitar cadenas y ciclos. Un empaque realmente diferente que deba tener existencias independientes será otro SKU; transformaciones entre productos se estiman aparte.
- Mostrar equivalencias como «250 piezas, equivalentes a 2 cajas de 100 y 50 piezas». Esa equivalencia no prueba que existan dos cajas físicamente cerradas; el seguimiento de empaques sellados no forma parte del saldo inicial propuesto.
- Aplicar las mismas conversiones a entradas, salidas, reubicaciones, conteos e importaciones. Los conteos no deben sumar el mismo contenido capturado como caja y nuevamente como piezas; advertir y mostrar total normalizado antes de aplicar.

Caso obligatorio: entrar 3 cajas de 100 tornillos → 300 piezas; sacar 25 piezas → 275; cambiar la presentación a 120 piezas y entrar una caja nueva → 395. El historial de la entrada original sigue mostrando 300, y reversar la nueva entrada resta 120. Caso decimal: 2 rollos de 100 m menos 2.75 m → 197.25 m. Reintentos y reubicaciones conservan esas cantidades exactamente.

### Comportamiento al perder conexión

Mostrar aviso y dejar de confirmar movimientos mientras no haya conexión. No dar por guardada una operación sin respuesta del servidor ni ofrecer operaciones offline. Si se pierde la respuesta durante una confirmación, mostrar «Verificando estado» y consultar/reintentar con el mismo identificador idempotente al reconectar. Así se resuelve si se guardó sin duplicarla. La interfaz puede conservar temporalmente los campos del formulario, pero no promete persistencia offline ni sincronización en segundo plano.

Una instalación y sus estantes son conceptos distintos de varias sucursales. Las ubicaciones internas estarán incluidas en la base propuesta; el módulo multi-almacén posterior habilitará instalaciones adicionales.

### UX que se validará con usuarios

- Navegación principal propuesta: Inventario, Movimientos, Ubicaciones y Conteos; administración dentro de Configuración.
- Inventario como pantalla principal, con buscador visible, cantidad/unidad y ubicación legibles; detalle progresivo para atributos menos usados.
- Acciones con lenguaje cotidiano: «Agregar entrada», «Registrar salida», «Mover» y «Contar». Mostrar el efecto antes de confirmar.
- Alta rápida con nombre, código y unidad; descripción y atributos ampliables. El saldo inicial se registra como movimiento guiado.
- Ubicación «General» por defecto para empezar sin configurar pasillos; desglosarla mediante reubicaciones auditadas.
- Objetivos propuestos: al menos 4 de 5 usuarios encuentran cantidad y ubicación en 15 segundos y registran una entrada simple en 60 segundos después de una breve introducción. Medir y corregir; son objetivos, no resultados obtenidos.
- Captura manual de códigos incluida. Validar lector que escribe como teclado con el dispositivo del piloto; cámara, impresión de etiquetas y hardware especial se estiman aparte.

## 2. Stack recomendado

| Capa | Propuesta | Motivo y límite |
|---|---|---|
| Interfaz | React + Next.js + TypeScript | Libertad de composición visual y frontend/backend en un proyecto. |
| Diseño | Tailwind CSS + shadcn/ui | Componentes con código editable y sistema visual propio. No depender de una plantilla cerrada. |
| Backend | Node.js en Next.js, con servicios de dominio separados | Un solo despliegue web inicial; las reglas de inventario no viven en los componentes visuales. |
| Datos | MySQL administrado, InnoDB, versión con soporte vigente | Transacciones, índices y operación administrada. El rendimiento se medirá con cargas reales. |
| Acceso a datos | Prisma | Esquema y migraciones versionados; usar transacciones y SQL controlado cuando el bloqueo lo requiera. |
| Autenticación | Better Auth, candidato inicial | Sesiones, verificación, recuperación y MFA; evaluar actualización, operación y alternativa administrada en D08. |
| Validación | Esquemas compartidos, por ejemplo Zod | Validar siempre en servidor, aunque también se valide en pantalla. |
| Procesos en segundo plano | Worker del mismo repositorio y cola durable inicialmente en MySQL | Importaciones, correos, alertas y reconciliación; reintentos, idempotencia y registro de errores. |
| Archivos | Almacenamiento de objetos privado compatible con S3 | Aislamiento por empresa, enlaces temporales y expiración de importaciones. |
| Cobro | Stripe Billing + checkout alojado, candidato | Cobro recurrente y eventos de suscripción; verificar disponibilidad y métodos para el país elegido. |
| Calidad | Pruebas de dominio/integración y Playwright para recorridos críticos | Priorizar permisos, movimientos, importación y cobro; integración contra MySQL real de pruebas. |
| Operación | Plataforma administrada para web/worker, MySQL y respaldos | Proveedores por seleccionar según presupuesto, región y recuperación. |

MySQL guarda datos; **el backend será TypeScript/Node.js**. Su rapidez depende de índices, consultas, conexiones y transacciones. Ninguna herramienta por sí sola garantiza rendimiento o seguridad.

La documentación de [Next.js](https://nextjs.org/docs/app/getting-started/installation) contempla TypeScript y Tailwind; [shadcn/ui](https://ui.shadcn.com/docs/new) permite modificar el código de sus componentes. [Prisma](https://docs.prisma.io/docs/orm/reference/supported-databases) documenta soporte de MySQL y [Better Auth](https://better-auth.com/docs/installation) ofrece integración con bases y adaptadores. Fijar versiones compatibles al implementar; estas fuentes no equivalen a una auditoría del stack.

### Dirección visual

Estética inspirada en la claridad de Apple: tipografía legible, espacio suficiente, jerarquía marcada, colores sobrios y animación discreta. Mantener identidad y recursos propios. Las tablas necesitan densidad ajustable, búsqueda rápida y buen uso del teclado. Diseñar estados vacíos, carga, error, éxito y permisos insuficientes desde el inicio. Verificar contraste, foco visible, zoom, lector de pantalla y movimiento reducido. Priorizar tareas en computadora y consulta/operación básica en celular.

## 3. Arquitectura modular

Una aplicación compartida sirve a varias empresas, cada una con sus datos separados. Empezar con un **monolito modular**: un repositorio, módulos con límites claros, aplicación web y worker. Cada módulo tendrá servicios, validaciones, permisos, pruebas y migraciones compatibles.

```text
src/
  app/                     Rutas y pantallas
  components/              Sistema visual compartido
  platform/
    auth/                  Identidad y sesiones
    tenancy/               Empresa activa y membresías
    permissions/           Roles y permisos
    billing/               Suscripciones y derechos contratados
    audit/                 Bitácora de operaciones
    jobs/                  Cola durable y tareas
  modules/
    catalog/               Productos y unidades
    inventory/             Movimientos y saldos
    imports/               Importaciones y exportaciones
    warehouses/            Ubicaciones y traspasos
    purchasing/            Expansión posterior
    sales/                 Expansión posterior
  server/                  Infraestructura de acceso a datos
prisma/                    Esquema y migraciones
tests/                     Pruebas críticas
docs/                      Decisiones, operación y producto
```

El contrato de cada módulo define identificador, versión, dependencias, permisos, capacidades, límites y reglas de activación/cancelación. No permitir complementos con código subido por clientes en la primera versión.

Para autorizar una operación, el servidor comprueba: sesión válida → pertenencia a la empresa → permiso sobre la acción/recurso → módulo contratado → límite disponible. Ocultar un botón o menú no basta. Las tareas en segundo plano aplican las mismas reglas pertinentes y conservan el contexto de empresa.

### Modelo de datos inicial

| Área | Entidades principales |
|---|---|
| Plataforma | User, Session, Organization, Membership, Invitation, Role/Permission |
| Comercial | CapacityPlanVersion, ModuleDefinition, ModuleDependency, Subscription, SubscriptionItem, Entitlement, UsageLimit, UsageCounter, CapacityReservation, BillingEvent |
| Inventario | Product, Unit, ProductPresentation, PresentationVersion, Warehouse, Location, StockMovement, StockMovementLine, StockBalance, CountSession, Transfer |
| Operación | ImportJob, ImportRow, ExportJob, AuditEvent, BackgroundJob, OutboxEvent |
| Legal | LegalDocumentVersion, AcceptanceRecord, PrivacyRequest |

Usuarios pueden ser globales y tener membresías en varias empresas. Cada entidad de negocio incluye `organization_id`; unicidad de SKU por empresa y relaciones compuestas impiden asociar productos, ubicaciones o movimientos de empresas diferentes. Importes y cantidades usan decimales con precisión definida, no flotantes. Guardar fechas en UTC y presentar la zona del negocio.

`Warehouse` representa una instalación y `Location` una ubicación interna, con jerarquía opcional y sin ciclos. El saldo se identifica por empresa, producto y ubicación. Una ubicación pertenece a una sola instalación de la misma empresa. Los totales de producto se calculan desde sus ubicaciones; no mantener una segunda existencia editable a nivel almacén. Incluso con una sola instalación comercial, conservar esta separación para poder crecer. La reubicación exige origen/destino distintos y registra ambos lados atómicamente. Impedir archivar una ubicación con stock sin resolver.

Con MySQL compartido, el aislamiento se impondrá en la capa de acceso a datos y restricciones relacionales. Evitar consultas de negocio sin contexto de empresa; una revisión o un filtro manual aislado no es suficiente. Verificar aislamiento también en caché, archivos, búsquedas, informes, auditoría y jobs. La guía de [OWASP para aplicaciones multiempresa](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html) identifica fugas entre clientes y abuso del contexto como riesgos específicos.

### Reglas que hacen confiable al inventario

- Todo cambio de existencias produce un movimiento confirmado con usuario, motivo, fecha, origen e identificador idempotente.
- Movimiento confirmado inmutable; corregir con reversa trazable. No editar directamente el saldo desde una pantalla de producto.
- Registrar movimiento y actualizar saldo en la misma transacción. Mantener el saldo como proyección reconciliable del historial.
- Bloquear saldos afectados o usar actualización condicional atómica; reintentar deadlocks de manera acotada.
- Dos salidas simultáneas no pueden consumir la misma última unidad. Prohibir negativos por defecto; una excepción futura debe ser explícita y auditada.
- Saldo inicial e importaciones generan movimientos. Productos usados se archivan, conservando su historial.
- Conteo físico registra una referencia temporal y detecta movimientos posteriores antes de calcular el ajuste; no sobrescribe salidas o reubicaciones concurrentes.
- Primera versión con unidad base por SKU, decimales exactos según unidad y conversiones configurables incluidas. Cada movimiento conserva factor y cantidad base históricos. Lotes y series siguen como expansiones.
- Los reportes iniciales muestran cantidades. Valuación contable/FIFO/costo promedio se diseña como alcance adicional; no confundir precio de compra con valor contable.

## 4. Módulos y modelo comercial

| Oferta | Incluye | Dependencia | Momento propuesto |
|---|---|---|---|
| Inventario base, obligatorio | Catálogo, unidades/presentaciones y conversiones, una instalación con ubicaciones internas, entradas/salidas, reubicaciones, conteos, mínimos, historial, importar/exportar y permisos | Plataforma | Primer lanzamiento |
| Multi-almacén | Instalaciones adicionales, existencias por instalación y traspasos entre ellas | Base | Expansión posterior |
| Compras | Proveedores, órdenes, recepciones parciales y devoluciones | Base | Después del piloto |
| Ventas/POS | Venta, devolución, caja y ticket no fiscal | Base | Según segmento |
| Lotes y caducidades | Trazabilidad y alertas de vencimiento | Base; integración con movimientos | Según segmento |
| Series | Seguimiento individual por producto | Base | Refacciones/equipos según demanda |
| Reportes avanzados | Rotación, tendencias, valuación definida y reportes programados | Base y fuentes requeridas | Después de validar datos |
| Facturación fiscal | Integración con proveedor autorizado según jurisdicción | Datos de venta y fiscales | Proyecto posterior |
| Integraciones | API, webhooks de salida y conectores específicos | Base y módulo de origen | Según demanda |

La base incluye seguridad, MFA, respaldo, exportación y permisos esenciales. Los módulos cobran por utilidad operativa adicional. Diferenciar módulos funcionales de capacidad: usuarios, instalaciones, productos y almacenamiento pueden tener límites transparentes; no introducir cobros sorpresivos por cada movimiento. Las ubicaciones internas forman parte del inventario base propuesto. En el primer lanzamiento se vende únicamente la base de inventario; la arquitectura queda preparada para módulos posteriores sin anunciarlos como disponibles.

**Fórmula inicial:** precio del plan de capacidad elegido + módulos adicionales contratados + impuestos aplicables. Cada plan incluye el inventario base y su cupo de productos; no cobrar una segunda base por separado. No se han fijado tarifas. Preparar combinaciones recomendadas para reducir la dificultad de elegir, manteniendo la opción de personalizar.

### Planes por cantidad de productos y módulos por función

La capacidad responde a «cuántos productos puedo gestionar» y los módulos a «qué funciones adicionales necesito». Ambos ejes se combinan: una empresa podrá tener 500 productos con un módulo adicional y otra 3,000 con solo inventario base. En v1 se comercializan los niveles de capacidad con inventario base; los módulos posteriores se habilitan al estar implementados.

| Nivel propuesto | Cupo de productos activos por empresa | Caso ilustrativo |
|---|---|---|
| 100 | Hasta 100 | Inventario pequeño |
| 500 | Hasta 500 | Negocio con catálogo en crecimiento |
| 1,000 | Hasta 1,000 | Referencia inicial aportada por el fundador |
| 3,000 | Hasta 3,000 | Catálogo más amplio |
| 10,000 | Hasta 10,000 | Operación con miles de referencias |

Los umbrales son propuestas, pendientes de validar junto con el precio y el costo de soporte. No ofrecer «ilimitado» ni niveles mayores hasta probar su operación. Todos los niveles conservan las funciones de inventario base, conversiones, ubicaciones internas y seguridad. Cantidad de usuarios incluida y límites de archivos/almacenamiento siguen pendientes; no se asumen ilimitados.

**Definición propuesta de producto que consume cupo:** un registro activo de catálogo, normalmente identificado por un SKU, dentro de una empresa. Cero existencias no lo exime del cupo. No se factura cada unidad física: 5,000 tornillos del mismo SKU cuentan como un producto. Caja y pieza como presentaciones del mismo producto cuentan como uno; tenerlo en tres estantes también cuenta como uno. Tornillos de medidas diferentes con SKU independiente cuentan por separado.

Archivar un producto libera cupo únicamente cuando no tiene existencias en ninguna ubicación ni operaciones pendientes. Conserva historial y referencias; no equivale a borrarlo. Reactivarlo requiere cupo disponible. Los registros archivados siguen sujetos a la política de conservación y almacenamiento, no a borrado automático por bajar de plan. Esta definición se mostrará junto al precio antes de contratar.

### Límites y cambios de capacidad

- Mostrar «Productos activos: 84 de 100» y avisos propuestos al 80%, 90% y 100%, sin contratar nada automáticamente.
- Al llegar al límite, bloquear solo operaciones que agreguen productos activos: altas, duplicación, reactivación e importación de nuevas referencias. Mantener consulta, exportación y movimientos de productos existentes mientras la suscripción esté vigente.
- La cuota es por empresa y se comprueba en servidor, nunca solo deshabilitando un botón. Centralizar todas las rutas de alta/reactivación para que no evadan el límite.
- Actualizar contador/cupo y producto en la misma transacción con control de concurrencia. Ejemplo de prueba: con 99/100, dos altas simultáneas permiten exactamente una. Si una transacción falla no consume cupo.
- Importar distingue productos nuevos de actualizaciones de SKU existentes; repetir el mismo SKU o el mismo trabajo no consume otro cupo. Validar duplicados dentro del archivo, reactivaciones y permisos.
- Antes de importar, mostrar cupos requeridos y disponibles. Si no caben, no truncar el archivo ni aplicar parcialmente en silencio: permitir corregirlo o cambiar de plan. La vista previa no garantiza cupo hasta confirmar.
- Al confirmar una importación, reservar atómicamente los cupos nuevos requeridos. Las altas manuales consideran productos activos más reservas; cada lote convierte reserva en alta sin contar dos veces. Cancelación/fallo libera solo reservas no usadas y conserva el resultado parcial explícito. Recuperar reservas de jobs abandonados con verificación de estado y exclusión de workers, no expiración ciega.
- Ampliar capacidad conserva todos los datos, presenta precio/fecha y habilita el nuevo límite solo al confirmar el estado autorizado del proveedor. No aumentar el cargo automáticamente al rebasar el plan.
- Reducir capacidad se programa al siguiente período y requiere estar dentro del nuevo límite contando reservas. Si una solicitud ya programada queda excedida después, bloquear nuevas altas al nuevo cupo, avisar y mantener acceso a datos y operaciones existentes según la política publicada; jamás eliminar productos para ajustar el límite. Verificar cambios desde el portal de pago además de la interfaz propia.
- Versionar límites/precios contratados para que editar el catálogo comercial no cambie retroactivamente las condiciones de una suscripción. Separar impago de exceso de capacidad; tienen comportamientos diferentes.

### Rendimiento para catálogos pequeños y grandes

La misma aplicación atenderá todos los niveles. Buscar y paginar en servidor, indexar por empresa/SKU y filtros usados, cargar detalles bajo demanda y ejecutar importaciones/exportaciones voluminosas en segundo plano. Probar escenarios de 100, 1,000 y 10,000 productos con múltiples ubicaciones e historial de movimientos; el tamaño del catálogo por sí solo no representa toda la carga. Los planes son condiciones comerciales, no una demostración de rendimiento ya lograda.

Validar tres propuestas de precio con negocios reales y medir disposición a pagar, tiempo de soporte y costo de incorporación. Una prueba temporal de 14 días es una hipótesis a evaluar. La migración asistida puede ser un servicio adicional con alcance claro. No prometer módulos que todavía no existen.

Calcular costo por cliente: infraestructura asignada + almacenamiento/respaldos + correo + comisión de pago + soporte + servicios externos. Medir ingreso mensual recurrente, margen de contribución, cancelaciones y tiempo de recuperación de adquisición. Definir presupuesto también para seguridad, revisión legal, contabilidad y mantenimiento; cotizar proveedores cuando se conozcan país y volumen.

### Ciclo de suscripción

Modelar prueba, activa, pago pendiente/fallido, gracia, suspendida y cancelada. La política exacta de gracia se validará antes de vender. Altas de módulos presentan importe y fecha efectivos; bajas preferentemente al terminar el período. Dependencias y prorrateos se explican antes de confirmar.

No activar derechos por la página de “pago exitoso”. Procesar notificaciones firmadas del proveedor, deduplicarlas, tolerar desorden y reconciliar con su estado autoritativo. Aplicar los derechos contratados desde el servidor. [Stripe documenta el uso de webhooks en suscripciones](https://docs.stripe.com/billing/subscriptions/webhooks).

Al desactivar un módulo, conservar el historial y permitir consulta/exportación conforme al contrato. Bloquear nuevas operaciones del módulo. Antes de reducir ubicaciones o usuarios, resolver qué recursos quedan activos; nunca borrar excedentes automáticamente. Para multi-almacén, terminar o cancelar traspasos abiertos y resolver stock en ubicaciones a desactivar. Una cancelación de pago no es una solicitud de borrado inmediato.

## 5. Seguridad y operación desde el inicio

El objetivo es una seguridad verificable y mantenible. Adoptar una matriz de controles aplicables de [OWASP ASVS](https://owasp.org/projects/asvs), con objetivo de nivel 2 y evidencia de revisión. No presentar esa meta como certificación ni afirmar seguridad absoluta.

| Área | Requisito de la propuesta | Evidencia requerida |
|---|---|---|
| Autenticación | Biblioteca mantenida, correo verificado, recuperación con tokens de un uso y límites de intentos | Pruebas de expiración, repetición y recuperación |
| Sesiones | Cookies HttpOnly/Secure/SameSite según el flujo, expiración y revocación; protección CSRF/origen | Sesión revocada deja de servir; cambio de credenciales invalida sesiones según política |
| MFA | Disponible para todos, obligatorio para personal de plataforma y administradores de empresa | Alta, recuperación y desactivación verificadas; recuperación no elude controles |
| Autorización | Denegar por defecto; roles propietario, administrador, operador y consulta | Acceso directo a rutas y acciones no autorizadas rechazado |
| Aislamiento | Verificación de pertenencia y relaciones dentro de la empresa | Batería con dos empresas y manipulación de identificadores |
| Aplicación | Validación en servidor, consultas parametrizadas, límites de tamaño, cabeceras y CSP probada | Revisión de inyección, XSS, CSRF y exposición de errores |
| Archivos | Validar tipo/contenido, filas y tamaño; almacenamiento privado; no ejecutar macros ni fórmulas | Archivo malicioso rechazado, enlace ajeno inaccesible, exportación resistente a fórmulas |
| Abuso | Límites por IP/cuenta/empresa para login, importaciones y endpoints costosos | Carga y abuso no bloquean toda la plataforma |
| Infraestructura | TLS, DB privada, cifrado administrado en reposo y secretos separados por ambiente | Revisión de configuración y rotación practicada |
| Privilegios | Usuario de aplicación con permisos mínimos y credencial separada para migraciones | Aplicación no puede administrar usuarios ni ejecutar cambios de esquema |
| Auditoría | Operaciones sensibles, cambios de rol, stock y cobro trazables | Eventos sin contraseñas/tokens; escritura restringida y retención definida |
| Soporte | Acceso a datos por autorización, temporal y auditado | Operador de plataforma sin acceso libre permanente a inventarios |
| Entrega | Revisión de cambios, análisis de dependencias/secretos y ambientes separados | Pipeline bloquea fallas críticas y no usa datos reales en pruebas |
| Recuperación | Respaldos automáticos y recuperación a un punto en el tiempo si el proveedor la soporta | Restauración probada, tiempos y pérdida máxima medidos |
| Incidentes | Contactos, clasificación, contención, comunicaciones y registro | Simulacro con fuga de datos o credencial comprometida |

Las medidas de autenticación se revisarán contra la [guía de OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html). La biblioteca requiere configuración, actualización y pruebas propias.

Objetivos iniciales por validar con presupuesto: pérdida máxima de datos de 15 minutos (RPO) y recuperación en cuatro horas (RTO). Exigen respaldo continuo o equivalente; un respaldo diario no cumple ese RPO. No ofrecer estos tiempos contractualmente hasta demostrar recuperación. Restaurar una empresa desde una copia aislada y reconciliar sus datos sin sobrescribir las demás.

Alertas sobre errores, indisponibilidad, colas estancadas, fallas de respaldo y eventos de pago no procesados. Medir latencia y conexiones. Revisión semanal de avisos críticos, revisión mensual de accesos y restauración periódica, además de después de cambios importantes. Asignar responsable y tiempo recurrente.

## 6. Preparación legal y comercial

El mercado inicial confirmado es México. Revisar para el lanzamiento el texto vigente de la [LFPDPPP](https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf): contempla aviso de privacidad, derechos ARCO, medidas de seguridad y comunicación de determinadas vulneraciones. No usar automáticamente documentos basados en la ley anterior. El papel de responsable o encargado depende de qué datos se traten y para quién.

Preparar con revisión jurídica local:

| Entregable | Contenido a resolver |
|---|---|
| Términos y condiciones | Identidad del vendedor, alcance, propiedad de datos, uso permitido, soporte, responsabilidades y procedimiento de controversias |
| Condiciones de suscripción | Módulos, precios/impuestos, renovación, prueba, cancelación, prorrateo, impago y reembolsos |
| Aviso de privacidad | Datos y finalidades, proveedores, transferencias aplicables, contacto, derechos y conservación |
| Acuerdo de tratamiento | Instrucciones del cliente, confidencialidad, subproveedores, seguridad, incidentes y terminación |
| Política de salida | Exportación, plazo de consulta, borrado, excepciones de conservación y vencimiento de respaldos |
| Compromisos de servicio | Horario/canales de soporte y disponibilidad que realmente puede sostenerse |
| Cookies/analítica | Inventario de tecnologías y mecanismo de consentimiento si resulta exigible; separar marketing de uso del servicio |

Guardar versión del documento, fecha y usuario que aceptó, minimizando datos adicionales. Informar cambios sustanciales según la política revisada. Separar aceptación contractual, presentación del aviso y consentimientos específicos cuando correspondan.

Distinguir dos necesidades: **emitir el comprobante fiscal por la suscripción que tú vendes** y **permitir al cliente facturar sus propias ventas**. La primera debe resolverse con asesoría fiscal antes de cobrar; la segunda es un módulo independiente. Un recibo de la pasarela no debe suponerse suficiente para obligaciones fiscales locales. Este plan organiza la revisión; no constituye contratos terminados ni validación jurídica.

## 7. Plan en jornadas pequeñas

Cada fila representa una jornada objetivo de unas seis horas de trabajo efectivo, incluyendo revisión y validación del incremento. La secuencia es D01–D23 → U01–U04 → D24–D60. Se conservan los identificadores originales para no perder referencias; las cuatro jornadas U se añaden para el alcance confirmado de conversiones. Los prerrequisitos refuerzan los hitos que no pueden saltarse. Una tarea que exceda el día se divide en A/B, conservando su criterio de cierre. No sacrificar pruebas críticas para mantener una fecha.

**Estimación de referencia: 64 jornadas ≈ 13 semanas de ejecución, más 25–35% de reserva (unas 16–18 semanas laborales en total).** Son 384 horas de trabajo efectivo antes de reserva. Pilotos, agenda de usuarios, verificación de pasarela y revisión legal pueden ampliar el calendario. Con tres horas disponibles al día, cada jornada ocupará aproximadamente dos días. Se reestimará después de D06 y D22.

### Etapa A — Validar y definir, D01–D06

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D01 | Precisar perfil de ferretería, problema y resultado esperado | México y ferreterías confirmados | Una ficha de cliente ideal, tamaño operativo y cinco hipótesis comprobables |
| D02 | Entrevistas y revisión de hojas anonimizadas | D01 y disponibilidad de negocios | Cinco conversaciones documentadas o agenda pendiente explícita; problemas priorizados |
| D03 | Alcance base, niveles de capacidad y módulos | D02 | Definir producto facturable, niveles y tres propuestas de precio; distinguir cupos de unidades físicas |
| D04 | Reglas de inventario, unidades, ubicaciones y permisos | D03 | Ejemplos de presentaciones/conversiones, fracciones, cambio de factor, entradas, salidas, conteos y roles |
| D05 | Prototipo de consulta, movimiento e importación | D04 | Usuarios encuentran producto/cantidad/ubicación y registran un movimiento; tiempos y fricciones anotados |
| D06 | Mapa de datos, amenazas, obligaciones y presupuesto | D01–D05 | Decisiones iniciales documentadas y solicitudes de revisión externa preparadas |

### Etapa B — Base técnica, D07–D12

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D07 | Proyecto TypeScript, reglas de calidad y configuración local | D06 | Arranque reproducible y configuración de ejemplo sin secretos |
| D08 | Prueba técnica auth/ORM/MySQL y selección de versiones | D07 | Registro/sesión experimental y transacción funcionan con versiones compatibles |
| D09 | Esquema inicial y migraciones | D04, D08 | Dos empresas de prueba; esquema limpio reconstruible con restricciones |
| D10 | Integración continua y pruebas sobre MySQL | D09 | Build, tipos y prueba de transacción ejecutan en ambiente aislado |
| D11 | Ambiente de staging, secretos, logs y primer respaldo | D10 | Despliegue accesible por TLS, sin DB pública; respaldo verificado |
| D12 | Sistema visual y estructura de navegación | D05, D07 | Componentes base con foco/contraste y vista móvil de pantallas principales |

### Etapa C — Identidad y separación de clientes, D13–D22

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D13 | Registro y verificación de correo | D08–D11 | Usuario sin verificar no accede al negocio; correo se entrega en pruebas |
| D14 | Inicio/cierre de sesión y revocación | D13 | Cookies configuradas; logout y revocación invalidan acceso |
| D15 | Recuperación de cuenta y límites de intentos | D14 | Token expira, no se reutiliza y no revela si existe una cuenta |
| D16 | MFA y recuperación segura | D15 | Administrador completa alta de MFA y prueba un código de recuperación |
| D17 | Alta de empresa y membresía del propietario | D09, D14 | Creación atómica; acceso a empresa ajena rechazado |
| D18 | Invitaciones y baja de miembros | D17 | Invitación con caducidad/uso único; expulsión revoca acceso efectivo |
| D19 | Roles y permisos de servidor | D18 | Operador no administra usuarios ni cobro; consulta no escribe |
| D20 | Acceso a datos limitado por empresa | D17–D19 | Consultas de negocio requieren contexto validado y relaciones correctas |
| D21 | Auditoría y acceso administrativo restringido | D20 | Cambio sensible deja actor/empresa/motivo; soporte sin acceso amplio por defecto |
| D22 | Batería de aislamiento y revisión de amenazas | D13–D21 | Dos empresas no comparten datos al manipular URLs, cuerpos ni jobs disponibles |

### Etapa D — Inventario confiable, D23–D34 y U01–U04

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D23 | Catálogo, descripción, SKU, atributos y unidad base | D19–D22 | SKU único por empresa; alta/reactivación centralizadas; archivo sin stock ni pérdida de historia |
| U01 | Catálogo de unidades, dimensiones y precisión | D23 | Reglas de pieza/metro/kg/L/m² y sus límites definidas con casos; precisión rechaza pérdida silenciosa |
| U02 | Configuración de presentaciones por producto | U01 | Tendero define caja = 100 piezas; factores inválidos y productos de otra empresa rechazados |
| U03 | Servicio de conversión y vista previa | U02 | Servidor normaliza cantidades exactamente; dimensiones incompatibles y excesos rechazados |
| U04 | Versiones de factor y contrato de historial | U03 | Cambio 100 → 120 conserva cálculos previos; pruebas de conversión y datos históricos pasan |
| D24 | Búsqueda, filtros y tabla paginada | U04 | Buscar por nombre/SKU/código; filtros por categoría y marca con índices |
| D25 | Instalación, ubicación General y saldos por ubicación | U04 | Esquema preparado para ubicaciones internas; saldo inicial por movimiento en unidad base |
| D26 | Entrada y stock inicial con presentaciones | D25 | 3 cajas de 100 agregan 300 piezas; factor histórico y saldo se guardan atómicamente |
| D27 | Salidas parciales y prevención de negativos | D26 | Salidas en piezas/decimales respetan incremento; falta de stock falla sin escritura parcial |
| D28 | Ajustes y reversas con motivos | D27 | Reversa conserva equivalencia original incluso si cambió el factor de presentación |
| D29 | Idempotencia, concurrencia y conexión interrumpida | D26–D28 | Dos salidas por la última unidad: una sola prospera; perder respuesta/reintentar no duplica |
| D30 | Historial de movimientos y permisos de consulta | D29 | Filtros por fecha/producto/usuario y detalle trazable |
| D31 | Captura de conteo físico | D30 | Cajas y unidades sueltas normalizadas con vista previa; referencia temporal, permisos y estado |
| D32 | Reconciliación de conteo | D31 | Movimientos concurrentes se detectan; aplicar dos veces no duplica ajustes |
| D33 | Mínimos y panel operativo | D30 | Alertas en pantalla derivadas de saldo real y separadas por empresa |
| D34 | Reconciliación automática y revisión del motor | D23–D33, U01–U04 | Casos 300 → 275 → 395 piezas y 197.25 m pasan; saldos/historial concilian sin escritura parcial |

### Etapa E — Migración y ubicación física, D35–D42

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D35 | Worker, cola durable y archivos privados | D20, D34 | Tarea fallida reintenta con límites; archivo solo accesible por su empresa |
| D36 | Importación CSV/XLSX: lectura, mapeo y vista previa | D35 | Validar unidad/presentación, factor y separador decimal explícito; errores por celda sin modificar stock |
| D37 | Confirmación de importación y stock inicial por ubicación | D36 | Clasificar nuevos/actualizados y resultado por lote; fijar factores; reintentos no duplican stock |
| D38 | Exportación y guía de primer uso | D37 | Exportación autorizada segura; usuario termina catálogo → importación → movimiento |
| D39 | Módulos, planes de capacidad y cupos transaccionales | D19, D38 | 99/100 con dos altas permite una; importación reserva cupos; fallo libera reservas; módulos controlados en servidor |
| D40 | Zonas/estantes y consulta de existencias por ubicación | D25, D39 | Desglose suma el total; jerarquía sin ciclos; filtro por ubicación y archivo con stock bloqueado |
| D41 | Reubicación dentro de la instalación | D29, D40 | Salida y entrada atómicas; reintento no duplica ni cambia el total del producto |
| D42 | Validación de ubicaciones, conteos e importaciones | D31–D41 | Caso 120/80 → 100/100 → 85/100 pasa; conteo y reubicación concurrentes no pierden stock |

La reubicación de D41 es inmediata entre ubicaciones de la misma instalación y está incluida en la base. Varias instalaciones y sus traspasos quedan fuera de la primera versión. Despacho, stock en tránsito, recepción parcial y faltantes requieren otra expansión antes de vender logística entre sucursales.

### Etapa F — Cobro y preparación contractual, D43–D50

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D43 | Precios por capacidad y suscripción en sandbox | D03, D39 | Cada nivel incluye la base; mostrar cupo/definición, moneda e impuestos; módulos futuros sin venta pública |
| D44 | Checkout y asociación empresa-cliente de pago | D43 | Solo propietario autorizado compra; retorno de checkout no concede acceso por sí solo |
| D45 | Recepción firmada y procesamiento durable de webhooks | D35, D44 | Firma inválida rechazada; evento repetido/desordenado no altera derechos indebidamente |
| D46 | Derechos efectivos y reconciliación periódica | D39, D45 | Suscripción vigente habilita módulos; evento perdido se recupera por consulta al proveedor |
| D47 | Cambio de capacidad, cancelación y módulos futuros | D42, D46 | Ampliación confirmada, reducción excedida sin borrado, fecha/precio visibles; dependencias probadas |
| D48 | Pago fallido, gracia y recuperación | D47 | Simulación recorre fallo → gracia → restricción → recuperación sin perder datos |
| D49 | Publicación de documentos revisados y aceptación versionada | D06, D47 y revisión legal | Términos/privacidad accesibles; cambios y aceptación trazables |
| D50 | Solicitudes de privacidad, salida y comprobación fiscal | D38, D49 | Exportación/borrado autorizado con retención definida; circuito fiscal de la suscripción resuelto |

La elaboración/revisión jurídica se inicia en D06 y avanza durante el desarrollo. D49 es una jornada de integración, no la promesa de terminar una revisión legal en un día. Verificar cuenta de cobro y requisitos fiscales antes de esta etapa.

### Etapa G — Validación y lanzamiento, D51–D60

| Día | Incremento | Prerrequisito | Criterio de cierre |
|---|---|---|---|
| D51 | Recorridos completos de regresión | D13–D50 | Registro, importación, movimientos, permisos, módulos y cancelación pasan end-to-end |
| D52 | Revisión de seguridad de la versión candidata | D51 | Matriz ASVS actualizada; sin hallazgos críticos/altos abiertos para lanzamiento |
| D53 | Carga, índices y límites por empresa | D51 | Escenarios de 100/1,000/10,000 SKU con ubicaciones/historial; objetivo p95 < 500 ms en lecturas comunes y 20 usuarios concurrentes, en entorno documentado |
| D54 | Accesibilidad, móvil y pulido de errores | D51 | Recorridos principales con teclado y pantalla pequeña; mensajes de error accionables |
| D55 | Restauración, rollback y simulacro de incidente | D11, D35, D52 | Restaurar y medir RPO/RTO; despliegue anterior recuperable sin migración destructiva |
| D56 | Landing, demo, precios y ayuda | D03, D48–D50 | Oferta coincide con funciones disponibles; contacto y cancelación fáciles de encontrar |
| D57 | Incorporar 3–5 pilotos y conciliar sus importaciones | D51–D56 | Totales comparados con origen y validación de cada negocio; continuar si requiere más jornadas |
| D58 | Primer ciclo de observación y correcciones | D57 | Fricciones registradas y fallos prioritarios corregidos; repetir ciclos según evidencia |
| D59 | Revisión final operativa, comercial y de cobro | D58 y período piloto suficiente | Responsable de soporte, alertas, contratos y cobro real controlado verificados |
| D60 | Lanzamiento limitado y seguimiento | Todos los criterios de salida | Cohorte pequeña habilitada; monitoreo activo y siguiente iteración priorizada |

El piloto debe abarcar al menos 1–2 semanas de uso operativo, ampliables según riesgo y hallazgos. D57–D59 representan trabajo del equipo; no comprimen ese período en tres días. La revisión independiente de seguridad se agenda con anticipación y puede exigir más jornadas de corrección. Un hito fallido bloquea el lanzamiento, no se marca como terminado por calendario.

## 8. Expansiones después del lanzamiento

Cada secuencia enumera incrementos objetivo de un día; se reestima con reglas y ejemplos del negocio. Se implementan según demanda demostrada, no todas a la vez.

| Módulo | Incrementos diarios propuestos | Dependencias y criterio final |
|---|---|---|
| Multi-almacén, 6 jornadas | M01 alcance/límites; M02 instalaciones; M03 permisos/filtros; M04 traspaso directo; M05 activación/baja; M06 pruebas | Base estable; sin stock duplicado entre instalaciones y baja sin pérdida de historial |
| Compras, 6 jornadas | C01 proveedores; C02 órdenes; C03 recepción parcial; C04 devolución; C05 permisos y enlace de stock; C06 pruebas/ayuda | Base estable; recibir/reintentar/devolver concilia exactamente con inventario |
| Ventas básicas, 7 jornadas | V01 cliente opcional/carrito; V02 confirmar venta; V03 salida idempotente; V04 descuentos/permisos; V05 devoluciones; V06 ticket; V07 revisión | Base estable; sin caja fiscal, offline ni crédito hasta definirlos |
| Caja/POS, 6 jornadas adicionales | P01 apertura; P02 ingresos/egresos; P03 cierre; P04 diferencias; P05 lector/impresión; P06 validación con hardware real | Ventas; arqueo y devoluciones conciliados; pagos con tarjeta requieren integración adicional |
| Lotes/caducidad, 6 jornadas | L01 modelo; L02 recepción; L03 selección de lote; L04 alertas; L05 trazabilidad/reversas; L06 migración/pruebas | Actualiza motor/importación/conteo/traspaso; ningún stock queda sin clasificación exigida |
| Números de serie, 5 jornadas | S01 modelo; S02 alta; S03 movimientos; S04 devoluciones; S05 migración/pruebas | Una serie no puede existir simultáneamente en dos ubicaciones |
| Traspaso en tránsito, 5 jornadas | T01 estados; T02 despacho; T03 recepción parcial; T04 faltantes/devolución; T05 concurrencia | Multi-almacén; stock de origen, tránsito y destino siempre conciliado |
| Reportes avanzados, 5 jornadas | R01 definiciones; R02 consultas; R03 filtros; R04 exportación programada; R05 validación | Datos de módulos requeridos; resultados reproducibles. Valuación contable se estima aparte |
| Facturación fiscal | F01 requisitos y proveedor; después plan específico | País confirmado, asesoría fiscal y sandbox. No estimar timbrado/cancelación como un solo día |
| API/integraciones | I01 contrato y primer conector; después entregas por integración | Claves con alcance, cuotas, rotación, firmas, reintentos y aislamiento |
| Sin conexión | O01 investigación de conflictos; después plan específico | Replantea almacenamiento local, sincronización y stock concurrente; no basta instalar una PWA |

Cada expansión también actualiza precio, permisos, derechos contratados, documentación, pruebas de aislamiento, política de baja y soporte. No venderla hasta verificar el recorrido completo.

## 9. Criterios para considerar la primera versión vendible

- Tres ferreterías completan importación y operaciones principales; sus saldos por producto/ubicación cuadran con los ejemplos conciliados.
- Las pruebas de usabilidad miden encontrar producto, cantidad y ubicación, además de registrar movimientos; las fricciones principales se corrigen antes del lanzamiento.
- Pruebas automatizadas de aislamiento, permisos, concurrencia e idempotencia aprobadas.
- Conversiones de presentaciones, precisión decimal, cambio de factor, reversas e importaciones verificadas. Pérdida de conexión durante confirmación no produce falsa confirmación ni duplicados.
- Restauración practicada; pérdida máxima y tiempo de recuperación medidos y compatibles con lo ofrecido.
- Cobro, cambio de módulo, impago, cancelación y recuperación verificados con escenarios reales controlados/sandbox pertinentes.
- Alta concurrente, importación, actualización, archivo y reactivación respetan cupos por empresa; ampliar/reducir plan conserva historial y ninguna operación genera cargos automáticos por excedente.
- Términos y privacidad revisados para el mercado elegido; aceptación versionada y procedimiento de salida operativo.
- Obligaciones fiscales de tu suscripción resueltas; soporte, monitoreo y respuesta a incidentes tienen responsable.
- Riesgos críticos/altos corregidos; evidencia de revisión y política de actualizaciones disponible.
- Costos y horas de soporte permiten un margen viable al precio validado; funcionalidades ofrecidas coinciden con las implementadas.

## 10. Forma de ejecutar cada jornada

Antes: confirmar objetivo, dependencias y ejemplo de aceptación. Durante: implementar el menor incremento completo y verificar los riesgos que cambia. Al cerrar: dejar evidencia, anotar pendientes, actualizar esta planificación y `MEMORY.md`, y elegir el siguiente paso. Una pantalla terminada sin reglas, permisos o persistencia no completa un incremento de negocio.

Registrar para cada día: pendiente/en curso/verificado, archivos afectados, prueba o demostración, bloqueo y siguiente paso. Todas las jornadas D01–D60 y U01–U04 están pendientes a la fecha de esta versión.

Confirmados: México, ferreterías, facilidad de uso, SAP como referencia, inventario de una instalación con zonas/pasillos/estantes, unidades amplias con presentaciones configurables y operación con internet. El fundador estima 1,000 productos para el primer cliente y confirma capacidad por plan, desde unos 100 hasta miles. Pendientes prioritarios: niveles/precios definitivos, usuarios/movimientos diarios, equipo/experiencia/horas y presupuesto. Segunda ronda: precisión/presentaciones, atributos/variantes/lotes, dispositivos, roles, Excel, pilotos y soporte. Facturar ventas del cliente queda para después; resolver el circuito fiscal de nuestras suscripciones antes de cobrar.

## 11. Historial de cambios

- v0.1: propuesta general para pymes, con multi-almacén como primera extensión implementada.
- v0.2: México y ferreterías confirmados; alcance inicial exclusivamente inventario de una instalación. Se concreta producto/cantidad/descripción/ubicación, se añaden criterios de UX y se destinan D40–D42 a ubicaciones internas. Multi-almacén entre instalaciones pasa a expansión posterior. Se conservan 60 jornadas como estimación inicial sujeta a unidades y volumen.
- v0.3: unidades amplias, factores por presentación configurados por el tendero y operación con internet confirmados. Se define unidad base, precisión, historial de factores y recuperación de confirmaciones interrumpidas. Se agregan U01–U04 después de D23: estimación base de 64 jornadas.
- v0.4: capacidad de productos por plan confirmada y referencia de 1,000 productos para el primer cliente. Se proponen niveles 100/500/1,000/3,000/10,000, definición de cupos, cambios de capacidad sin pérdida de datos y validación concurrente/importaciones. Se precisan las jornadas existentes de límites/cobro/carga y se mantienen 64 como estimación, a revalidar en D06.
