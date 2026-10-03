# ADR 0006 — Bitácora de auditoría

Fecha: 2026-10-03 · Estado: aceptada · Pasos: PLT-14 (base para USR-11, INV-24, MOD-09)

## Contexto

Los cambios sensibles (empresa, equipo, inventario, cobro y seguridad de la cuenta) deben dejar registro de quién, qué, en qué empresa y por qué, sin guardar secretos, y ese registro no debe poder alterarse después.

## Decisión

- **Dos tablas** en `src/platform/audit`:
  - `audit_event` (por empresa, en `TENANT_MODELS`): `organizationId`, `actorUserId` (nulo si lo hizo el sistema), `action` con puntos (`organization.created`, `inventory.adjustment`), destino (`targetType`, `targetId`), `reason`, `metadata` e IP. Se escribe con `recordAuditEvent(cliente, …)` usando **el mismo cliente o transacción del cambio**: si el cambio falla, no queda registro, y viceversa.
  - `security_event` (por cuenta): inicio de sesión, restablecer contraseña, activar/desactivar MFA, códigos de recuperación, cierre de sesiones. `recordSecurityEvent` nunca rompe la operación que lo llama (si falla, se registra en el log del servidor).
- **Solo agregar**: disparadores de MySQL rechazan `UPDATE` y `DELETE` para todos los usuarios, incluida la aplicación. Borrar la historia de una empresa será un proceso de mantenimiento deliberado que quita los disparadores. `TRUNCATE` (solo el usuario de esquema, en pruebas) no los dispara.
- **Sin secretos**: `sanitizeMetadata` quita claves que parezcan contraseña, token, código, secreto, cookie o llave, recorta textos largos y limita profundidad y tamaño.
- Sin llave foránea al usuario (la historia sobrevive a la cuenta); con llave a la empresa (`RESTRICT`).
- Crear disparadores con el registro binario activo exige `log_bin_trust_function_creators = 1` (lo pone `npm run db:setup`; en un MySQL administrado es un parámetro del servidor). Ver «Requisitos de producción» en ADR 0003.

## Alternativas consideradas

- **Permisos por tabla** (quitar `UPDATE`/`DELETE` al usuario de la app solo en la bitácora): MySQL no permite revocar a nivel tabla lo concedido a nivel base; habría que conceder tabla por tabla.
- **Registro en archivos o servicio externo**: más difícil de consultar por empresa y de mantener atómico con el cambio.

## Consecuencias

- Las empresas de prueba creadas en `almacen_dev` ya no se pueden borrar desde la aplicación (su registro de alta lo impide). Las verificaciones manuales deben evitar crear empresas o aceptar que queden.
- USR-11 (pantalla de auditoría de equipo) usa `listAuditEvents(forOrganization(id))`.
