# Plan de implementación — SaaS de inventario modular

Versión 0.6 · 2 de octubre de 2026 · Modelo modular acordado: Inventario como base por capacidad, Compras en el primer lanzamiento, después Ventas (punto de venta, cotizaciones) y CRM; varios usuarios con roles. Plan revisado en conjunto por Claude y Codex en 224 pasos de unas 3 horas.

Ejecución de la primera fase: [definición, reglas, investigación y riesgos](FASE_01_DEFINICION.md). Prototipo navegable: [instrucciones y validación](../prototype/README.md). Entregables internos preparados; entrevistas, validación con ferreterías y decisiones comerciales siguen pendientes.

## 1. Producto y alcance

La propuesta de valor inicial es: **“Pasa de tu Excel a un inventario confiable, conoce tus existencias y paga por las funciones que necesitas.”**

El mercado inicial confirmado es México y el primer segmento son las ferreterías. La expansión posterior apunta a negocios con operaciones de almacén más grandes. Entrevistar a cinco ferreterías y conseguir tres interesadas en pilotear antes de ampliar funcionalidades. La facilidad de uso y el buen UI/UX son requisitos prioritarios.

El fundador estima alrededor de 1,000 productos para la primera ferretería. El servicio deberá atender desde unos 100 productos hasta miles y limitar el catálogo según el plan contratado. Esta cifra orienta el primer caso de uso; no es una medición del mercado ni un límite técnico ya probado.

El primer lanzamiento vende **Inventario + Compras**: qué hay, cuánto hay, dónde está y cómo se repone. Después siguen Ventas (punto de venta primero, luego cotizaciones y pedidos) y CRM, cada uno contratable por separado sobre la base de Inventario (sección 4). Alcance físico confirmado: una ferretería con zonas, pasillos y estantes. Se propone incluir catálogo, existencias por ubicación, entradas, salidas, reubicaciones, ajustes, conteos, mínimos, historial e importación/exportación. Usuarios con roles, suscripción, seguridad y soporte forman la plataforma necesaria para venderlo. Mientras no exista Ventas, una **salida rápida** de varias líneas y la importación de salidas diarias evitan que el inventario se desactualice. Varias bodegas o sucursales quedan para una expansión posterior.

El 2026-10-02 el fundador cambió la decisión de un solo tipo de usuario: ahora habrá **varios usuarios con roles predefinidos y combinables** (sección 4). Cada plan incluye un número de usuarios y se pueden agregar más. La autorización se sigue validando en el servidor por empresa, rol, módulo contratado y cupo.

SAP es la referencia confirmada por el fundador, simplificado para ferreterías. No se ha indicado una edición ni se promete equivalencia funcional: la referencia se traducirá en operaciones concretas de inventario para este segmento. El alcance inicial sigue siendo exclusivamente inventario.

Quedan para fases posteriores al lanzamiento: Ventas (punto de venta, cotizaciones y pedidos) y CRM. Quedan para expansiones por demanda: lotes/caducidades, series, facturación fiscal, contabilidad, integraciones y operación sin conexión. Si alguno es indispensable para el segmento elegido, sustituirá alcance del primer lanzamiento y se reestimará; no se añadirá silenciosamente al mismo plazo.

Hipótesis para poder planear: una persona con experiencia full-stack, seis horas efectivas por jornada, interfaz en español, MXN, una moneda por empresa, sin datos personales sensibles como requisito del producto. El usuario todavía no ha confirmado estas hipótesis. México y operación exclusivamente con internet sí están confirmados; no se implementará sincronización offline en v1.

### Alcance funcional propuesto para la ferretería

| Necesidad | Comportamiento de la primera versión |
| --- | --- |
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
| --- | --- | --- | --- |
| Tornillo TOR-001 | Pieza | Caja = 100 piezas | 3 cajas agregan 300 piezas |
| Cable CAB-001 | Metro | Rollo = 100 metros | 2 rollos agregan 200 m |
| Clavo CLA-001 a granel | Kilogramo | Bolsa = 5 kg | 3 bolsas agregan 15 kg |
| Pintura PIN-001 a granel | Litro | Cubeta = 19 L | 2 cubetas agregan 38 L |

El flujo de alta pregunta: «¿En qué unidad controlas este producto?» y «¿Manejas cajas, bolsas u otras presentaciones?». Si elige caja, solicita «¿Cuántas piezas contiene esta caja?», o la unidad base que corresponda. Cada movimiento muestra su equivalencia antes de confirmar: «3 cajas × 100 = 300 piezas».

Reglas propuestas de integridad:

- Guardar un único saldo en unidad base por producto/ubicación. Cajas y piezas no son inventarios paralelos que puedan sumarse dos veces.
- Convertir en servidor: cantidad base = cantidad capturada × factor de la presentación. Resolver el factor desde una versión autorizada, no confiar en un factor enviado libremente por el navegador.
- Factores positivos, finitos y asociados a empresa/producto. Una caja de un producto puede contener 100 piezas y la de otro 24. Versionar cambios con permiso y auditoría.
- Usar aritmética decimal exacta, límites de magnitud e incremento permitido por producto. Rechazar cantidades que no se puedan representar según esa configuración; no redondear stock silenciosamente. La precisión concreta se fijará en INV-06 con ejemplos de las entrevistas y del piloto.
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
| --- | --- | --- |
| Interfaz | React + Next.js + TypeScript | Libertad de composición visual y frontend/backend en un proyecto. |
| Diseño | Tailwind CSS + shadcn/ui | Componentes con código editable y sistema visual propio. No depender de una plantilla cerrada. |
| Backend | Node.js en Next.js, con servicios de dominio separados | Un solo despliegue web inicial; las reglas de inventario no viven en los componentes visuales. |
| Datos | MySQL administrado, InnoDB, versión con soporte vigente | Transacciones, índices y operación administrada. El rendimiento se medirá con cargas reales. |
| Acceso a datos | Prisma | Esquema y migraciones versionados; usar transacciones y SQL controlado cuando el bloqueo lo requiera. |
| Autenticación | Better Auth, candidato inicial | Sesiones, verificación, recuperación y MFA; evaluar actualización, operación y alternativa administrada en BAS-04. |
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
    authorization/         Roles predefinidos y permisos declarados por módulo
    contacts/              Clientes y proveedores compartidos por Compras, Ventas y CRM
    catalog/               Productos (cupo compartido por todos los módulos)
    billing/               Suscripciones y derechos contratados
    audit/                 Bitácora de operaciones
    jobs/                  Cola durable y tareas
  modules/
    units/                 Unidades y presentaciones
    inventory/             Movimientos y saldos
    imports/               Importaciones y exportaciones
    warehouses/            Ubicaciones y traspasos
    purchasing/            Compras (primer lanzamiento)
    sales/                 Punto de venta, cotizaciones y pedidos
    crm/                   Oportunidades y actividades
  server/                  Infraestructura de acceso a datos
