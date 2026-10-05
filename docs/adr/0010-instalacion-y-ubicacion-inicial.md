# ADR 0010 — Instalación y ubicación inicial

Fecha: 2026-10-04 · Estado: aceptada · Paso: INV-13

## Contexto

Inventario y Compras comparten el espacio físico. Toda empresa debe comenzar con una instalación y su ubicación General, sin contratar un módulo ni pedir permiso de escritura para aprovisionarlas.

## Decisión

- Área `platform/locations`, accesible desde `tenancy` y desde los módulos mediante su `index.ts`. No hay dependencias de plataforma hacia módulos.
- Una instalación por empresa en v1, garantizada por `facility.organizationId` único. Nombre inicial **Principal**: no duplica el nombre comercial ni obliga a sincronizar sus cambios. La clave de idempotencia es la empresa, no el nombre.
- Ambas tablas llevan empresa, UUIDv7 en `CHAR(36)`, fechas UTC y clave única `(organizationId, id)`. La relación ubicación → instalación es compuesta; no admite referencias ajenas. Los nombres usan `utf8mb4_unicode_ci`, como el SKU, y rechazan cadenas vacías o de espacios con `CHECK`.
- `location.isDefault` admite `true` o `NULL`, nunca `false`. El índice único `(organizationId, facilityId, isDefault)` garantiza **como máximo una** ubicación por defecto por instalación sin limitar las futuras ubicaciones ordinarias. Un `CHECK` exige el nombre exacto General para la ubicación por defecto.
- La existencia de **una** General se garantiza en los flujos de alta: `ensureDefaultLocation(tx, organizationId)` bloquea la empresa y aprovisiona instalación y ubicación dentro de la transacción del llamador. Incluye alta normal, sembrado, script de empresa de prueba y fixtures. Las escrituras SQL directas siguen siendo responsabilidad del llamador: no hay un trigger que cree General al insertar una instalación. No se ofrece borrado ni cambio de ubicación por defecto.
- El backfill hace ambas inserciones en una transacción y construye UUIDv7 en SQL (milisegundos Unix, versión 7, variante RFC y aleatoriedad por fila). No usa `UUID()`, que genera UUIDv1. No inventa eventos históricos de usuario.
- No se agrega `parentId` todavía: INV-14 debe introducir juntos la llave compuesta dentro de la misma instalación, la prevención de ciclos y las operaciones de jerarquía. La ubicación ya identifica explícitamente su instalación.
- Lectura con contexto de empresa (`forOrganization`) y `inventory.location.read`, incluyendo comprobación del módulo y modo solo lectura. La pantalla muestra datos persistidos, sin controles de escritura.
- Se conserva el evento existente `organization.created` como auditoría del alta atómica. No se agrega una acción separada por el aprovisionamiento del sistema.

## Consecuencias

La expansión multi-sucursal deberá retirar el índice único de empresa en instalación y definir cómo seleccionar la instalación inicial. INV-14 debe conservar General y no permitir borrarla, renombrarla ni desmarcarla. Los nombres de ubicaciones serán únicos dentro de toda la instalación, independientemente del futuro padre.

Verificado al integrar (2026-10-04): migración aplicada en desarrollo (la empresa existente recibió su instalación y General), pruebas de integración y comprobación en navegador. Los scripts (`db:seed`, `test:company`) importan `@/platform/locations/bootstrap` directamente: el `index.ts` del área arrastra `platform/billing` y con él código de Next que no carga fuera de la aplicación.
