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
- Cada consulta de negocio lleva contexto de empresa (`organization_id`).
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
  platform/*    Núcleo compartido: auth, tenancy, authorization, billing, audit, jobs, contacts, catalog.
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

## Pruebas (BAS-07)

- `npm test` corre `unit` (`src/**/*.test.ts`) e `integration` (`*.int.test.ts`). Requiere MySQL local corriendo.
- La integración usa siempre `almacen_test` (nunca dev): migra y vacía tablas al iniciar. Fixtures con DDL usan `migratorConnection()` de `tests/setup/test-db.ts`; el código bajo prueba usa `db` (usuario de la app).

## Sistema visual (BAS-12)

- Fuente de verdad: `design-system/almacen/MASTER.md` (generado con `ui-ux-pro-max`). Estilo Minimal & Swiss, claridad tipo Apple, modo claro por defecto. Tipografía Inter.
- Modo oscuro gris neutro (zinc; azul solo en acciones) con `next-themes` (clase `dark` en `<html>`, clave `almacen-tema`, claro por defecto) y el interruptor `ThemeToggle` (barra lateral y encabezado móvil). Todo color nuevo necesita su valor en `:root` y `.dark`.
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
- Decisiones registradas en `docs/adr/` (stack, base de datos, autenticación, interfaz). Una decisión nueva o un cambio de dependencia importante agrega o actualiza un ADR.
- Sesión: toda pantalla o Server Action protegida llama `requireSession()` (valida contra la base). `src/proxy.ts` solo es una revisión optimista por cookie; agregar ahí cada sección protegida nueva. Cuenta demo local: `npm run db:seed` (credenciales en `.env.local`: `DEMO_EMAIL`, `DEMO_PASSWORD`).
- Correo: `src/platform/email` (`sendEmail` + plantillas en español). `MAIL_DRIVER=memory` en pruebas (`memoryOutboxFor`), `log` en desarrollo (`/correos`). Nunca revelar si un correo tiene cuenta.
- Versiones exactas (`.npmrc` con `save-exact`). Antes de actualizar una dependencia: `npm audit` y revisar su ADR.