prisma/                    Esquema y migraciones
tests/                     Pruebas críticas
docs/                      Decisiones, operación y producto
```

El contrato de cada módulo define identificador, versión, dependencias, permisos, capacidades, límites y reglas de activación/cancelación. No permitir complementos con código subido por clientes en la primera versión.

Para autorizar una operación, el servidor comprueba: sesión válida → pertenencia a la empresa → permiso del rol sobre la acción/recurso → módulo contratado y vigente → límite disponible. Ocultar un botón o menú no basta. Las tareas en segundo plano aplican las mismas reglas pertinentes y conservan el contexto de empresa.

### Modelo de datos inicial

| Área | Entidades principales |
| --- | --- |
| Plataforma | User, Session, Organization, Membership, MembershipRole, Invitation, Contact (roles predefinidos; sin roles personalizables en el lanzamiento) |
| Comercial | CapacityPlanVersion, ModuleDefinition, ModuleDependency, Subscription, SubscriptionItem, Entitlement, UsageLimit, UsageCounter, CapacityReservation, BillingEvent |
| Compras | PurchaseOrder, PurchaseOrderLine, Receipt, ReceiptLine, SupplierReturn, ProductSupplier |
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

Modelo acordado con el fundador el 2026-10-02 y revisado en conjunto por Claude y Codex. **Inventario es siempre la base obligatoria**. Cada empresa elige un nivel de capacidad (productos activos) y suma los módulos que necesite. El precio de cada módulo escala con el nivel de capacidad. Los precios siguientes son hipótesis para validar en entrevistas (FUN-06), no tarifas publicadas.

### Catálogo de módulos

| Módulo | Incluye | Depende de | Momento |
| --- | --- | --- | --- |
| **Inventario (base, obligatorio)** | Catálogo, unidades/presentaciones, ubicaciones internas, entradas, salidas y salida rápida, reubicaciones, ajustes, conteos, mínimos, historial, importar/exportar, reportes operativos básicos | Plataforma | Primer lanzamiento |
| **Compras** | Proveedores, órdenes de compra, recepciones parciales que generan entradas, devoluciones a proveedor, sugerencia desde mínimos | Inventario, Contactos | Primer lanzamiento |
| **Ventas — Punto de venta** | Mostrador con lector, carrito, cobro (efectivo, tarjeta con terminal externa, transferencia), ticket no fiscal, caja (apertura, corte, diferencias), devoluciones | Inventario, Contactos | Después del lanzamiento |
| **Ventas — Cotizaciones y pedidos** | Cotizaciones, pedidos, surtido parcial y cobro en POS. Se incluye en el mismo módulo de Ventas | Ventas (dominio compartido, sin depender de la caja) | Después de POS |
| **CRM** | Prospectos, oportunidades, embudo, actividades, recordatorios e historial del cliente; se enlaza con Ventas si está contratado | Contactos (no requiere Ventas) | Después de Ventas |
| Multi-sucursal | Instalaciones adicionales y traspasos | Inventario | Por demanda |
| Lotes/caducidad · Series | Trazabilidad | Inventario | Por demanda |
| Reportes avanzados | Rotación, tendencias, valuación definida | Módulos fuente | Por demanda |
| Facturación CFDI de ventas del cliente | Timbrado con PAC; los timbres se cobran como consumo | Ventas | Proyecto aparte |
| API / integraciones | Claves con alcance, webhooks, conectores | Según origen | Por demanda |

**Catálogo de productos y Contactos (clientes/proveedores) pertenecen al núcleo**, no a un módulo: Compras, Ventas y CRM los comparten sin duplicarlos. Ningún módulo lee las tablas de otro; usa sus servicios. Las operaciones que mueven stock (recepción de compra, venta) se confirman en la **misma transacción** que el movimiento de inventario. Los eventos se usan solo para tareas posteriores, como notificaciones o reportes.

Lo que **no** se cobra aparte: conversiones, historial, exportación, seguridad, respaldos, ubicaciones internas, movimientos o documentos (ventas, compras y cotizaciones no tienen cargo por operación). Los límites comerciales son productos activos y usuarios; más adelante también contactos CRM y sucursales.

### Precios hipotéticos por nivel (MXN/mes, antes de IVA)

| Productos activos | Usuarios incluidos | Inventario (base) | + Compras | + Ventas | + CRM |
| --- | ---: | ---: | ---: | ---: | ---: |
| 100 | 2 | 149 | 79 | 89 | 59 |
| 500 | 3 | 249 | 119 | 149 | 99 |
| 1,000 | 5 | 349 | 179 | 209 | 139 |
| 3,000 | 8 | 599 | 299 | 359 | 239 |
| 10,000 | 15 | 999 | 499 | 599 | 399 |

- **Usuario adicional:** 49/mes, sin descuento. Un usuario con varios roles ocupa un solo lugar. Las invitaciones pendientes cuentan como usuarios.
- **Paquetes (15% de descuento, redondeado al peso; la misma regla se aplica al facturar):** *Ferretería* = Inventario + Compras + Ventas; *Crecimiento* = Ferretería + CRM. En el nivel 1,000: Ferretería 626 y Crecimiento 745.
- **Ejemplo del fundador:** tienda con 500 productos + Ventas + CRM = 249 + 149 + 99 = **497/mes**.
- **Primer lanzamiento (nivel 1,000):** Inventario + Compras = **528/mes**.
- Los porcentajes (40–60% del precio base) orientan el cálculo, pero no son una fórmula: cada módulo debe justificar su precio frente a alternativas con POS e inventario incluidos en México. Validar el costo total para el cliente, no solo la base.
- Subir de nivel encarece todos los módulos contratados: mostrar el total nuevo antes de confirmar.
- Publicar únicamente los módulos y paquetes que ya existen. Los niveles 3,000 y 10,000 se publican hasta que su rendimiento esté probado (PIL-06).

### Usuarios y roles

El fundador cambió la decisión anterior: ahora habrá **varios usuarios con roles predefinidos**. Se pueden combinar roles; los roles personalizables quedan para después.

| Rol | Puede | Disponible desde |
| --- | --- | --- |
| Titular | Todo, además de contratar, cancelar, cambiar el método de pago y transferir la titularidad. Uno por empresa | Lanzamiento |
| Administrador | Operar todos los módulos contratados, administrar usuarios y configuración. Sin acciones de cobro | Lanzamiento |
| Almacén | Catálogo, movimientos, conteos y ubicaciones | Lanzamiento |
| Comprador | Proveedores, órdenes y recepciones; consultar inventario | Lanzamiento |
| Consulta | Solo lectura | Lanzamiento |
| Cajero | Punto de venta y su caja | Con Ventas |
| Vendedor | Cotizaciones, pedidos y CRM propio | Con Ventas/CRM |

Cada módulo declara sus permisos en su contrato. Un rol solo otorga permisos de módulos contratados y vigentes.

### Cobro de suscripciones

- **Pilotos con cobro asistido:** transferencia SPEI registrada en una consola interna, vigencia y derechos asignados manualmente con auditoría, y CFDI emitido mediante contador o servicio de facturación. Esto permite cobrar antes de automatizar la facturación.
- **Pasarela por decidir en BIL-01**, con criterios medidos y no por la marca: suscripción con conceptos variables (nivel + módulos + usuarios), prorrateo, métodos de pago locales, comisiones, webhooks y conciliación. Candidatas: Stripe Billing, Conekta y Mercado Pago. Detrás de un adaptador pequeño.
- **Automatizar** cuando la carga administrativa o los impagos lo justifiquen. Unos diez clientes es una referencia, no un umbral técnico.
- El **CFDI de nuestra suscripción** se resuelve antes del primer cobro (PIL-10). Es independiente del módulo futuro para facturar las ventas del cliente.

### Planes por cantidad de productos

La capacidad responde a «cuántos productos puedo gestionar» y los módulos a «qué funciones necesito». El cupo de productos es único por empresa y lo comparten todos los módulos.

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
| --- | --- | --- |
| Autenticación | Biblioteca mantenida, correo verificado, recuperación con tokens de un uso y límites de intentos | Pruebas de expiración, repetición y recuperación |
| Sesiones | Cookies HttpOnly/Secure/SameSite según el flujo, expiración y revocación; protección CSRF/origen | Sesión revocada deja de servir; cambio de credenciales invalida sesiones según política |
| MFA | Disponible para todos, obligatorio para personal de plataforma y administradores de empresa | Alta, recuperación y desactivación verificadas; recuperación no elude controles |
| Autorización | Roles predefinidos por módulo; denegar por defecto, sin sesión válida, sin pertenencia o sin módulo contratado | Rutas/acciones de otra empresa rechazadas aunque se conozca el identificador |
| Aislamiento | Verificación de pertenencia y relaciones dentro de la empresa | Batería con dos empresas y manipulación de identificadores |
| Aplicación | Validación en servidor, consultas parametrizadas, límites de tamaño, cabeceras y CSP probada | Revisión de inyección, XSS, CSRF y exposición de errores |
| Archivos | Validar tipo/contenido, filas y tamaño; almacenamiento privado; no ejecutar macros ni fórmulas | Archivo malicioso rechazado, enlace ajeno inaccesible, exportación resistente a fórmulas |
| Abuso | Límites por IP/cuenta/empresa para login, importaciones y endpoints costosos | Carga y abuso no bloquean toda la plataforma |
| Infraestructura | TLS, DB privada, cifrado administrado en reposo y secretos separados por ambiente | Revisión de configuración y rotación practicada |
| Privilegios | Usuario de aplicación con permisos mínimos y credencial separada para migraciones | Aplicación no puede administrar usuarios ni ejecutar cambios de esquema |
| Auditoría | Operaciones sensibles, cambios de cuenta, stock y cobro trazables | Eventos sin contraseñas/tokens; escritura restringida y retención definida |
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
| --- | --- |
| Términos y condiciones | Identidad del vendedor, alcance, propiedad de datos, uso permitido, soporte, responsabilidades y procedimiento de controversias |
| Condiciones de suscripción | Módulos, precios/impuestos, renovación, prueba, cancelación, prorrateo, impago y reembolsos |
| Aviso de privacidad | Datos y finalidades, proveedores, transferencias aplicables, contacto, derechos y conservación |
| Acuerdo de tratamiento | Instrucciones del cliente, confidencialidad, subproveedores, seguridad, incidentes y terminación |
| Política de salida | Exportación, plazo de consulta, borrado, excepciones de conservación y vencimiento de respaldos |
| Compromisos de servicio | Horario/canales de soporte y disponibilidad que realmente puede sostenerse |
| Cookies/analítica | Inventario de tecnologías y mecanismo de consentimiento si resulta exigible; separar marketing de uso del servicio |

Guardar versión del documento, fecha y usuario que aceptó, minimizando datos adicionales. Informar cambios sustanciales según la política revisada. Separar aceptación contractual, presentación del aviso y consentimientos específicos cuando correspondan.

Distinguir dos necesidades: **emitir el comprobante fiscal por la suscripción que tú vendes** y **permitir al cliente facturar sus propias ventas**. La primera debe resolverse con asesoría fiscal antes de cobrar; la segunda es un módulo independiente. Un recibo de la pasarela no debe suponerse suficiente para obligaciones fiscales locales. Este plan organiza la revisión; no constituye contratos terminados ni validación jurídica.

## 7. Plan en pasos pequeños

**Tamaño de paso:** unas 3 horas efectivas, incluida su prueba. El equipo es el fundador apoyado por IA (Claude y Codex), a medio tiempo, así que se avanza aproximadamente **un paso por día**. Si un paso excede ese tiempo, se divide en A/B y se conserva su criterio de cierre. Un paso solo se cierra con evidencia: una prueba que pasa, una demostración o un documento revisado. Una pantalla sin reglas, permisos o persistencia no cuenta como terminada.

**Orden:** FUN → BAS → PLT → USR → MOD → INV → IMP → CMP → PIL → BIL → VEN → COT → CRM. Los prerrequisitos indican lo que no puede saltarse. Dentro de una fase, los pasos van en orden salvo indicación.

| Fase | Pasos | Resultado |
| --- | ---: | --- |
| FUN — Validación comercial | 8 | Entrevistas, precios y roles validados |
| BAS — Fundación técnica | 13 | Proyecto, CI, staging y sistema visual |
| PLT — Identidad y aislamiento | 17 | Cuentas seguras y empresas separadas |
| USR — Usuarios y roles | 12 | Invitaciones, cupo de usuarios y permisos |
| MOD — Módulos y derechos | 11 | Contratos de módulo, planes y aprovisionamiento manual |
| INV — Inventario | 36 | Motor de inventario confiable con conversiones |
| IMP — Migración | 13 | Importación desde Excel y salidas importadas |
| CMP — Compras | 19 | Órdenes y recepciones conectadas a inventario |
| PIL — Piloto y lanzamiento limitado | 19 | Primeros clientes pagando; lanzamiento limitado con cobro asistido |
| BIL — Cobro automático y apertura | 18 | Contratación y pago en línea sin intervención manual |
| VEN — Ventas: punto de venta | 28 | Mostrador y caja |
| COT — Ventas: cotizaciones y pedidos | 12 | Cotizar, pedir y surtir |
| CRM | 18 | Seguimiento comercial |
| **Total** | **224** | |

**Estimación:** 148 pasos hasta el lanzamiento limitado de Inventario + Compras (PIL-17), es decir, unas 440 horas o unos 7 meses a medio tiempo. Agregar 25–35% de reserva y 1–2 semanas de observación por piloto. El primer piloto empieza en PIL-13, alrededor del paso 143. BIL agrega 18 pasos y puede hacerse antes o en paralelo con Ventas, según la carga de cobro manual. Ventas, Cotizaciones y CRM suman 58 pasos más. Es una referencia para reestimar al cerrar cada fase, no una promesa de fecha.

**Hitos visibles:** demo interna de inventario al terminar INV-27; demo con un Excel real al terminar IMP-12; demo de compra → recepción → stock al terminar CMP-09; primer cobro en PIL-16; lanzamiento limitado en PIL-17; contratación en línea en BIL-16.

### FUN — Validación comercial (8)

D01–D06 dejaron preparados (sin validación externa) los documentos de [fase 1](FASE_01_DEFINICION.md) y el [prototipo](../prototype/README.md). Esta fase los completa con el nuevo alcance modular.

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| FUN-01 | Actualizar ficha de cliente e hipótesis con Compras, salidas diarias, roles y módulos | Entregables internos de D01–D06 | Hipótesis nuevas medibles: frecuencia de compras, cómo registran salidas y quién opera |
| FUN-02 | Ampliar el cuestionario: compras a proveedor, salidas/ventas diarias, usuarios, métodos de pago y CFDI | FUN-01 | Preguntas añadidas sin orientar hacia el prototipo |
| FUN-03 | Conseguir y agendar cinco entrevistas (2 pequeñas, 2 cerca de 1,000 SKU, 1 grande) | FUN-02 | Cinco citas o lista explícita de faltantes |
| FUN-04 | Entrevistas 1–2 y prueba del prototipo | FUN-03 | Notas, tiempos de tareas y hojas anonimizadas registradas |
| FUN-05 | Entrevistas 3–5 y síntesis | FUN-04 | Problemas priorizados; hipótesis aceptadas o rechazadas con evidencia |
| FUN-06 | Probar la tabla de precios, los paquetes y la definición de cupo | FUN-05 | Disposición a pagar y objeciones por nivel; precios ajustados |
| FUN-07 | Matriz de roles × permisos para Inventario y Compras | FUN-05 | Tabla aprobada por el fundador; titular separado de administrador |
| FUN-08 | Cierre de alcance: reglas de compras con ejemplos, salida rápida y lista de 3 pilotos | FUN-06, FUN-07 | Casos de aceptación de compras escritos; pilotos con nombre de quien decide; plan reestimado |

### BAS — Fundación técnica (13)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| BAS-01 | Proyecto Next.js + TypeScript estricto, lint y formato | FUN-08 | `dev`, `build` y `lint` funcionan desde un clon limpio |
| BAS-02 | Estructura `platform/`, `modules/` y regla de límites entre módulos | BAS-01 | Un módulo que importe internals de otro falla en lint |
| BAS-03 | MySQL local con Docker y Prisma conectado | BAS-01 | Migración vacía aplicada y revertible localmente |
| BAS-04 | Prueba técnica de Better Auth + Prisma + MySQL | BAS-03 | Registro y sesión experimentales funcionan; alternativa anotada |
| BAS-05 | Fijar versiones y registrar decisiones (ADR) | BAS-04 | Versiones fijadas; ADR de stack, auth y ORM en `docs/` |
| BAS-06 | Utilidades base: decimal exacto, identificadores, errores de dominio y fechas UTC | BAS-02 | Pruebas de decimal (0.1 + 0.2, 197.25) pasan |
| BAS-07 | Pruebas con Vitest y base MySQL aislada por ejecución | BAS-03 | Prueba de transacción con rollback pasa |
| BAS-08 | CI: build, tipos, lint y pruebas con MySQL | BAS-07 | Un PR con prueba rota queda bloqueado |
| BAS-09 | Staging: elegir proveedor y desplegar con TLS | BAS-08 | URL de staging con HTTPS desplegada desde CI |
| BAS-10 | MySQL administrado en staging, red privada y secretos por ambiente | BAS-09 | DB sin acceso público; ningún secreto en el repositorio |
| BAS-11 | Logs estructurados, captura de errores y primer respaldo verificado | BAS-10 | Error de prueba visible en el monitor; respaldo restaurado en una copia |
| BAS-12 | Sistema visual: tokens, tipografía y componentes base | BAS-01 | Botón, campo, tabla, diálogo y aviso con foco y contraste verificados |
| BAS-13 | Layout de navegación y estados vacío, carga y error | BAS-12 | Navegación de escritorio y móvil sin desbordamiento |

### PLT — Identidad, empresa y aislamiento (17)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| PLT-01 | Esquema User, Session, Organization y Membership | BAS-05 | Migración con restricciones; dos empresas de prueba |
| PLT-02 | Registro con correo y contraseña | PLT-01 | Contraseña con hash de la biblioteca; política de longitud |
| PLT-03 | Verificación de correo | PLT-02 | Usuario sin verificar no entra; correo capturado en pruebas |
| PLT-04 | Inicio de sesión y cookies seguras | PLT-03 | Cookies HttpOnly/Secure/SameSite; protección CSRF por origen |
| PLT-05 | Cierre de sesión y revocación | PLT-04 | Sesión revocada deja de servir de inmediato |
| PLT-06 | Límite de intentos por IP y por cuenta | PLT-04 | Fuerza bruta bloqueada sin revelar si la cuenta existe |
| PLT-07 | Recuperación de contraseña | PLT-06 | Token de un solo uso con expiración; cierra otras sesiones |
| PLT-08A | MFA con TOTP: alta | PLT-05 | Alta y verificación de código probadas |
| PLT-08B | Desafío MFA al iniciar sesión | PLT-08A | Sesión incompleta hasta validar el código; MFA obligatorio para titular, administradores y personal de plataforma |
| PLT-09 | Códigos de recuperación de MFA y desactivación segura | PLT-08B | Recuperación no elude controles |
| PLT-10 | Alta de empresa con titular | PLT-03 | Creación atómica de empresa y membresía titular |
| PLT-11 | Contexto de empresa activa en servidor | PLT-10 | Cambiar de empresa revalida la membresía |
| PLT-12 | Capa de acceso a datos con `organization_id` obligatorio | PLT-11 | Consulta de negocio sin contexto de empresa falla en pruebas |
| PLT-13 | Relaciones compuestas y unicidad por empresa | PLT-12 | Asociar registros de otra empresa falla en la base de datos |
| PLT-14 | Bitácora de auditoría | PLT-12 | Cambios sensibles registran actor, empresa y motivo, sin secretos |
| PLT-15 | Batería de aislamiento con dos empresas | PLT-13 | Manipular URL, cuerpo o identificador nunca expone datos ajenos |
| PLT-16 | Revisión de amenazas de la etapa | PLT-15 | Hallazgos altos corregidos; matriz ASVS iniciada |

### USR — Usuarios y roles (12)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| USR-01 | Catálogo de roles y permisos en código | FUN-07, PLT-11 | Roles de lanzamiento definidos según la matriz |
| USR-02 | Función central de autorización | USR-01 | Pruebas por rol y acción; denegar por defecto |
| USR-03A | Acciones reservadas al titular | USR-02 | Solo el titular contrata, cancela y cambia el método de pago |
| USR-03B | Transferir titularidad y proteger al titular | USR-03A | Transferencia atómica (un solo titular); un administrador no puede desactivar ni degradar al titular ni otorgarse permisos superiores |
| USR-04 | Crear invitación por correo | USR-02 | Token de un solo uso con expiración y rol asignado |
| USR-05 | Aceptar invitación como usuario nuevo o existente | USR-04 | Membresía creada; token reutilizado o vencido rechazado |
| USR-06 | Asignar y combinar roles | USR-02 | Los permisos se unen; ocupa un solo lugar |
| USR-07 | Desactivar miembro | USR-06 | Revoca sus sesiones; conserva su autoría en el historial |
| USR-08 | Pantalla de equipo | USR-07, BAS-13 | Lista, estado, roles, reenviar y cancelar invitación |
| USR-09 | Menú y acciones según permisos | USR-08 | La UI oculta lo no permitido y el servidor igual lo rechaza |
| USR-10 | Pruebas negativas por rol | USR-09 | Consulta no escribe; Almacén no compra; Administrador no cobra |
| USR-11 | Auditoría de cambios de equipo | USR-10, PLT-14 | Invitar, cambiar rol o desactivar deja registro |

### MOD — Módulos, planes y derechos (11)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| MOD-01 | Contrato de módulo: id, versión, dependencias, permisos y límites | USR-02 | Tipo y validación del contrato con pruebas |
| MOD-02 | Registrar Inventario y Compras; Ventas y CRM como no disponibles | MOD-01 | Registro arranca y detecta dependencias inválidas o cíclicas |
| MOD-03 | Esquema comercial con precios versionados | MOD-01 | PlanVersion, Subscription, SubscriptionItem y Entitlement migrados |
| MOD-04 | Servicio de derechos efectivos | MOD-03 | Empresa → módulos activos y límites, con caché invalidable |
| MOD-05 | Guard de servidor: sesión → membresía → rol → módulo → límite | MOD-04, USR-02 | Acción de un módulo no contratado se rechaza aunque se llame a la API |
| MOD-06 | Activar y desactivar módulos con dependencias | MOD-05 | No se puede quitar Inventario con Compras activo |
| MOD-07 | Contador de cupo de productos con control de concurrencia | MOD-04 | Con 99/100, dos reservas simultáneas permiten solo una |
| MOD-08 | Cupo de usuarios por plan | MOD-07, USR-05 | Con 4 de 5 lugares, dos invitaciones simultáneas permiten solo una; invitaciones pendientes cuentan |
| MOD-09 | Consola interna de aprovisionamiento manual | MOD-06 | Personal de plataforma asigna nivel, módulos y vigencia con MFA y auditoría |
| MOD-10 | Pantalla «Mi plan» | MOD-09 | Muestra cupos (productos y usuarios), módulos y vigencia |
| MOD-11 | Estados de suscripción y su efecto | MOD-09 | Vencida → solo lectura y exportación; datos intactos |

### INV — Inventario (36)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| INV-01 | Esquema de producto: SKU, nombre, descripción, categoría, marca y código de barras | MOD-05 | SKU único por empresa |
| INV-02 | Alta de producto con consumo de cupo | INV-01, MOD-07 | Todas las altas pasan por un servicio central; con 100/100 se rechaza |
| INV-03 | Edición de ficha y atributos | INV-02 | Cambios auditados; la cantidad no se edita desde aquí |
| INV-04 | Archivar y reactivar | INV-03 | Archivar libera cupo; reactivar consume cupo; historial conservado |
| INV-05 | Catálogo de unidades y dimensiones | INV-01 | Pieza, par, docena, kg, g, m, cm, mm, L, mL y m² sembrados |
| INV-06 | Precisión e incremento por producto | INV-05, BAS-06 | 0.5 piezas se rechaza; 2.75 m se acepta |
| INV-07 | Presentaciones por producto | INV-06 | Caja = 100 piezas; factores cero, negativos o de otra empresa rechazados |
| INV-08 | Versiones del factor de presentación | INV-07 | Cambiar de 100 a 120 crea una versión y conserva la anterior |
| INV-09 | Servicio de conversión y vista previa en servidor | INV-08 | «3 cajas × 100 = 300 piezas»; dimensiones incompatibles rechazadas |
| INV-10 | Lista de productos paginada en servidor | INV-02 | 10,000 productos de prueba paginan sin cargar todo |
| INV-11 | Búsqueda por nombre, SKU y código de barras | INV-10 | Índices creados; búsqueda con 10,000 productos en tiempo aceptable |
| INV-12 | Filtros por categoría y marca | INV-11 | Filtros combinables y persistentes en la URL |
| INV-13 | Instalación y ubicación «General» automática | INV-01 | Toda empresa nueva tiene una instalación y la ubicación General |
| INV-14 | Zonas, pasillos y estantes | INV-13 | Jerarquía sin ciclos; nombres definidos por el negocio |
| INV-15 | Esquema de movimientos, líneas y saldos | INV-09, INV-13 | Línea guarda cantidad capturada, factor, versión y cantidad base |
| INV-16 | Entrada simple en unidad base | INV-15 | Movimiento y saldo en la misma transacción |
| INV-17 | Entrada con presentación | INV-16 | 3 cajas de 100 → 300 piezas (UNI-01) |
| INV-18 | Saldo inicial guiado | INV-17 | Saldo inicial registrado como movimiento, nunca editado |
| INV-19 | Salida y prevención de negativos | INV-17 | Salida mayor al saldo de la ubicación se rechaza (MOV-01) |
| INV-19B | Bloquear archivo con existencias | INV-04, INV-19 | Producto con saldo en cualquier ubicación no se archiva (órdenes abiertas se agregan en CMP-11) |
| INV-20 | Concurrencia en salidas | INV-19 | Dos salidas por la última unidad: solo una prospera |
| INV-21 | Clave idempotente en confirmaciones | INV-20 | Reintentar no duplica el movimiento (MOV-02) |
| INV-22 | Conexión perdida al confirmar | INV-21 | UI muestra «Verificando estado» y resuelve sin duplicar (NET-01) |
| INV-23 | Reubicación atómica | INV-21, INV-14 | 120/80 → 100/100 con el total intacto (INV-02) |
| INV-24 | Ajuste con motivo | INV-21 | Motivo obligatorio y auditado |
| INV-25 | Reversa trazable | INV-24, INV-08 | Reversa usa el factor original; caso 300 → 275 → 395 pasa (UNI-02) |
| INV-26 | Ficha de producto con total y desglose | INV-23 | Total y desglose por ubicación; equivalencia en presentaciones |
| INV-27 | Historial de movimientos con filtros | INV-25 | Filtros por fecha, producto, usuario y tipo |
| INV-28 | Salida rápida de varias líneas («salida por venta») | INV-21 | Varias líneas con presentaciones, motivo y referencia en una sola confirmación; sin cobro ni ticket |
| INV-29 | Lector de códigos que escribe como teclado | INV-28 | Lector real en búsqueda, entrada y salida; 10 líneas de salida rápida en menos de 2 minutos |
| INV-30 | Mínimos y existencias bajas | INV-26 | Lista derivada del saldo real, separada por empresa |
| INV-31 | Conteo físico: captura | INV-26 | Cajas y piezas normalizadas con vista previa; referencia temporal |
| INV-32 | Conteo: detectar movimientos posteriores | INV-31 | La diferencia considera los movimientos ocurridos durante el conteo |
| INV-33 | Conteo: aplicar ajustes de forma idempotente | INV-32 | Aplicar dos veces no duplica ajustes |
| INV-34 | Reconciliación de saldo contra historial | INV-33 | Tarea detecta diferencias; casos INV, UNI y MOV de la fase 1 pasan |
| INV-35 | Panel de inicio | INV-30 | Productos bajos, últimos movimientos y uso del cupo |

### IMP — Migración y salidas importadas (13)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| IMP-01 | Worker y cola durable en MySQL | INV-34 | Tarea fallida reintenta con límite y conserva el contexto de empresa |
| IMP-02 | Archivos privados por empresa | IMP-01 | Enlace temporal; archivo ajeno inaccesible |
| IMP-03 | Plantilla CSV/XLSX descargable | IMP-02 | Plantilla con ejemplos de unidad y presentación |
| IMP-04 | Lectura y mapeo de columnas | IMP-03 | Separador decimal explícito; sin ejecutar fórmulas ni macros |
| IMP-05 | Validación por celda y vista previa | IMP-04 | Errores por fila y columna sin modificar datos (IMP-01) |
| IMP-06 | Clasificar productos nuevos y actualizados | IMP-05 | SKU existente se marca como actualización; muestra cupos requeridos (IMP-02) |
| IMP-07 | Reserva atómica de cupos | IMP-06, MOD-07 | Importación y alta manual simultáneas no exceden el cupo |
| IMP-08 | Confirmación por lotes en el worker | IMP-07 | Reintentar el trabajo no duplica productos; factores fijados al confirmar |
| IMP-08B | Liberar reservas no consumidas | IMP-08 | Cancelación, fallo o worker abandonado liberan solo lo no usado, sin competir con trabajos activos |
| IMP-09 | Saldos iniciales por ubicación desde el archivo | IMP-08 | Saldos iguales al archivo, generados como movimientos; reintentar no duplica movimientos aunque cambie un factor durante la importación |
| IMP-10 | Importar salidas diarias desde CSV | IMP-08, INV-28 | Identificador externo impide duplicados; indica hasta qué fecha está actualizado el stock |
| IMP-11 | Exportación segura | IMP-02 | Celdas protegidas contra fórmulas; solo usuarios con permiso |
| IMP-12 | Guía de primer uso | IMP-09 | Usuario nuevo llega de catálogo a importación y a su primer movimiento sin ayuda |

### CMP — Compras (19)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| CMP-01 | Contactos compartidos en el núcleo: esquema | MOD-05, IMP-12 | Contacto con tipo proveedor y/o cliente, aislado por empresa |
| CMP-02 | Alta, edición y búsqueda de proveedores | CMP-01 | RFC opcional validado en formato; duplicados advertidos |
| CMP-03 | Relación producto-proveedor | CMP-02, INV-07 | Código del proveedor, presentación de compra y último costo |
| CMP-04 | Orden de compra: borrador y líneas | CMP-03 | Línea guarda presentación y versión de factor; conversión visible |
| CMP-05 | Estados de la orden | CMP-04 | Borrador → enviada → parcial → recibida o cancelada; transiciones inválidas rechazadas |
| CMP-06A | PDF de la orden | CMP-05 | PDF con datos del negocio y del proveedor |
| CMP-06B | Envío por correo con reintentos | CMP-06A, IMP-01 | Envío desde el worker; fallo visible y reintentable |
| CMP-07 | Recepción total | CMP-05, INV-21 | Recepción y entrada de inventario en la misma transacción |
| CMP-08 | Recepción parcial y pendientes | CMP-07 | 60 de 100 → parcial con 40 pendientes |
| CMP-09 | Ubicación destino y presentación al recibir | CMP-08, INV-14 | Recibir 2 cajas en A-01 → 200 piezas en A-01; si el factor cambió entre orden y recepción, se usa y muestra el vigente al recibir, con la diferencia visible |
| CMP-10 | Idempotencia y concurrencia de recepciones | CMP-09 | Dos recepciones simultáneas no reciben de más |
| CMP-11 | Cerrar orden con faltante | CMP-10, INV-19B | Faltante registrado; un producto con orden abierta no se archiva |
| CMP-12 | Devolución a proveedor | CMP-10 | Límite acumulado por recepción; devoluciones concurrentes o repetidas no exceden lo recibido; documento y stock atómicos |
| CMP-13 | Registro de costo de compra | CMP-07 | Último costo por producto; sin valuación contable |
| CMP-14 | Sugerencia de compra desde mínimos | CMP-04, INV-30 | Genera un borrador por proveedor |
| CMP-15 | Reportes de compras | CMP-11 | Pendientes por recibir y compras por proveedor; exportables |
| CMP-16 | Permisos del Comprador y guard del módulo | CMP-15, USR-10 | Sin el módulo Compras: rechazo por API y menú oculto |
| CMP-17 | Desactivar el módulo | CMP-16, MOD-06 | Órdenes abiertas advertidas; historial en solo lectura |
| CMP-18 | Pruebas de extremo a extremo de compras con inventario | CMP-17 | Comprar, recibir parcialmente, devolver y conciliar saldo exacto |

### PIL — Piloto y lanzamiento limitado (19)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| PIL-01 | Ambiente de producción separado y rollback | CMP-18, BAS-11 | Despliegue anterior recuperable sin migración destructiva |
| PIL-02 | Respaldo continuo o recuperación a un punto en el tiempo | PIL-01 | Configurado y monitoreado |
| PIL-03 | Simulacro de restauración | PIL-02 | RPO y RTO medidos y anotados |
| PIL-04 | Alertas operativas | PIL-01 | Errores, cola detenida y respaldo fallido generan avisos |
| PIL-05 | Revisión de seguridad de la versión candidata | PIL-01 | Matriz ASVS actualizada; sin hallazgos críticos ni altos abiertos |
| PIL-05B | Regresión integral | PIL-05 | Permisos, aislamiento, jobs, cupos, derechos y recorridos de extremo a extremo pasan |
| PIL-06 | Prueba de carga de 100, 1,000 y 10,000 SKU | PIL-01 | p95 < 500 ms en lecturas comunes con 20 usuarios; entorno documentado |
| PIL-07 | Accesibilidad, móvil y mensajes de error | PIL-01 | Recorridos principales con teclado y pantalla pequeña |
| PIL-08 | Términos del piloto y aviso de privacidad | FUN-08 | Revisados por un profesional externo (en paralelo desde FUN) |
| PIL-09 | Aceptación versionada de documentos | PIL-08 | Versión, fecha y usuario guardados |
| PIL-10 | Circuito fiscal de nuestra suscripción | FUN-08 | Datos fiscales del cliente; CFDI vía contador o servicio vinculado al pago |
| PIL-11 | Registro de pago manual y vigencia en la consola | MOD-09, PIL-10 | Pago SPEI → vigencia → derechos, con auditoría |
| PIL-12 | Soporte y acceso de soporte auditado | PIL-04 | Canal y horario definidos; acceso temporal y registrado |
| PIL-13 | Incorporar el piloto 1 y conciliar su importación | PIL-01–PIL-12, PIL-05B | Totales iguales al origen, firmados por el negocio |
| PIL-14A | Incorporar el piloto 2 | PIL-13 | Mismo criterio |
| PIL-14B | Incorporar el piloto 3 | PIL-14A | Mismo criterio |
| PIL-15 | Ciclo de observación y correcciones (repetible) | PIL-14B | Fricciones registradas; fallos prioritarios corregidos; salidas omitidas medidas |
| PIL-16 | Revisión de primer cobro y renovación | PIL-15 y 1–2 semanas de uso | Al menos un piloto paga una mensualidad; decisión documentada de continuar |
| PIL-17 | Lanzamiento limitado de Inventario + Compras con cobro asistido | PIL-16 | Página simple con oferta, contacto y cancelación; cohorte pequeña habilitada desde la consola; monitoreo activo |

### BIL — Cobro automático y apertura (18)

Se ejecuta cuando la carga administrativa o los impagos lo justifiquen; unos diez clientes es una referencia. No bloquea el lanzamiento limitado de PIL-17.

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| BIL-01 | Comparar Stripe, Conekta y Mercado Pago | PIL-17 | Matriz: suscripción con conceptos variables, prorrateo, métodos de pago, comisiones, webhooks y facturación. Decisión registrada |
| BIL-02 | Cuenta de pasarela y sandbox | BIL-01 | Cuenta verificada; llaves por ambiente |
| BIL-03 | Adaptador de pasarela | BIL-02 | Interfaz propia; la lógica de negocio no depende del SDK |
| BIL-04 | Catálogo de precios sincronizado y versionado | BIL-03, MOD-03 | Nivel × módulo × usuario reflejado en la pasarela |
| BIL-05 | Checkout alojado, solo para el titular | BIL-04, USR-03A | Volver del checkout no concede acceso por sí solo |
| BIL-06A | Recepción de webhooks | BIL-05, IMP-01 | Firma verificada; evento persistido antes de responder; firma inválida rechazada |
| BIL-06B | Procesamiento de webhooks | BIL-06A | Evento repetido sin efecto; eventos desordenados no retroceden el estado |
| BIL-07 | Derechos desde el estado autoritativo y reconciliación periódica | BIL-06B | Un evento perdido se recupera consultando a la pasarela |
| BIL-08 | Agregar o quitar un módulo con prorrateo visible | BIL-07, MOD-06 | Importe y fecha mostrados antes de confirmar |
| BIL-09 | Subir de nivel | BIL-08 | Total recalculado de todos los módulos; nuevo cupo solo con pago confirmado |
| BIL-10 | Bajar de nivel programado | BIL-09 | Excedentes sin borrado; nuevas altas bloqueadas |
| BIL-11 | Usuarios adicionales como concepto de cobro | BIL-08, MOD-08 | Agregar un lugar actualiza el cargo y el cupo |
| BIL-12 | Pago fallido, gracia y recuperación | BIL-07 | Fallo → gracia → solo lectura → recuperación sin perder datos |
| BIL-13 | Cancelación y salida | BIL-12, IMP-11 | Exportación disponible; política de conservación aplicada |
| BIL-14 | CFDI de suscripción automatizado o procedimiento definitivo | BIL-07, PIL-10 | Cada pago queda vinculado a su UUID, XML y PDF |
| BIL-15 | Landing, precios, paquetes y ayuda | BIL-08 | Solo se ofrecen módulos existentes; contacto y cancelación visibles |
| BIL-15B | Regresión integral con cobro automático | BIL-15 | Permisos, aislamiento, jobs, derechos y ciclo de cobro completo pasan |
| BIL-16 | Apertura general con contratación en línea | BIL-15B | Alta y pago sin intervención manual; monitoreo de cobro activo |

### VEN — Ventas: punto de venta (28)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| VEN-01 | Definición con los pilotos | PIL-17 | Flujo de mostrador, métodos de pago, ticket y devoluciones; crédito/fiado y CFDI excluidos o reestimados |
| VEN-02 | Registrar el módulo Ventas y el rol Cajero | VEN-01, MOD-02 | Contrato con dependencias y permisos |
| VEN-03 | Precio de venta por producto y presentación | VEN-02 | Precio por pieza y por caja independientes |
| VEN-04 | Cálculo de impuestos | VEN-03 | IVA incluido o desglosado con redondeo definido y pruebas |
| VEN-05 | Esquema de venta, líneas y pagos | VEN-04 | Migración con relaciones por empresa |
| VEN-06 | Pantalla POS: búsqueda, lector y carrito | VEN-05, INV-29 | Agregar por código en menos de 2 segundos |
| VEN-07 | Carrito con presentaciones y decimales | VEN-06 | 2.75 m de cable y 1 caja calculados correctamente |
| VEN-08 | Cliente opcional o público en general | VEN-06, CMP-01 | Usa Contactos compartidos |
| VEN-09 | Confirmar venta → salida de inventario | VEN-07 | Misma transacción; sin stock suficiente la venta se rechaza |
| VEN-10 | Idempotencia y concurrencia de la venta | VEN-09 | Doble clic no duplica; última unidad para un solo cliente |
| VEN-11 | Pago en efectivo con cambio | VEN-09 | Cambio calculado y registrado |
| VEN-12 | Pago con tarjeta (terminal externa) y transferencia | VEN-11 | Referencia capturada; sin procesar tarjetas en la aplicación |
| VEN-13 | Pagos mixtos | VEN-12 | La suma debe igualar el total |
| VEN-14 | Descuentos con permiso | VEN-09, USR-02 | Límite por rol; auditado |
| VEN-15 | Ticket no fiscal | VEN-11 | Impresión de 80 mm y enlace o correo |
| VEN-16 | Apertura de caja con fondo | VEN-11 | Sin caja abierta no se cobra |
| VEN-17 | Ingresos y egresos de caja | VEN-16 | Con motivo y auditados |
| VEN-18 | Corte de caja y diferencias | VEN-17 | Esperado contra contado por método de pago |
| VEN-19 | Devolución total | VEN-09 | Reingresa a inventario y registra el reembolso |
| VEN-20 | Devolución parcial | VEN-19 | No permite devolver más de lo vendido |
| VEN-21 | Cancelación de venta | VEN-19 | Con permiso, motivo y reversa |
| VEN-22 | Historial de ventas | VEN-21 | Filtros por fecha, cajero y cliente |
| VEN-23 | Reportes de ventas | VEN-22 | Ventas por día, producto y cajero; exportables |
| VEN-24 | Prueba con impresora térmica y lector reales | VEN-15 | Funciona con el hardware de un piloto |
| VEN-25 | Coexistencia con salida rápida e importación de salidas | VEN-09, IMP-10 | Guía y advertencias para evitar descontar dos veces |
| VEN-26 | Desactivar el módulo | VEN-18, MOD-06 | Cajas abiertas resueltas; historial en solo lectura |
| VEN-27 | Precio del módulo en la pasarela y la landing | VEN-26, BIL-08 | Contratable por nivel |
| VEN-28 | Pruebas de extremo a extremo y piloto POS | VEN-27 | Un día real de mostrador concilia caja e inventario |

### COT — Ventas: cotizaciones y pedidos (12)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| COT-01 | Esquema de cotización | VEN-05 | No depende de la caja |
| COT-02 | Crear cotización con cliente y vigencia | COT-01 | Precios con presentaciones e impuestos |
| COT-03 | PDF y envío | COT-02 | PDF con la marca del negocio; correo al cliente |
| COT-04 | Estados de la cotización | COT-03 | Enviada, aceptada, rechazada y vencida automática |
| COT-05 | Convertir a pedido | COT-04 | Copia precios vigentes al aceptar |
| COT-06 | Decidir reserva de stock para pedidos | COT-05 | Decisión con pilotos; si se aprueba, no vende lo apartado |
| COT-07 | Surtido parcial → salida | COT-06 | Salida transaccional por lo surtido |
| COT-08 | Cobrar un pedido en POS | COT-07, VEN-13 | Pago vinculado al pedido |
| COT-09 | Cancelar pedido | COT-07 | Libera la reserva; surtidos requieren devolución |
| COT-10 | Permisos del Vendedor | COT-09 | Vendedor no abre caja ni ajusta inventario |
| COT-11 | Reportes de cotizaciones | COT-10 | Tasa de conversión y pendientes |
| COT-12 | Pruebas de extremo a extremo | COT-11 | Cotizar → pedir → surtir parcial → cobrar concilia |

### CRM (18)

| ID | Paso | Requiere | Listo cuando |
| --- | --- | --- | --- |
| CRM-01 | Definición con clientes | PIL-17 | Problema real validado: cotizaciones olvidadas, recompra o contratistas |
| CRM-02 | Registrar el módulo, sus permisos y el límite de contactos | CRM-01, MOD-02 | Funciona sin Ventas |
| CRM-03 | Contactos ampliados: persona/empresa y etiquetas | CRM-02, CMP-01 | Sin duplicar los contactos del núcleo |
| CRM-04 | Importar contactos con cupo | CRM-03, IMP-05 | Vista previa y duplicados detectados |
| CRM-05 | Oportunidades: esquema y alta | CRM-03 | Monto estimado, etapa y responsable |
| CRM-06 | Embudo tipo kanban | CRM-05 | Arrastrar cambia la etapa con auditoría |
| CRM-07 | Etapas configurables | CRM-06 | Renombrar y ordenar sin perder historial |
| CRM-08 | Actividades y tareas con fecha | CRM-05 | Llamada, visita y nota |
| CRM-09 | Recordatorios | CRM-08, IMP-01 | Aviso en la aplicación y por correo vía worker |
| CRM-10 | Línea de tiempo del contacto | CRM-08 | Notas, actividades y cambios |
| CRM-11 | Vincular oportunidad con cotización | CRM-05, COT-02 | Solo si Ventas está contratado |
| CRM-12 | Historial de compras del cliente | CRM-10, VEN-22 | Solo si Ventas está contratado |
| CRM-13 | Asignación y «mis oportunidades» | CRM-06 | El Vendedor ve las suyas; el Administrador ve todas |
| CRM-14 | Reporte del embudo | CRM-13 | Por etapa, responsable y periodo |
| CRM-15 | Detectar y fusionar duplicados | CRM-04 | La fusión conserva el historial |
| CRM-16 | Desactivar el módulo | CRM-15, MOD-06 | Historial en solo lectura; contactos del núcleo intactos |
| CRM-17 | Precio del módulo en la pasarela y la landing | CRM-16, BIL-08 | Contratable por nivel |
| CRM-18 | Pruebas de extremo a extremo | CRM-17 | Sin Ventas: prospecto → oportunidad → actividad → cierre. Con Ventas: además cotización → venta |

## 8. Expansiones por demanda

Se planean en pasos de medio día solo cuando haya demanda demostrada. Cada una actualiza precio, permisos, derechos contratados, pruebas de aislamiento, política de baja y soporte.

| Módulo | Pasos estimados | Criterio final |
| --- | ---: | --- |
| Multi-sucursal | ~12 | Sin stock duplicado entre instalaciones; traspasos conciliados |
| Traspasos en tránsito | ~10 | Origen, tránsito y destino siempre conciliados |
| Lotes y caducidades | ~12 | Ningún stock sin lote cuando se exige |
| Números de serie | ~10 | Una serie no puede estar en dos ubicaciones |
| Reportes avanzados | ~10 | Resultados reproducibles; valuación contable aparte |
| Roles personalizables | ~6 | Sin escalar privilegios |
| CFDI de ventas del cliente | Plan específico | PAC, sandbox y asesoría fiscal; no estimar timbrado como un paso |
| API e integraciones | Plan por integración | Claves con alcance, cuotas, firmas y aislamiento |
| Sin conexión | Investigación previa | Replantea la concurrencia del stock; no basta una PWA |

## 9. Criterios para considerar la primera versión vendible

- Tres ferreterías completan importación, operaciones principales y un ciclo de compra → recepción → devolución; sus saldos por producto/ubicación cuadran con los ejemplos conciliados.
- Las pruebas de usabilidad miden encontrar producto, cantidad y ubicación, además de registrar movimientos; las fricciones principales se corrigen antes del lanzamiento.
- Pruebas automatizadas de aislamiento, permisos por rol, módulos contratados, concurrencia e idempotencia aprobadas. Las salidas diarias se registran sin depender de Ventas y se mide cuántas se omiten.
- Conversiones de presentaciones, precisión decimal, cambio de factor, reversas e importaciones verificadas. Pérdida de conexión durante confirmación no produce falsa confirmación ni duplicados.
- Restauración practicada; pérdida máxima y tiempo de recuperación medidos y compatibles con lo ofrecido.
- Para el lanzamiento limitado basta el cobro asistido con CFDI. Para la apertura general: cobro, cambio de módulo, impago, cancelación y recuperación verificados con escenarios reales controlados/sandbox pertinentes.
- Alta concurrente, importación, actualización, archivo y reactivación respetan cupos por empresa; ampliar/reducir plan conserva historial y ninguna operación genera cargos automáticos por excedente.
- Términos y privacidad revisados para el mercado elegido; aceptación versionada y procedimiento de salida operativo.
- Obligaciones fiscales de tu suscripción resueltas; soporte, monitoreo y respuesta a incidentes tienen responsable.
- Riesgos críticos/altos corregidos; evidencia de revisión y política de actualizaciones disponible.
- Costos y horas de soporte permiten un margen viable al precio validado; funcionalidades ofrecidas coinciden con las implementadas.

## 10. Forma de ejecutar cada jornada

Antes: confirmar objetivo, dependencias y ejemplo de aceptación. Durante: implementar el menor incremento completo y verificar los riesgos que cambia. Al cerrar: dejar evidencia, anotar pendientes, actualizar esta planificación y `MEMORY.md`, y elegir el siguiente paso. Una pantalla terminada sin reglas, permisos o persistencia no completa un incremento de negocio.

Registrar para cada paso: pendiente/en curso/verificado, archivos afectados, prueba o demostración, bloqueo y siguiente paso. D01–D06 dejaron documentación y prototipo; su validación externa continúa en FUN-01–FUN-08. Los pasos BAS–CRM siguen pendientes. Las pruebas del prototipo no completan por adelantado las jornadas de implementación de producción. Los identificadores antiguos D07–D60 y U01–U04 quedan reemplazados por los de la sección 7.

Confirmados: Inventario como base obligatoria, módulos con precio por nivel de capacidad, usuarios incluidos más adicionales, roles, Inventario + Compras en el primer lanzamiento, Ventas con punto de venta primero y equipo de fundador + IA a medio tiempo. También: México, ferreterías, facilidad de uso, SAP como referencia, inventario de una instalación con zonas/pasillos/estantes, unidades amplias con presentaciones configurables y operación con internet. El fundador estima 1,000 productos para el primer cliente y confirma capacidad por plan, desde unos 100 hasta miles. Pendientes prioritarios: niveles/precios definitivos, usuarios/movimientos diarios, equipo/experiencia/horas y presupuesto. Segunda ronda: precisión/presentaciones, atributos/variantes/lotes, dispositivos, roles, Excel, pilotos y soporte. Facturar ventas del cliente queda para después; resolver el circuito fiscal de nuestras suscripciones antes de cobrar.

## 11. Historial de cambios

- v0.1: propuesta general para pymes, con multi-almacén como primera extensión implementada.
- v0.2: México y ferreterías confirmados; alcance inicial exclusivamente inventario de una instalación. Se concreta producto/cantidad/descripción/ubicación, se añaden criterios de UX y se destinan D40–D42 a ubicaciones internas. Multi-almacén entre instalaciones pasa a expansión posterior. Se conservan 60 jornadas como estimación inicial sujeta a unidades y volumen.
- v0.3: unidades amplias, factores por presentación configurados por el tendero y operación con internet confirmados. Se define unidad base, precisión, historial de factores y recuperación de confirmaciones interrumpidas. Se agregan U01–U04 después de D23: estimación base de 64 jornadas.
- v0.4: capacidad de productos por plan confirmada y referencia de 1,000 productos para el primer cliente. Se proponen niveles 100/500/1,000/3,000/10,000, definición de cupos, cambios de capacidad sin pérdida de datos y validación concurrente/importaciones. Se precisan las jornadas existentes de límites/cobro/carga y se mantienen 64 como estimación, a revalidar en D06.
- v0.5: único tipo de usuario confirmado e inicio de fase 1 autorizado. Se sustituyen roles diferenciados por autorización de cuenta/empresa y se preparan definición, guion de entrevistas, hipótesis comerciales, reglas, riesgos y prototipo navegable. No se simulan entrevistas ni validaciones externas; la fase sigue abierta hasta completarlas.
- v0.6: modelo modular acordado con el fundador y revisado en tres rondas entre Claude y Codex. Inventario como base obligatoria por capacidad; módulos Compras, Ventas (punto de venta, luego cotizaciones/pedidos) y CRM con precio por nivel; usuarios incluidos y adicionales; roles predefinidos que reemplazan el perfil único. Primer lanzamiento: Inventario + Compras con cobro asistido; cobro automático cuando lo justifique la carga. El plan pasa de 64 jornadas a 224 pasos de unas 3 horas (148 hasta el lanzamiento limitado), con dependencias validadas automáticamente.
