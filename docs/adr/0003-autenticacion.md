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

## Hash de contraseñas (PLT-02)

El scrypt por defecto de Better Auth 1.7.7 usa `N=2^14, r=16, p=1` (32 MiB, una pasada), por debajo de las configuraciones mínimas de OWASP. Se reemplaza con `emailAndPassword.password.{hash,verify}` propios (`src/platform/auth/password.ts`): scrypt `N=2^15, r=8, p=3` (configuración listada por OWASP; 32 MiB por cálculo, adecuada para un servidor pequeño con inicios de sesión concurrentes), sal aleatoria de 16 bytes, comparación en tiempo constante, normalización Unicode NFKC y parámetros guardados en cada hash (`scrypt$N$r$p$sal$hash`) para poder subirlos sin invalidar contraseñas. Se rechazan hashes manipulados con parámetros excesivos.

Política: 12 a 128 caracteres, cualquier carácter, sin reglas de composición, se permite pegar y usar administradores de contraseñas (ASVS 2.1, WCAG 2.2 «Accessible Authentication»).

## Sesiones, cookies y CSRF (PLT-04)

- Sesión de 7 días renovada una vez al día con uso; cookie `HttpOnly`, `SameSite=Lax`, `Path=/` y `Secure` con prefijo `__Secure-` en producción.
- Dos capas: `src/proxy.ts` redirige sin cookie (revisión optimista) y cada pantalla o acción protegida valida la sesión contra la base (`requireSession`), como recomienda la guía de Next 16.
- Hallazgo: Better Auth **desactiva la revisión de origen (CSRF) cuando `NODE_ENV=test`**. Se fija `advanced.disableOriginCheck: false` para que esté activa en todos los entornos y las pruebas verifiquen lo mismo que producción.
- Regreso tras iniciar sesión solo a rutas relativas del mismo sitio (`safeRedirectPath`), sin redirecciones abiertas.
- Correo desconocido y contraseña incorrecta reciben el mismo mensaje.

## Revocación de sesiones (PLT-05)

- `session.cookieCache` desactivado explícitamente: toda petición valida la sesión en MySQL, así que cerrar una sesión surte efecto de inmediato. Activarlo exigiría aceptar hasta 5 minutos de sesiones revocadas aún válidas.
- La lista y el cierre de sesiones usan consultas propias limitadas al usuario (`src/platform/auth/sessions.ts`) en lugar de los endpoints de Better Auth, para que los tokens nunca lleguen al navegador y nadie pueda cerrar sesiones ajenas.

## Límite de intentos (PLT-06)

- El limitador de Better Auth solo actúa en sus rutas HTTP y por defecto solo en producción y en memoria; las pantallas usan Server Actions que lo saltan. Por eso hay dos capas:
  1. **Limitador propio** (`src/platform/auth/throttle.ts`, tabla `auth_throttle`): una sentencia SQL atómica por intento con el reloj de la base. Inicio de sesión: 5 fallos por cuenta y 20 por IP en 15 min bloquean 15 min (la IP tolera más porque una ferretería comparte conexión). Registro: 10 por IP por hora. Reenvío de verificación: 3 por correo y 10 por IP cada 15 min.
  2. **Better Auth `rateLimit`** siempre activo con almacenamiento en MySQL (tabla `rateLimit`) para `/api/auth/*`.
- Los fallos se cuentan por el correo escrito, exista o no; el bloqueo aplica aunque la contraseña sea correcta y nunca revela qué cuentas existen. Los correos se guardan como SHA-256.
- **Requisito de despliegue:** la IP se toma de `X-Forwarded-For`. En producción la app debe estar detrás de un proxy que sobrescriba esa cabecera; si se expone directo, un atacante podría variar la IP y evadir el límite por IP (el límite por cuenta sigue aplicando).
- Pendiente: limpieza periódica de contadores viejos con el worker (IMP-01).

## Recuperación de contraseña (PLT-07)

- Endpoints de Better Auth llamados desde Server Actions (`src/platform/auth/recovery.ts`). El enlace del correo pasa por `/api/auth/reset-password/:token`, que valida el token y redirige a `/restablecer-contrasena?token=…` o `?error=INVALID_TOKEN`.
- Token aleatorio de un solo uso (se consume al restablecer) que vence en 60 minutos (`RESET_PASSWORD_MINUTES`).
- Misma respuesta exista o no el correo. Límite propio: 3 solicitudes por correo y 10 por IP cada 15 min; `rateLimit` HTTP también para `/request-password-reset`, `/reset-password` y `/reset-password/*`.
- Al restablecer: la contraseña nueva sigue la política del registro (`newPasswordSchema`) y se guarda con el scrypt propio; se cierran **todas** las sesiones de la cuenta (`revokeSessionsOnPasswordReset`), se limpia el bloqueo de inicio de sesión de la cuenta, se marca el correo como verificado (el enlace demostró control del buzón) y se avisa por correo del cambio.
- La página del enlace usa `referrer: no-referrer` para que el token de la URL no viaje a otros sitios.

## Alternativa anotada

- **Auth.js (NextAuth)**: maduro, pero el flujo de credenciales y MFA es menos completo y requiere más código propio.
- **Proveedor administrado (Clerk, Auth0, Cognito)**: menos código de seguridad propio, pero costo por usuario activo, datos de identidad fuera de nuestra base y dependencia del proveedor. Es el plan B si Better Auth deja de mantenerse o falla una revisión de seguridad.

## Consecuencias

- Revisar avisos de seguridad de Better Auth en cada actualización (ASVS, PLT-16).
- El CLI `@better-auth/cli` está obsoleto; el esquema se mantiene a mano en `prisma/schema.prisma` y lo valida la prueba de integración.
- Pendiente en PLT: MFA (PLT-08A..PLT-09).
