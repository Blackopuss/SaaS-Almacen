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
- Comandos: `db:setup`, `db:migrate`, `db:deploy`, `db:status`, `db:check`. **`db:reset` borra datos: nunca ejecutarlo sin consentimiento explícito del fundador** (Prisma también lo bloquea para agentes).
- Para operar sobre la base de pruebas: `DATABASE_NAME=almacen_test npm run db:deploy`.
