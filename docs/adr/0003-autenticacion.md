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
- **El intento se aparta antes de verificar** (auditoría de seguridad 1): `reserveAttempt` cuenta el intento y decide en una transacción corta con candado (`SELECT … FOR UPDATE` + incremento) **antes** de comprobar contraseña o código; después, `settleFailure` bloquea si el intento falló y llegó al tope, y `refundAttempt` devuelve lo que no fue un intento de adivinar (inicio de sesión correcto, error del servidor). Antes se leía el bloqueo, se verificaba y se contaba al final: 20 contraseñas enviadas a la vez se evaluaban todas contra un tope de 5. Todo flujo nuevo usa `reserveAttempt`; `blockedFor`/`recordAttempt` quedan solo para compatibilidad. El código TOTP de un solo uso se reclama igual, en un solo paso.
- Registro: además de 10 por IP, 3 por correo por hora (cada registro con un correo ocupado le manda un aviso al dueño).
- **IP del cliente:** los proxys agregan la dirección que vieron al final de `X-Forwarded-For`, después de lo que escribió el cliente. Se toma la entrada que está `TRUSTED_PROXY_HOPS` lugares desde el final (1 por omisión: un proxy delante). Tomar la primera dejaba que cualquiera eligiera su IP. **Requisito de despliegue:** la app no se expone directo a internet (sin proxy, el cliente escribe la cabecera completa) y `TRUSTED_PROXY_HOPS` coincide con los proxys reales (CDN + nginx = 2).
- Pendiente: limpieza periódica de contadores viejos con el worker (IMP-01).

## Recuperación de contraseña (PLT-07)

- Endpoints de Better Auth llamados desde Server Actions (`src/platform/auth/recovery.ts`). El enlace del correo pasa por `/api/auth/reset-password/:token`, que valida el token y redirige a `/restablecer-contrasena?token=…` o `?error=INVALID_TOKEN`.
- Token aleatorio de un solo uso (se consume al restablecer) que vence en 60 minutos (`RESET_PASSWORD_MINUTES`).
- Misma respuesta exista o no el correo. Límite propio: 3 solicitudes por correo y 10 por IP cada 15 min; `rateLimit` HTTP también para `/request-password-reset`, `/reset-password` y `/reset-password/*`.
- Al restablecer: la contraseña nueva sigue la política del registro (`newPasswordSchema`) y se guarda con el scrypt propio; se cierran **todas** las sesiones de la cuenta (`revokeSessionsOnPasswordReset`), se limpia el bloqueo de inicio de sesión de la cuenta, se marca el correo como verificado (el enlace demostró control del buzón) y se avisa por correo del cambio.
- La página del enlace usa `referrer: no-referrer` para que el token de la URL no viaje a otros sitios.

## MFA con app de autenticación (PLT-08A)

- Complemento `twoFactor` de Better Auth (tabla `twoFactor`, campo `user.twoFactorEnabled`). TOTP de 6 dígitos cada 30 s, emisor «Almacén». El secreto y los códigos de respaldo se guardan cifrados con `BETTER_AUTH_SECRET` (rotar ese secreto invalida los secretos de MFA existentes).
- Alta en dos pasos (`src/platform/auth/mfa.ts`): (1) se pide la contraseña otra vez y se crea un secreto **inactivo** (`verified = false`); (2) la MFA se activa solo al confirmar el primer código de la app. Al activarla Better Auth crea una sesión nueva y borra la anterior (sin fijación de sesión) y se avisa por correo.
- Límite por usuario: 5 contraseñas o códigos incorrectos en 15 min bloquean el alta 15 min; una contraseña correcta reinicia la cuenta (quien la sabe no gana nada adivinando el código del alta). Además el `rateLimit` del complemento para `/two-factor/*`.
- No se ofrece «confiar en este dispositivo»: con MFA activa se pedirá el código en cada inicio de sesión (PLT-08B).
- Hallazgo: tras una Server Action que cambia la cookie de sesión, `headers()` conserva la cookie original y la pantalla se re-renderizaba sin sesión. `getCurrentSession` arma la cabecera `cookie` desde `cookies()`, que sí refleja lo escrito en la acción.

## Desafío MFA al iniciar sesión y MFA obligatoria (PLT-08B)

