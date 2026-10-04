<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# SaaS-Almacen — reglas del proyecto

Contexto compartido por Claude Code y Codex. Leer antes de trabajar:

- `MEMORY.md`: decisiones confirmadas del fundador y estado real.
- `docs/PLAN_IMPLEMENTACION.md`: plan v0.6. Trabajar **un paso a la vez** (IDs como `BAS-01`, `INV-17`) y cerrar cada paso solo con su criterio «Listo cuando» verificado.

## Stack

- Next.js (App Router) + React + TypeScript estricto, `src/` como raíz de código, alias `@/*`.
- Tailwind CSS v4, shadcn/ui (BAS-12) y `motion` (Framer Motion) para animación. Respetar `prefers-reduced-motion`.
- MySQL 9.4 local (la misma versión que usará el fundador) con Prisma (BAS-03).
- npm como gestor de paquetes. Node >= 24.

## Reglas

- Interfaz en español (México). Código e identificadores en inglés; documentación y mensajes de commit en español.
- Las reglas de negocio viven en servicios de `src/modules/*` o `src/platform/*`, nunca en componentes.
- Cada consulta de negocio lleva contexto de empresa (`organization_id`): se hace con `forOrganization(ctx.organization.id)` de `@/server` (PLT-12), nunca con `db`. Toda tabla nueva con `organizationId` se agrega a `TENANT_MODELS`.
- Cantidades y dinero con decimal exacto; nunca `number` de punto flotante para stock o importes.
- Secretos solo en `.env.local` (ignorado por git). Plantilla sin secretos en `.env.example`.
- Antes de cerrar un paso: `npm run check` y `npm run build` deben pasar.
- Para UI usar las skills `ui-ux-pro-max` (diseño) y `web-design-guidelines` (revisión).

## Arquitectura (BAS-02)

```text
src/
  app/          Rutas y pantallas. Usa módulos y plataforma solo por su index.ts.
  components/   Componentes visuales compartidos.
  lib/          Utilidades sin reglas de negocio.
  server/       Infraestructura: cliente de base de datos y transacciones.
  platform/*    Núcleo compartido: auth, tenancy, authorization, entitlements, billing, audit, email, jobs, contacts, catalog.
  modules/*     Módulos contratables: inventory, purchasing (luego sales, crm).
```

| Desde | Puede importar |
| --- | --- |
| app | module, platform y lib (solo `index.ts`); components |
| module | otros module, platform y lib (solo `index.ts`); server; components |
| platform | otra platform y lib (solo `index.ts`); server. **Nunca** módulos |
| server, components | lib (`index.ts`) |

Dentro de un mismo módulo o área se usan imports relativos libremente. `eslint-plugin-boundaries` lo impone y `npm run lint:boundaries` lo demuestra con casos temporales.

## Base de datos (BAS-03)

