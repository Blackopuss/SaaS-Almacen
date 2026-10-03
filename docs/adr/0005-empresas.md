# ADR 0005 — Alta de empresa con titular

Fecha: 2026-10-03 · Estado: aceptada · Pasos: PLT-10 (base para PLT-11 a PLT-13)

## Contexto

Cada dato de negocio pertenece a una empresa (`organization_id`). La persona que se registra debe terminar con una empresa propia de la que es titular, la única cuenta que contrata o cancela (USR-03A), y el titular debe usar MFA (PLT-08B).

## Decisión

- Después de confirmar el correo, quien no pertenece a ninguna empresa llega a `/crear-empresa` (nombre del negocio y zona horaria de México). Las pantallas del negocio usan `requireOrganizationContext()` (`src/platform/tenancy`, PLT-11) y mandan ahí a quien no tiene empresa.
- La empresa y la membresía del titular se crean en **una transacción** (`createOrganization`): existen las dos o ninguna. Moneda fija MXN.
- **Una empresa por cuenta por ahora**: el alta se rechaza si la persona ya tiene una membresía activa (una membresía desactivada no lo impide). Para que dos envíos simultáneos no creen dos empresas, la transacción bloquea la fila del usuario (`SELECT … FOR UPDATE`) antes de revisar.
- Zonas horarias: lista cerrada de identificadores IANA de México con nombres conocidos (Centro, Sureste, Pacífico, Sonora, Noroeste, Chihuahua, Ciudad Juárez); Centro por defecto.
- Al crearla, la persona ya es titular: se le envía a activar la verificación en dos pasos antes de usar la app.

## Empresa activa (PLT-11)

- La empresa de trabajo se guarda en la **fila de la sesión** (`session.activeOrganizationId`, se pone en nulo si la empresa se borra), no en una cookie que el navegador pueda cambiar.
- `requireOrganizationContext()` revisa en **cada petición** que la membresía siga activa. Si no, usa la membresía activa más antigua (y la guarda en la sesión); sin ninguna, manda a `/crear-empresa`. Devuelve `organization` (id, nombre, zona horaria, moneda, `isOwner`), la única fuente de `organization_id` para el código de negocio.
- `switchOrganization` solo cambia a una empresa con membresía activa, y solo la sesión propia; «no existe» y «no eres miembro» reciben la misma respuesta. Al cambiar se vuelve a pintar todo (layout incluido) y se empieza en Inventario.
- La interfaz muestra la empresa activa en la barra lateral y en «Más»; el selector aparece solo con dos o más empresas.

## Acceso a datos por empresa (PLT-12)

- El código de negocio usa `forOrganization(organizationId)` (`src/server/tenant-db.ts`), una extensión de Prisma que agrega `organizationId` a todo filtro de lectura, actualización y borrado, exige que cada alta traiga el `organizationId` de la empresa activa (los tipos lo piden explícito), impide mover un registro a otra empresa y rechaza modelos sin `organizationId` y SQL directo (también dentro de transacciones). Sin id de empresa no hay cliente: «Consulta de negocio sin contexto de empresa».
- `TENANT_MODELS` lista los modelos con `organizationId`; una prueba lee `prisma/schema.prisma` y falla si una tabla nueva con esa columna no está registrada (denegar por defecto).
- ESLint prohíbe importar el cliente sin filtro (`db`, `@/server/db`, el cliente generado) en `src/modules/*`, `platform/catalog` y `platform/contacts`; `npm run lint:boundaries` lo demuestra.
- Las escrituras anidadas por relaciones no se reescriben: las llaves compuestas por empresa (PLT-13) harán que la base rechace mezclar empresas.
- Alternativa descartada por ahora: seguridad por filas en la base (MySQL no la tiene nativa; vistas por empresa complicarían Prisma).

## Relaciones compuestas y unicidad por empresa (PLT-13)

- Toda tabla de empresa declara `@@unique([organizationId, id])` y toda relación hacia otra tabla de empresa es **compuesta**: `fields: [organizationId, xId], references: [organizationId, id]`. MySQL rechaza unir filas de empresas distintas aunque se salte la aplicación (SQL directo incluido).
- Solo tablas de empresa pueden apuntar a tablas de empresa. Las reglas de negocio de unicidad se declaran por empresa (por ejemplo `@@unique([organizationId, sku])`).
- `src/server/tenant-db.test.ts` revisa `schema.prisma` en cada corrida: registro en `TENANT_MODELS`, `@@unique([organizationId, id])` y relaciones compuestas que empiezan por `organizationId`.
- Primera tabla con el patrón: `MembershipRole` (roles de un miembro; los valores llegan con USR-01 tras aprobar FUN-07).

## Batería de aislamiento (PLT-15)

- `tests/isolation/two-companies.int.test.ts`: con dos empresas con datos en cada tabla de `TENANT_MODELS`, la empresa A nunca ve filas ni bitácora de B; cambiar ids (empresa, sesión ajena) no cambia nada; una sesión manipulada que apunte a B se revalida y regresa a A.
- `tests/isolation/server-actions.int.test.ts`: registro de **todas** las Server Actions con qué reciben, de dónde sale la identidad y qué prueba cubre el caso entre cuentas/empresas. Una acción nueva hace fallar la prueba hasta revisarla.

## Alternativas consideradas

- **Crear la empresa dentro del registro**: un formulario más largo antes de confirmar el correo y empresas huérfanas de cuentas nunca verificadas.
- **Varias empresas por cuenta desde el inicio**: queda abierto (pregunta al fundador sobre administrar varias empresas); el cambio de empresa activa (PLT-11) ya revalida la membresía, así que permitirlo después solo relaja la regla de `createOrganization`.

## Consecuencias

- Las invitaciones (USR-04/05) agregan membresías a una empresa existente sin pasar por esta pantalla.
- La auditoría del alta se agrega con la bitácora (PLT-14).
