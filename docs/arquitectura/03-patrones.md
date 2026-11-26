# 3. Patrones de diseño

Cada patrón dice **qué es**, **dónde está** y **por qué se eligió**. Casi todos responden a dos riesgos de un SaaS de inventario y caja:

1. **Mezclar datos de empresas distintas.** Varias empresas comparten la misma base.
2. **Que las existencias o el dinero dejen de cuadrar.** Pasa con dobles clics, peticiones simultáneas o una conexión que se cae a la mitad.

---

## Arquitectura

### Monolito modular

- **Qué es:** una sola aplicación y un solo despliegue, dividida por dentro en un núcleo (`platform`) y módulos (`modules`) con fronteras estrictas.
- **Dónde:** `src/platform/*`, `src/modules/*`, reglas en `eslint.config.mjs`.
- **Por qué:** da la separación de los microservicios (cada módulo se contrata, se apaga y se prueba por separado) sin su costo operativo: una base, un despliegue, transacciones normales entre módulos. Si algún día un módulo necesita vivir aparte, sus fronteras ya están dibujadas.

### Arquitectura por capas con API pública

- **Qué es:** las dependencias van en una sola dirección (`app → modules → platform → server → lib`). Cada área solo se usa por su `index.ts`.
- **Dónde:** ver [Estructura](02-estructura.md); lo impone `eslint-plugin-boundaries`.
- **Por qué:** cambiar el interior de un área no rompe a quien la usa, y la plataforma nunca depende de un módulo.

### Contrato de módulo + registro (plugin)

- **Qué es:** cada módulo se describe con un objeto `ModuleContract` (id, dependencias, permisos, límites) creado con `defineModule`. Un registro único los valida al arrancar: ids únicos, una sola base, sin ciclos, cada permiso con un dueño.
- **Dónde:** `src/platform/billing/contract.ts` y `registry.ts`; `src/modules/*/contract.ts`; `src/modules/registry/index.ts`.
- **Por qué:** menú, guardas, pantallas de plan y compra en línea responden con la misma fuente a «qué módulos existen y qué permisos son suyos». Agregar un módulo es su carpeta, su contrato y una línea en el registro. Si algo está mal declarado, la app no arranca, en vez de fallar en producción.

### Raíz de composición (*composition root*)

- **Qué es:** un solo lugar conoce a todos los módulos y los conecta con la plataforma. La plataforma recibe ids, contratos y manejadores como datos.
- **Dónde:** `src/modules/registry/` (`moduleRegistry`, `jobHandlers`, `scheduledRounds`, `moduleOpenWork`).
- **Por qué:** es la única forma de respetar «la plataforma nunca importa módulos» y aun así permitir que el worker ejecute trabajos de Ventas o que quitar un módulo avise de su trabajo pendiente.

---

## Separación de responsabilidades

### Capa de servicios + Server Actions delgadas

- **Qué es:** toda regla de negocio vive en un servicio (`registerExit`, `registerSale`…). La pantalla (Server Component) solo lee y pinta. La Server Action (`actions.ts`) solo traduce `FormData` → servicio → `redirect`/`revalidatePath`.
- **Dónde:** servicios en `src/modules/*` y `src/platform/*` (con `import "server-only"`); acciones en `src/app/**/actions.ts`.
- **Por qué:** una regla escrita una vez sirve para la pantalla, el worker, los scripts y las pruebas. Las pruebas de integración llaman al servicio real, sin navegador. `server-only` impide que un servicio llegue por error al navegador.

### Resultados como uniones (*Result type*)

- **Qué es:** un fallo esperado no lanza una excepción; se devuelve: `{ ok: true, … } | { ok: false, reason, fieldErrors }`. Solo lo inesperado lanza (`AppError` y subclases).
- **Dónde:** todos los servicios. Ejemplo: `post()` en `src/modules/inventory/movements.ts`.
- **Por qué:** TypeScript obliga a la pantalla a manejar cada caso, y los mensajes llegan en español, ligados a su campo. Un error real (base caída) no se confunde con «no hay existencias».

### Validación en el servidor con Zod

- **Qué es:** cada servicio valida su entrada con un esquema Zod; el navegador solo ayuda.
- **Por qué:** el navegador no es de confianza. Del formulario solo viajan ids y texto tecleado; factores, precios, existencias e identidad salen siempre del servidor.

---

## Empresas y seguridad

### Multiempresa con filtro obligatorio (*row-level tenancy*)