- Prisma 7.10 (versiones exactas) con `@prisma/adapter-mariadb`. Cliente generado en `src/server/generated/` (ignorado; se genera en `postinstall`). `npm overrides` fuerza versiones corregidas de `mariadb`, `mysql2` y `deepmerge-ts`.
- Usuarios: `almacen_app` (solo SELECT/INSERT/UPDATE/DELETE, lo usa la aplicación en `src/server/db.ts`) y `almacen_migrator` (DDL, lo usa la CLI de Prisma vía `prisma.config.ts`). `root` solo para `npm run db:setup`.
- Bases: `almacen_dev`, `almacen_test`, `almacen_shadow`.
- Comandos: `setup`, `db:setup`, `db:migrate`, `db:deploy`, `db:status`, `db:check`. **`db:reset` borra datos: nunca ejecutarlo sin consentimiento explícito del fundador** (Prisma también lo bloquea para agentes).
- Para operar sobre la base de pruebas: `DATABASE_NAME=almacen_test npm run db:deploy`.
- Si `prisma migrate dev` pide confirmación (no interactivo): crear `prisma/migrations/<UTC>_<nombre>/migration.sql` con `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, revisar el SQL, aplicar con `npm run db:deploy` (y en `almacen_test`) y `npm run db:generate`.

## Pruebas (BAS-07)

- `npm test` corre `unit` (`src/**/*.test.ts`) e `integration` (`*.int.test.ts`). Requiere MySQL local corriendo.
- Una prueba que importe `@/platform/*`, `@/modules/*` o `@/server` (aunque no consulte la base) se llama `*.int.test.ts`: carga el cliente de base de datos y debe correr en el proyecto secuencial. `unit` queda para código puro (`src/lib`, catálogos, reglas). Integración corre en hilos (`pool: "threads"`).
- La integración usa siempre `almacen_test` (nunca dev): migra y vacía tablas al iniciar. Fixtures con DDL usan `migratorConnection()` de `tests/setup/test-db.ts`; el código bajo prueba usa `db` (usuario de la app).

## Sistema visual (BAS-12)

- Fuente de verdad: `design-system/almacen/MASTER.md` (generado con `ui-ux-pro-max`). Estilo Minimal & Swiss, claridad tipo Apple, modo claro por defecto. Tipografía Inter.
- Modo oscuro gris neutro (zinc; azul solo en acciones): clase `dark` en `<html>` aplicada antes de pintar por `THEME_SCRIPT` (layout raíz) y cambiada con `useTheme`/`setTheme` de `src/components/theme.ts` (clave `almacen-tema`, claro por defecto) y el interruptor `ThemeToggle` (barra lateral y encabezado móvil). Todo color nuevo necesita su valor en `:root` y `.dark`.
- Tokens en `src/app/globals.css` (`primary #2563EB`, `success`, `warning`, `destructive`…). Nunca colores sueltos en componentes. Cambiar un token exige que pase `src/components/design-tokens.test.ts` (contraste WCAG: texto ≥ 4.5:1, bordes/anillos ≥ 3:1).
- shadcn/ui (base Radix, preset nova) en `src/components/ui`, ajustado: objetivos táctiles ≥ 44 px en móvil, textos en español, avisos con Sonner (`toast.success/error`).
- Animaciones que dependen de «reducir movimiento» se eligen con CSS (`motion-reduce:`), no con `useReducedMotion`, para que servidor y cliente generen el mismo HTML.
- Animación con `motion` (`src/components/motion.tsx`): presets cortos, salida más rápida que entrada, `reducedMotion="user"`.
- Formularios: `FormField` (etiqueta, ayuda y error enlazados con `aria-describedby`) y `PasswordInput`; Server Actions con `useActionState` y validación Zod en el servicio de `platform`/`modules`.
- `/sistema-visual` (solo desarrollo) muestra los componentes. Con `npm run dev` activo (puerto 3000 por defecto, `UI_BASE_URL` para otro), `npm run verify:ui` comprueba foco visible, diálogo accesible, tamaños táctiles y desbordamiento en móvil y escritorio (Edge instalado).

## Navegación y estados (BAS-13)

- Pantallas de la app en `src/app/(app)/` con `AppShell`: barra lateral en escritorio; en móvil, barra inferior con 4 secciones y «Más». Secciones en `src/components/app-shell/nav.ts`, cada una con su `module` para ocultarla si no está contratado (MOD-05).
- Estados reutilizables en `src/components/states.tsx`: `PageHeader`, `EmptyState`, `ErrorState`, `LoadingState`, `PageContainer`. Cada sección tiene `loading.tsx` y `error.tsx` compartidos.
- No mostrar botones deshabilitados sin explicación; una acción aparece cuando su paso está implementado.

## Autenticación y decisiones (BAS-04/05)

- Better Auth 1.7.7 en `src/platform/auth` (`auth`), ruta `src/app/api/auth/[...all]`. Secreto en `.env.local` (`npm run env:setup`). Telemetría desactivada.
- Seguridad: `docs/seguridad/REVISION_PLT.md`, `REVISION_USR.md` y `REVISION_MOD.md` (amenazas y hallazgos por etapa) y `docs/seguridad/ASVS.md` (matriz); actualizar ambas al cerrar cada etapa. Cabeceras de seguridad en `next.config.ts`.
- Antes de desplegar (BAS-09..11, PIL-01): revisar «Requisitos de producción» y «Pendientes» de `docs/adr/0003-autenticacion.md`.
- Decisiones registradas en `docs/adr/` (stack, base de datos, autenticación, interfaz, empresas, bitácora). Una decisión nueva o un cambio de dependencia importante agrega o actualiza un ADR.
- Sesión: toda pantalla o Server Action protegida llama `requireSession()` (valida contra la base). `src/proxy.ts` solo es una revisión optimista por cookie; agregar ahí cada sección protegida nueva. Cuenta demo local: `npm run db:seed` (credenciales en `.env.local`: `DEMO_EMAIL`, `DEMO_PASSWORD`).
- Límite de intentos: todo flujo de autenticación nuevo (recuperación, MFA…) usa `blockedFor`/`recordAttempt` de `src/platform/auth/throttle.ts`.
- Prisma en desarrollo: `src/server/db.ts` recrea el cliente cuando cambia el código generado; tras una migración no hace falta reiniciar `npm run dev`.
- Correo: `src/platform/email` (`sendEmail` + plantillas en español). `MAIL_DRIVER=memory` en pruebas (`memoryOutboxFor`), `log` en desarrollo (`/correos`). Nunca revelar si un correo tiene cuenta.
- Versiones exactas (`.npmrc` con `save-exact`). Antes de actualizar una dependencia: `npm audit` y revisar su ADR.

## Estado actual (actualizar al cerrar cada paso)

- Rama de trabajo: **`pruebas`** (subida a GitHub `Blackopuss/SaaS-Almacen`; CI en cada push). **No tocar `main`.** Un commit por paso cerrado, mensaje en español, **sin `Co-Authored-By` ni ninguna atribución a IA**.
- Hechos: BAS-01..08, BAS-12, BAS-13; PLT-01..PLT-16 (etapa PLT completa); USR-01, USR-02, USR-03A, USR-03B, USR-04, USR-05, USR-06, USR-07, USR-08, USR-09, USR-10, USR-11, MOD-01, MOD-02, MOD-03, MOD-04, MOD-05, MOD-06, MOD-07, MOD-08, MOD-09, MOD-10, MOD-11, INV-01, INV-02, INV-03, INV-04, INV-05, INV-06, INV-07. FUN-07 aprobada por el fundador. Pospuestos por el fundador: BAS-09..11 (servidor en internet; todo corre local). FUN-01..08 son del fundador.
- Avance: 57 de 148 pasos hasta el lanzamiento limitado (PIL-17). **Siguiente: INV-08 (versiones del factor de presentación)**.
- Detalle de decisiones e historial: `MEMORY.md` y `docs/adr/`.

## Convenciones de código

- **Servicios** en `src/platform/*` o `src/modules/*`, con `import "server-only"`. Reciben datos ya separados (`input`, `headers`) y devuelven uniones de resultado para fallos esperados (`{ ok: true } | { ok: false; reason/fieldErrors }`); lanzan solo ante lo inesperado (`AppError` y subclases de `src/lib/errors.ts`, o `console.error` + respuesta genérica).
- **Validación** con Zod en el servicio; mensajes en español listos para mostrar.
- **Pantallas**: Server Component que llama `requireSession()` + componente cliente con `useActionState`; acción en `actions.ts` con `"use server"` que solo traduce `FormData` ↔ servicio y hace `redirect`/`revalidatePath`.
- **Pruebas**: unitarias junto al código (`*.test.ts`); integración en `tests/<área>/*.int.test.ts` contra `almacen_test`, con correos únicos por corrida (`algo.${Date.now()}@example.test`) y `afterAll(() => db.$disconnect())`. Pruebas lentas por scrypt: dar `timeout` explícito. Comportamiento visible: agregar casos a `scripts/verify-ui.mjs` (no crear datos persistentes salvo la cuenta demo; usar IPs de prueba con `X-Forwarded-For`).
- **IDs** UUIDv7 (`newId`), fechas `DATETIME(3)` UTC, cantidades con `Decimal`.
- **Verificación manual en navegador sin tocar desarrollo:** `npm run dev:test` levanta la app en `http://localhost:3100` contra `almacen_test` y `npm run test:company -- "<contraseña>" [rol]` crea ahí una empresa con plan y una cuenta para entrar. Esa base se vacía en cada `npm test`, así que no hay que limpiar nada; úsalo siempre que el flujo cree filas que ya no se pueden borrar (bitácora, versiones de presentación, movimientos).
- **Datos de prueba creados en `almacen_dev`** durante verificaciones manuales: borrarlos al terminar. Excepción: la bitácora es solo-agregar (ADR 0006), así que una empresa creada en dev ya no se puede borrar; evitar crear empresas en verificaciones manuales.
- **Server Action nueva (PLT-15):** agregarla a `REVIEWED` en `tests/isolation/server-actions.int.test.ts` (qué recibe, de dónde sale la identidad, qué prueba cubre el caso entre empresas); la prueba falla si falta. Nunca tomar `userId` u `organizationId` del cliente: salen de `requireSession`/`requireOrganizationContext`.
- **Better Auth por HTTP (PLT-15):** solo los enlaces de correo pasan por `/api/auth/*` (lista de permitidos en `src/platform/auth/http.ts`). Los flujos nuevos se hacen con Server Actions + `auth.api`; un enlace de correo nuevo se agrega a la lista con su prueba.
- **Roles y permisos (USR-01):** la matriz aprobada `docs/MATRIZ_ROLES_PERMISOS.md` es la fuente de verdad; el catálogo está en `src/platform/authorization/catalog.ts` y `catalog.test.ts` falla si no coinciden. Cambiar un permiso = cambiar ambos (y una migración si se agrega un rol: `CHECK` en `membership_role`). El titular no es un rol.
- **Autorización (USR-02):** una sola decisión, `can(subject, permission)` de `src/platform/authorization/policy.ts` (pura, denegar por defecto). En servidor: `requirePermission("modulo.recurso.accion")` (sesión + empresa + permiso; lanza `ForbiddenError`) o `getAccess()` para preguntar `access.can(...)`; en servicios, `assertAllowed(organizationId, userId, permission)`. Los roles se leen de la base en cada petición; sin membresía activa no hay permisos, ni para el titular.
- **Reservado al titular (USR-03A):** contratar, cancelar, método de pago, cambiar plan/módulos y transferir usan `requireOwnerAction(permiso)` / `assertOwnerAction(organizationId, userId, permiso)`; el permiso debe estar en `OWNER_ONLY_PERMISSIONS` (lo que ningún rol concede).
- **Equipo y titularidad (USR-03B):** todo cambio de roles, desactivación o invitación pasa primero por `checkTeamChange`/`checkInvitationRoles` de `src/platform/authorization/team-rules.ts` (mensajes en `TEAM_RULE_MESSAGES`). `Organization.ownerUserId` solo cambia en `acceptOwnershipTransfer` (`ownership.ts`), con bloqueo `FOR UPDATE` de la empresa.
- **Invitaciones (USR-04):** el token de un enlace nunca se guarda ni se registra: solo `hashInvitationToken(token)`. Se exportaron `blockedFor`/`recordAttempt`/`throttleKeys` desde `@/platform/auth` para limitar flujos fuera de `auth`.
- **Aceptar invitación (USR-05):** el correo de la membresía sale siempre de la invitación, nunca del formulario. Para crear cuentas fuera del registro normal usar `prepareInvitedAccount` + `insertInvitedAccount` dentro de la transacción del llamador.
- **Cambios de equipo (USR-06):** las operaciones sobre miembros pasan por `withTeamChange` de `team.ts` (bloqueo de empresa + reglas + transacción); no escribir `membership_role` desde otro lugar.
- **Pantalla de equipo (USR-08):** acciones en `src/app/(app)/configuracion/equipo/actions.ts`; persona y empresa salen de `requireOrganizationContext()`. Un diálogo que se cierra tras una Server Action lo hace dentro de la acción envuelta en `useActionState` (no con `setState` en un efecto: lo prohíbe ESLint).
- **Pantalla nueva (USR-09):** empieza con `const access = await getAccess(); if (!access.can("…")) return <PageContainer><NoAccessState /></PageContainer>;` y, si va en el menú, lleva el mismo permiso en `nav.ts`. Botones y enlaces de una acción se pintan solo si `access.can(...)`; la Server Action lo comprueba otra vez en su servicio.
- **Casos negativos (USR-10):** al construir algo que menciona un caso `NEG-xx` de la matriz, escribir su prueba y actualizar `NEGATIVE_CASES` en `tests/platform/negative-by-role.int.test.ts` (quitar `waitsFor`, agregar el archivo).
- **Acción de bitácora nueva (USR-11):** agregar su frase en español a `AUDIT_ACTION_LABELS` (`src/platform/audit/trail.ts`); `team-audit.int.test.ts` falla si falta.
- **Módulos (MOD-01/02, ADR 0007):** cada módulo declara su contrato en `src/modules/<módulo>/contract.ts` con `defineModule` y se agrega a `src/modules/registry`; la plataforma nunca importa módulos, recibe ids o contratos.
- **Modelo comercial (MOD-03, ADR 0008):** nunca modificar `plan_version`/`plan_module_price` (la base lo rechaza): crear versión nueva y mover `plan_offer`. Lo que una empresa puede usar se lee de `entitlement`, no de la suscripción.
- **Derechos (MOD-04):** quien escriba en `entitlement` llama `invalidateEntitlements(organizationId)` después de confirmar; para decidir cupos usar `getFreshEntitlements`.
- **Guard de módulo (MOD-05):** pantallas de un módulo empiezan con `const access = await getModuleAccess()` y comprueban `access.can("…")` y `access.hasModule("…")`; los servicios de módulo llaman `assertModulePermission(organizationId, userId, permiso)`; las altas que consumen cupo llaman además `assertWithinLimit`.
- **Activar módulos (MOD-06):** solo con `activateModule`/`deactivateModule` pasando `moduleRegistry` de `@/modules/registry`; nunca escribir derechos de módulo a mano fuera de pruebas y del sembrado de desarrollo.
- **Cupos (MOD-07):** toda alta o reactivación que consuma un límite llama `consumeQuota(tx, organizationId, "active_products")` dentro de su misma transacción y aborta si `ok` es falso; archivar llama `releaseQuota`. Nunca contar filas para decidir si cabe.
- **Transacciones (MOD-08):** dentro de una transacción no usar `db`, `forOrganization` ni servicios que abran otra conexión (p. ej. `getEntitlements`): todo con el cliente `tx`. Para límites, `readLimit(tx, organizationId, clave)`. Todo lo que sume una persona a una empresa llama `lockOrganization` + `assertSeatAvailable` en su transacción.
- **Consola interna (MOD-09, ADR 0009):** toda pantalla y acción bajo `src/app/interno` empieza con `requirePlatformStaff()`; los servicios que actúan sobre cualquier empresa vuelven a comprobar `isPlatformStaff`. Formularios con `useActionState`: devolver `values` al rechazar para no perder lo escrito.
- **Solo lectura (MOD-11):** un permiso nuevo que no modifica nada debe terminar en `.read` o `.export` (o ser `*.export.create`) para seguir disponible con el plan vencido; cualquier otro se trata como escritura. Pantallas de módulo: `access.moduleState(...)` → `none` muestra `NoModuleState`, `read_only` muestra `ReadOnlyNotice` y oculta las acciones de escritura.
- **Productos (INV-02):** las altas solo por `createProduct`; el actor (`{ organizationId, userId }`) sale siempre de la sesión. Un fallo esperado dentro de una transacción se saca con una excepción propia (ver `Rejected`) para que todo se revierta, cupo incluido.
- **Unidades (INV-05):** agregar o cambiar una unidad = `UNITS` en código + migración que actualice la tabla `unit`. Una tabla sembrada por migración se agrega a `REFERENCE_TABLES` en `tests/setup/global-db.ts`.
- **Cantidades (INV-06):** toda cantidad capturada pasa por `parseQuantity` con la regla del producto (`unitCode`, `quantityStep`); nunca `Number()` ni redondeos. Componentes cliente no importan `@/platform/*`: las opciones (unidades, precisiones) se arman en el servidor y se pasan como props (ver `unit-options.ts`).
- **Bitácora (PLT-14):** todo cambio sensible de empresa llama `recordAuditEvent(clienteDeLaTransacción, { organizationId, actorUserId, action, target, reason })` dentro de la misma transacción; eventos de cuenta con `recordSecurityEvent`. Nunca pasar secretos en `metadata` (igual se depuran).

## Recuperación de contraseña (PLT-07)

- Servicio en `src/platform/auth/recovery.ts` (`requestPasswordReset`, `resetPassword`); efectos al restablecer en `emailAndPassword.onPasswordReset` de `auth.ts` (limpia bloqueo, confirma correo, avisa por correo). Política de contraseña nueva compartida: `newPasswordSchema` de `register.ts`.
- Pantallas `/recuperar-contrasena` y `/restablecer-contrasena` (`referrer: no-referrer` porque el token va en la URL). Probar el enlace real en `/correos`.

## MFA (PLT-08A..PLT-09)

- Complemento `twoFactor` de Better Auth en `auth.ts`; servicio `src/platform/auth/mfa.ts` (`getMfaStatus`, `startTotpEnrollment`, `confirmTotpEnrollment`); panel `MfaPanel` en `/configuracion`; QR con el componente `QrCode` (`uqr`).
- `getCurrentSession` toma la cookie de `cookies()` (no de `headers()`) para ver la sesión rotada dentro de la misma Server Action.
- Inicio de sesión con MFA: `signIn` devuelve `reason: "mfa"` → `/verificar-codigo` (`verifySignInCode`; cada código sirve una vez). MFA obligatoria según `isMfaRequired` (`mfa-policy.ts`, hoy: titulares; agregar administradores y personal de plataforma cuando existan). `requireSession()` redirige a `/activa-dos-pasos`; solo esa pantalla y `mfaSetupAction` pasan `allowMissingMfa`.
- Cuenta demo: MFA activa con `DEMO_TOTP_SECRET` (`npm run db:seed`); código con `npm run demo:codigo`; helpers en `scripts/totp.mjs`. `verify:ui` entra calculando códigos nuevos (por eso tarda ≈2.5 min).
- Códigos de recuperación (PLT-09): generador y normalización en `backup-codes.ts`; `regenerateBackupCodes` y `disableMfa` en `mfa-recovery.ts`; `verifySignInCode({ method: "backup" })`. Se muestran una sola vez con `BackupCodesList`. Desactivar está prohibido si `isMfaRequired`.
- Si una Server Action cambia la cookie de sesión, Next vuelve a pintar la pantalla: el aviso de éxito va en un componente que siga montado (ver `MfaPanel`).

## Empresas (PLT-10/11)

- `src/platform/tenancy`: `createOrganization` (empresa + membresía titular en una transacción, una empresa por cuenta), `hasOrganization`, `requireOrganizationContext()` (PLT-11: sesión + empresa activa guardada en `session.activeOrganizationId` y revalidada en cada petición), `switchOrganization`, `listMyOrganizations`. Toda pantalla y acción de negocio en `src/app/(app)/` llama `requireOrganizationContext()` y toma `organization.id` solo de ahí; sin empresa → `/crear-empresa`. Detalle en ADR 0005.
- Trabajo con Codex: tareas independientes en un worktree propio (`git worktree add ../SAAS-Almacen-codex -b codex/<tarea> pruebas`) o revisiones de solo lectura; Claude revisa e integra en `pruebas`.
- **Tabla nueva de empresa (PLT-13):** columna `organizationId` + relación a `Organization`, `@@unique([organizationId, id])`, relaciones a otras tablas de empresa compuestas (`fields: [organizationId, xId], references: [organizationId, id]`), unicidades de negocio por empresa (`@@unique([organizationId, sku])`), registrarla en `TENANT_MODELS` y usarla solo con `forOrganization`. `tenant-db.test.ts` falla si falta algo.
- Selects: `NativeSelect` de `src/components/ui/native-select.tsx` (selector nativo con estilo de `Input`).
