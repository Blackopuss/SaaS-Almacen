# ADR 0003 — Autenticación

Fecha: 2026-10-02 · Estado: aceptada tras prueba técnica · Pasos: BAS-04, BAS-05

## Contexto

Se necesita registro con correo y contraseña, sesiones revocables, verificación de correo, recuperación, límites de intentos y MFA (PLT-02..PLT-09), con datos en nuestra propia base MySQL.

## Prueba técnica (BAS-04)

Better Auth 1.7.7 con el adaptador de Prisma sobre MySQL 9.4:

- Registro, sesión por cookie, inicio con contraseña incorrecta rechazado, correo duplicado y contraseñas cortas rechazados, cierre de sesión que invalida la sesión: `tests/platform/auth.int.test.ts`.
- Ruta HTTP `/api/auth/*` vía Next: registro 200, cookie `HttpOnly`, petición con `Origin` ajeno rechazada con 403.
- IDs UUIDv7 propios (`advanced.database.generateId`), contraseña almacenada con hash, telemetría desactivada explícitamente.
- Mantenimiento: última versión publicada el 2026-09-30; `npm audit` sin hallazgos.

## Decisión

Usar **Better Auth 1.7.7** (versión exacta) en `src/platform/auth`. Tablas `user`, `session`, `account`, `verification` (migración `auth_core`). Contraseñas de 12 a 128 caracteres.

## Alternativa anotada

- **Auth.js (NextAuth)**: maduro, pero el flujo de credenciales y MFA es menos completo y requiere más código propio.
- **Proveedor administrado (Clerk, Auth0, Cognito)**: menos código de seguridad propio, pero costo por usuario activo, datos de identidad fuera de nuestra base y dependencia del proveedor. Es el plan B si Better Auth deja de mantenerse o falla una revisión de seguridad.

## Consecuencias

- Revisar avisos de seguridad de Better Auth en cada actualización (ASVS, PLT-16).
- El CLI `@better-auth/cli` está obsoleto; el esquema se mantiene a mano en `prisma/schema.prisma` y lo valida la prueba de integración.
- Pendiente en PLT: verificación de correo obligatoria, límites de intentos, recuperación y MFA.