- **Qué es:** todas las empresas comparten tablas, y cada fila lleva `organizationId`. El código de negocio no usa el cliente `db` directo: pide `forOrganization(organizationId)`, una extensión de Prisma que **agrega el filtro a cada consulta**, revisa la empresa en cada alta y rechaza SQL directo.
- **Dónde:** `src/server/tenant-db.ts` (`TENANT_MODELS`, `forOrganization`, `lockRows`). La empresa sale solo de `requireOrganizationContext()`, nunca del formulario.
- **Por qué:** olvidar un `where` es el error más común y más grave de un SaaS. Aquí no se puede olvidar. Una prueba falla si una tabla con `organizationId` falta en la lista.
- **Defensa en profundidad:** las relaciones entre tablas usan **llaves compuestas** `(organizationId, id)`, así que ni con SQL a mano MySQL deja apuntar a una fila de otra empresa. La batería `tests/isolation/` lo comprueba con dos empresas.

### Autorización: RBAC con política única y denegar por defecto

- **Qué es:** roles combinables (Administrador, Almacén, Comprador, Consulta, Cajero, Encargado de caja) → permisos (`inventory.movement.create`). Una sola función pura decide: `can(subject, permission)`. Lo que no está concedido, se niega.
- **Dónde:** `src/platform/authorization/policy.ts` (decisión), `catalog.ts` (roles y permisos), `access.ts` (`requirePermission`, `assertAllowed`). La matriz aprobada está en `docs/producto/MATRIZ_ROLES_PERMISOS.md`, y una prueba falla si código y documento no coinciden.
- **Por qué:** una sola decisión es auditable y se prueba de forma exhaustiva (cada rol contra cada permiso). Los roles se leen de la base en cada petición: quitar un rol tiene efecto inmediato.

### Guardas en capas (*guard clauses*)

- **Qué es:** cada operación pasa en orden sesión → empresa activa → permiso del rol → módulo contratado y vigente → cupo.
- **Dónde:** `requireSession` (`platform/auth/session.ts`), `requireOrganizationContext` (`platform/tenancy`), `assertModulePermission` / `getModuleAccess` (`platform/billing/guard.ts`), `assertWithinLimit`.
- **Por qué:** la pantalla oculta lo que no puedes usar, pero **el servicio lo vuelve a comprobar**: esconder un botón no es seguridad. `src/proxy.ts` solo hace una revisión rápida de la cookie para redirigir; la decisión real se toma contra la base.

### Bitácora solo-agregar (*audit log*)

- **Qué es:** cada cambio sensible escribe un evento en la misma transacción que el cambio. Disparadores de MySQL impiden editar o borrar eventos, incluso a la aplicación.
- **Dónde:** `src/platform/audit` (`recordAuditEvent`, `recordSecurityEvent`).
- **Por qué:** si el cambio se guarda, su registro también; si falla, ninguno. Nadie puede borrar sus huellas.

---

## Inventario y dinero confiables

### Libro mayor inmutable + saldo (*ledger*)

- **Qué es:** las existencias no se escriben a mano. Cada cambio es un **movimiento** (`stock_movement` + líneas) que nunca se edita ni se borra. El saldo (`stock_balance`) se actualiza en la misma transacción. Un error se corrige con una **reversa**, no editando.
- **Dónde:** `src/modules/inventory/movements.ts`; disparadores en las migraciones; `reconciliation.ts` (`npm run stock:reconcile`) comprueba que saldo = suma del historial.
- **Por qué:** es el mismo principio de la contabilidad. Siempre se sabe quién movió qué, cuándo y por qué, y el saldo se puede recalcular y verificar. Ventas, recepciones y devoluciones siguen la misma regla.

### Concurrencia: bloqueo pesimista con orden fijo

- **Qué es:** antes de decidir, la transacción **bloquea las filas** que va a tocar (`SELECT … FOR UPDATE` con `lockRows`) en un orden fijo (productos por id → ubicación → caja → documento) y usa `READ COMMITTED` (`LOCKING_TRANSACTION`) para leer el valor vigente después de esperar.
- **Dónde:** `lockRows` en `src/server/tenant-db.ts`; al inicio de cada servicio que mueve existencias, caja o documentos.
- **Por qué:** dos cajeros vendiendo la última pieza al mismo tiempo no pueden dejar el saldo en −1. El orden fijo evita interbloqueos. Además, la salida resta con una condición (`quantity >= cantidad`) y un `CHECK` de la tabla es la última defensa.

### Idempotencia con clave (*idempotency key*)

- **Qué es:** al pintar un formulario que confirma algo irreversible, el servidor genera una clave única que viaja oculta. Si la misma clave llega dos veces (doble clic, reintento), el servicio responde con lo que ya hizo en vez de repetirlo. Si la respuesta se pierde, la pantalla verifica por clave antes de dejar reintentar.
- **Dónde:** `idempotencyKey` en movimientos, recepciones, ventas y abonos; `findReplay` en `movements.ts`; `checkSaleAction`, `checkReceiptAction`.
- **Por qué:** con internet inestable, «¿se guardó o no?» no puede terminar en una venta cobrada dos veces.