- Con MFA activa, la contraseña correcta **no crea sesión**: Better Auth borra la que creó y deja una cookie firmada de desafío (10 min). La sesión nace solo al validar el código en `/verificar-codigo` (`verifySignInCode`).
- Límites del código: 5 intentos por desafío y bloqueo de la cuenta 15 min tras 10 fallos seguidos (Better Auth), más 20 fallos por IP cada 15 min (propio).
- **Un solo uso** (ASVS): Better Auth acepta el paso actual ± 1 y no impide repetir un código. Se registra cada código aceptado por usuario durante 90 s; si se repite, se borra la sesión recién creada y se pide iniciar sesión de nuevo.
- **Obligatoria** para el titular de cualquier empresa y, desde USR-01, para todo administrador con membresía activa (`isMfaRequired`, `src/platform/auth/mfa-policy.ts`). `requireSession()` envía a `/activa-dos-pasos` a quien la necesita y no la tiene; solo esa pantalla y su acción usan `allowMissingMfa`. Pendiente: personal de plataforma (MOD-09).
- Restablecer la contraseña no desactiva la MFA (la recuperación no la elude).

## Confirmar el correo con enlace y contraseña (auditorías de seguridad 1 y 2)

- **Hallazgo (bajo, corregido):** cualquiera puede registrar el correo de otra persona con una contraseña que solo él conoce. Con `autoSignInAfterVerification: true`, el dueño del buzón que abría el enlace entraba a una cuenta cuya contraseña sabía un extraño; si después aceptaba una invitación con un rol sin MFA obligatoria, el extraño entraba a esa empresa con su contraseña (reproducido en `almacen_test`).
- Primera corrección (auditoría 1): el enlace ya no inicia sesión (`autoSignInAfterVerification: false`).
- **Residuo (auditoría 2, corregido):** con solo eso, el dueño del buzón todavía confirmaba la cuenta del extraño al abrir el enlace. El extraño podía entrar con su contraseña, crear una empresa y activar su propia MFA; restablecer la contraseña no quitaba ese segundo factor y el dueño quedaba fuera de su propio correo. Además, `sendOnSignIn` mandaba un enlace en cada intento de inicio de sesión sobre una cuenta sin verificar, sin límite (25 intentos = 25 correos).
- Corrección final: **confirmar el correo exige el enlace y la contraseña.** El enlace lleva a `/confirmar-correo`, que guarda el token en una cookie `httpOnly` de ese navegador (24 h) y manda a `/ingresar`; `signIn` confirma el correo (`auth.api.verifyEmail`) solo si en ese navegador se escribe la contraseña correcta y el token es de ese mismo correo. `GET /api/auth/verify-email` salió de la lista de permitidos. Quien tiene el buzón pero no la contraseña que eligió un extraño nunca activa esa cuenta: la recupera, y `onPasswordReset` la confirma con su contraseña nueva; el extraño nunca tuvo sesión. `sendOnSignIn: false`: el reenvío pasa por `resendVerification` (3 por correo y 10 por IP cada 15 min). Pruebas: `auth.int.test.ts`, `http-surface.int.test.ts`, `http.test.ts`.
- Cuenta demo local: es titular, así que `db:seed` le activa MFA con `DEMO_TOTP_SECRET` (cifrado como lo hace Better Auth) y `npm run demo:codigo` muestra el código. `verify:ui` calcula códigos nuevos por paso de 30 s.

## Códigos de recuperación y desactivación (PLT-09)

- 10 códigos de un solo uso con formato `xxxxx-xxxxx` (minúsculas y dígitos sin caracteres confundibles; generador propio en `backup-codes.ts` porque Better Auth los compara exactos y por defecto mezcla mayúsculas). Se normaliza lo escrito (mayúsculas, espacios, sin guion). Guardados cifrados.
- Se muestran **una sola vez**: al terminar la activación (paso obligatorio «Ya guardé mis códigos») y al generar nuevos en Configuración (pide la contraseña; los anteriores dejan de servir; aviso por correo).
- Entrar con un código de recuperación usa **el mismo desafío** que el código de la app: requiere contraseña, cuenta los mismos 5 intentos por desafío, el bloqueo de cuenta y el límite por IP. Se avisa por correo con los códigos que quedan. Usarlo no desactiva la MFA.
- Desactivar exige contraseña y un código vigente (de la app o de recuperación), está prohibido cuando la MFA es obligatoria (titulares) y avisa por correo. Better Auth borra el secreto y rota la sesión.
- Si alguien pierde teléfono y códigos, no hay salida automática: la recuperación de la cuenta será un proceso de soporte con verificación de identidad (pendiente de definir con el fundador).
- Hallazgo: cuando una acción cambia la cookie de sesión, Next vuelve a pintar la pantalla y desmonta el diálogo que la llamó; los avisos de éxito se muestran desde el panel que permanece montado.

## Superficie HTTP de Better Auth (PLT-15)

