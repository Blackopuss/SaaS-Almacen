# ADR 0002 — Base de datos y acceso a datos

Fecha: 2026-10-02 · Estado: aceptada · Pasos: BAS-03, BAS-05, BAS-06, BAS-07

## Contexto

El fundador eligió MySQL, en la versión que ya usa (9.4). El inventario exige transacciones, decimales exactos y aislamiento por empresa.

## Decisión

- **MySQL 9.4** local y como objetivo; InnoDB, `utf8mb4`.
- **Prisma 7.10.0** con `@prisma/adapter-mariadb` 7.10.0. Migraciones versionadas en `prisma/migrations`.
- **Mínimo privilegio**: la aplicación usa `almacen_app` (solo SELECT/INSERT/UPDATE/DELETE); la CLI de Prisma usa `almacen_migrator` (DDL). `root` solo crea bases y usuarios locales (`npm run db:setup`).
- **IDs UUIDv7** en `CHAR(36)` generados por la app (`src/lib/ids.ts`): ordenados por tiempo para inserciones secuenciales en el índice primario.
- **Decimales exactos** con `decimal.js` (`src/lib/decimal.ts`); nunca `number` para cantidades o dinero.
- **Fechas** en UTC con milisegundos (`DATETIME(3)`), mostradas en `America/Mexico_City`.
- Pruebas de integración siempre contra `almacen_test`, con candado por nombre.

## Seguridad de dependencias

Prisma 7.10 fija versiones vulnerables de `mariadb` (3.4.5), `mysql2` (3.15.3) y `deepmerge-ts` (7.1.5). Se fuerzan versiones corregidas con `overrides` (`mariadb` 3.4.7, `mysql2` 3.24.5, `deepmerge-ts` 8.0.2); `npm audit` en 0. Revisar al actualizar Prisma y quitar los `overrides` cuando ya no hagan falta.

## Alternativas consideradas

- Drizzle ORM: más cercano a SQL, pero Prisma ofrece migraciones y tipos maduros, y Better Auth lo soporta directamente.
- Prisma 6 (motor Rust sin adaptador): evita el driver `mariadb`, pero es la versión anterior; se prefirió 7 con `overrides`.
- PostgreSQL: técnicamente adecuado, pero el fundador eligió MySQL.

## Consecuencias

- `prisma migrate reset` (`npm run db:reset`) borra datos y requiere consentimiento explícito del fundador.
- Bloqueos y concurrencia de inventario (INV-20) pueden requerir SQL controlado dentro de transacciones.