### Decimales exactos (*value objects*)

- **Qué es:** cantidades y dinero siempre con `Decimal` (`src/lib/decimal.ts`), `DECIMAL` en MySQL y `parseQuantity`/`parsePrice` al capturar. Nunca `Number()`.
- **Por qué:** evita errores de redondeo en existencias, costos e IVA. El IVA se redondea una sola vez por venta, y subtotal + IVA = total siempre.

### Estado derivado, no guardado

- **Qué es:** lo que se puede calcular no se guarda: «existencias bajas», «vencida», «faltante», «qué mensualidad cubre cada abono», «cuánto debe haber en caja».
- **Dónde:** `listLowStock`, `applyPayments`, `cashTotals`, `getFirstSteps`, entre otros.
- **Por qué:** una bandera guardada se desincroniza; un cálculo no. Hay menos datos que mantener y menos defectos.

### Máquina de estados duplicada en la base

- **Qué es:** las transiciones permitidas (orden de compra: borrador → enviada → parcial → recibida; cotización; pedido) están en **una tabla pura** en código y la misma tabla se repite en un disparador de MySQL.
- **Dónde:** `order-states.ts`, `quote-states.ts`, `sales-order-states.ts`, con sus pruebas unitarias y disparadores.
- **Por qué:** la pantalla pregunta `canTransition` para mostrar solo lo posible. Aunque un defecto se saltara el servicio, la base rechaza una transición ilegal.

### Restricciones en la base como última defensa

- **Qué es:** `CHECK`, índices únicos y disparadores repiten las reglas críticas: saldo ≥ 0, líneas inmutables, una caja abierta por persona, un pedido por cotización.
- **Por qué:** el servicio es la primera barrera. La base garantiza que ni un defecto ni un script manual rompan la integridad.

---

## Procesos en segundo plano e integraciones

### Cola de trabajos transaccional (*transactional outbox*)

- **Qué es:** lo lento o lo que puede fallar (importar 5,000 productos, mandar un correo, recordatorios) se **encola en la misma transacción** que lo origina (`enqueueJob(tx, …)`), y un proceso aparte (worker) lo ejecuta.
- **Dónde:** `src/platform/jobs/queue.ts`, `scripts/worker.mts`, manejadores en `src/modules/registry/jobs.ts`.
- **Por qué:** sin Redis ni servicios extra. Si la transacción falla, no queda un trabajo huérfano. Cada manejador es **idempotente** (puede correr dos veces sin efecto doble) y declara `onFailed` para devolver lo que apartó (por ejemplo, cupo) si falla del todo.

### Estrategia / adaptador para pagos

- **Qué es:** cada proveedor de pago implementa la misma interfaz `PaymentProvider`, y el núcleo de compra no sabe cuál usa.
- **Dónde:** `src/platform/billing/checkout/` (`provider.ts`, `PAYMENT_PROVIDERS`).
- **Por qué:** agregar o cambiar de proveedor no toca la lógica de órdenes. El plan se aplica solo cuando el proveedor confirma importe y moneda exactos (webhook firmado), nunca por el regreso del navegador.

### Constructores de documentos (*builder*)

- **Qué es:** todo PDF, CSV o XLSX que sale se arma con un constructor propio (`PdfPageWriter` + `buildPdf`, `buildCsv`, `buildXlsx`).
- **Dónde:** `src/platform/files`.
- **Por qué:** un solo lugar escapa texto y neutraliza fórmulas, para evitar la inyección en Excel y el contenido activo en PDF.

---

## Interfaz

### Server Components + cliente mínimo

- **Qué es:** las pantallas se generan en el servidor con los datos ya filtrados por permiso. Solo lo interactivo (formularios, lector de códigos) es componente cliente.
- **Por qué:** menos JavaScript en el teléfono y los datos sensibles (costos) nunca llegan al navegador de quien no los puede ver: el campo no existe en la respuesta.

### Estado en la URL

- **Qué es:** búsqueda, filtros y página van en la dirección (`?q=…&pagina=2`).
- **Por qué:** se puede recargar, compartir y regresar sin perder lo filtrado, y funciona sin JavaScript.

### Sistema de diseño con tokens

- **Qué es:** colores, espacios y tipografía como variables CSS (`globals.css`), con valor para claro y oscuro. Ningún componente usa colores sueltos.
- **Por qué:** un cambio de color se hace en un lugar, y una prueba verifica el contraste WCAG de cada token.

---

## Por qué tanta defensa

El sistema guarda el dinero y la mercancía de negocios reales. Cada patrón de arriba cierra un caso concreto que ya se probó: dos empresas, dos cajeros a la vez, una conexión que se corta y un reintento. Las pruebas de integración corren esos casos contra MySQL real en cada push.