- **Hallazgo alto (corregido):** Better Auth publica sus endpoints en `/api/auth/*` aunque la app no los use. Un titular con sesión podía desactivar la MFA con solo la contraseña (`POST /two-factor/disable`), saltándose «obligatoria para titulares» y «contraseña + código»; también se podía iniciar sesión sin el límite por cuenta, listar sesiones o cambiar el perfil por HTTP.
- Corrección: **lista de permitidos** en `src/platform/auth/http.ts` (`handleAuthRequest`). Por HTTP solo llega el enlace de restablecimiento (`GET /reset-password/<token>`); `GET /verify-email` se cerró en la auditoría 2 (el correo se confirma con enlace + contraseña en `/confirmar-correo`); todo lo demás responde 404. Las Server Actions llaman `auth.api` directamente y no pasan por esa ruta. Endpoints nuevos de futuras versiones quedan cerrados hasta revisarlos.
- Pruebas: `tests/isolation/http-surface.int.test.ts` (14 rutas sensibles cerradas, enlaces de correo funcionando) y `src/platform/auth/http.test.ts` (trucos de ruta).

## Requisitos de producción (revisar en BAS-09..BAS-11 y PIL-01)

Lista única de lo que la autenticación necesita al salir de la máquina local:

1. **Proveedor de correo real** (`MAIL_DRIVER=smtp`, ADR 0023; probar con `npm run correo:prueba`): sin él la app no arranca en producción; verificación, recuperación y avisos de seguridad dependen del correo. Con `BETTER_AUTH_URL` en `https://`, `log` y `memory` se rechazan (dejarían enlaces de restablecimiento en los registros).
2. **Reloj del servidor sincronizado (NTP)**: los códigos de la app de autenticación se aceptan solo en el paso actual ± 30 s; un reloj desfasado rechazaría códigos válidos.
3. **`BETTER_AUTH_SECRET` en el gestor de secretos, con respaldo y sin rotarlo a la ligera**: cifra los secretos TOTP y los códigos de recuperación. Perderlo o cambiarlo deja sin acceso a toda cuenta con MFA. Una rotación necesita un plan (secretos versionados de Better Auth o re-cifrado).
4. **HTTPS** (cookies `Secure` con prefijo `__Secure-` se activan solas con `NODE_ENV=production`) y **proxy delante, con `TRUSTED_PROXY_HOPS`** igual al número de proxys (límites por IP).
5. **Respaldos de MySQL cifrados**: incluyen sesiones, contraseñas con hash y secretos MFA cifrados.
6. **`log_bin_trust_function_creators = 1`** en el servidor MySQL (o privilegio equivalente) para que las migraciones creen los disparadores de la bitácora (ADR 0006); sin él la migración `audit_log` falla con el error 1419.
7. **Origen de Server Actions**: si la app queda detrás de un dominio o proxy distinto, configurar `serverActions.allowedOrigins`; Next rechaza las acciones de otro origen (falla cerrado).
8. **Revisar `docs/seguridad/REVISION_PLT.md`**: hallazgos pendientes (CSP de scripts con nonce) antes del piloto.
9. **Sin cuenta demo**: `db:seed` solo corre en bases `*_dev`; `DEMO_PASSWORD` y `DEMO_TOTP_SECRET` no existen en producción.
10. **`BETTER_AUTH_URL` obligatoria**: al servir en producción la app no arranca sin ella, y fuera de `localhost` debe ser `https://` (si faltara, Better Auth armaría los enlaces de los correos con la cabecera `Host`, que escribe cualquiera).

## Pendientes y decisiones abiertas

- **Persona que pierde teléfono y códigos de recuperación** (decisión del fundador): definir proceso de soporte con verificación de identidad, quién autoriza y cómo se registra; después, herramienta interna con bitácora (PLT-14).
- **MFA obligatoria para personal de plataforma**: agregar en `isMfaRequired` al crear ese rol (MOD-09). Administradores: hecho en USR-01.
- **Bitácora** (PLT-14): registrar activar/desactivar MFA, uso de código de recuperación y generación de códigos nuevos.
- **Mejoras opcionales evaluadas**: llaves de acceso (passkeys/WebAuthn) recomendadas para una versión posterior; «confiar en este dispositivo» desactivado a propósito (menos seguridad); **SMS descartado** (costo y robo por duplicado de SIM).

## Alternativa anotada

- **Auth.js (NextAuth)**: maduro, pero el flujo de credenciales y MFA es menos completo y requiere más código propio.
- **Proveedor administrado (Clerk, Auth0, Cognito)**: menos código de seguridad propio, pero costo por usuario activo, datos de identidad fuera de nuestra base y dependencia del proveedor. Es el plan B si Better Auth deja de mantenerse o falla una revisión de seguridad.

## Consecuencias

- Revisar avisos de seguridad de Better Auth en cada actualización (ASVS, PLT-16).
- El CLI `@better-auth/cli` está obsoleto; el esquema se mantiene a mano en `prisma/schema.prisma` y lo valida la prueba de integración.
- Pendiente en PLT: MFA (PLT-08A..PLT-09).
