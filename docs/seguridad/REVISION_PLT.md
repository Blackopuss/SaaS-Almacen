# Revisión de amenazas — etapa PLT (PLT-16)

Fecha: 2026-10-03 · Alcance: PLT-01 a PLT-15 (cuentas, sesiones, MFA, recuperación, empresas, acceso a datos por empresa, bitácora) · Revisor: Claude. Pendiente: segunda revisión independiente de Codex (la primera quedó sin resultados por límite de uso).

## Qué se protege

| Activo | Por qué importa |
| --- | --- |
| Datos de negocio de cada empresa | Inventario, compras y costos de un cliente nunca deben verse desde otra empresa. |
| Cuentas y sesiones | Quien entra con una cuenta ajena opera su inventario. |
| Titularidad | El titular contrata, cancela y paga (USR-03A). |
| Secretos de MFA, contraseñas, tokens de correo | Su fuga permite tomar cuentas. |
| Bitácora | Evidencia de quién cambió qué; no debe poder borrarse. |

## Quién podría atacar y por dónde

- **Externo sin cuenta:** pantallas públicas (`/ingresar`, `/registro`, recuperación), enlaces de correo, `/api/auth/*`, Server Actions (son endpoints HTTP aunque no se vean).
- **Usuario de otra empresa:** con su propia sesión, cambiando identificadores en acciones, URLs o cuerpos.
- **Empleado con menos permisos** (cuando existan roles, USR): intentar acciones de administrador o titular.
- **Quien roba una contraseña o una sesión:** reutilizar cookies, desactivar MFA, cambiar datos de la cuenta.
- **Navegador de la víctima:** CSRF, clickjacking, scripts inyectados.

## Hallazgos

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| PLT16-01 | Alta | Los endpoints HTTP de Better Auth (`/api/auth/*`) quedaban expuestos aunque la app no los usa: un titular con sesión desactivaba la MFA con solo la contraseña, y se podía iniciar sesión sin el límite por cuenta, listar sesiones o cambiar el perfil. | **Corregido en PLT-15:** lista de permitidos (solo enlaces de correo); pruebas en `tests/isolation/http-surface.int.test.ts`. |
| PLT16-02 | Media | Sin cabeceras de seguridad: la app podía mostrarse dentro de otro sitio (clickjacking sobre «Desactivar» o «Cerrar sesiones»), sin `nosniff` ni política de referencia. | **Corregido:** `next.config.ts` con `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `COOP` y HSTS en producción; revisado por `verify:ui`. |
| PLT16-03 | Media | Enumeración por tiempo: pedir recuperación de contraseña (o reenvío de verificación) para una cuenta existente esperaba el envío del correo; para un correo desconocido respondía de inmediato. Con un proveedor real la diferencia es medible. | **Corregido:** los correos de Better Auth salen después de responder (`backgroundTasks` + `after()` de Next). Registro e inicio de sesión ya igualaban el tiempo (hash simulado). |
| PLT16-04 | Media | Falta una política de scripts (CSP con nonce): un XSS futuro podría ejecutar scripts. Hoy no hay HTML de usuario sin escapar (React escapa todo; no se usa `dangerouslySetInnerHTML` salvo el script de tema, constante). | Pendiente: CSP de scripts con nonce antes del piloto (el script de tema y Next requieren nonce por petición). |
| PLT16-05 | Baja | Alta obligatoria de MFA por primera vez (TOFU): quien robe la contraseña de un titular **antes** de que active MFA podría registrar su propia app. | Mitigado: aviso por correo «Activaste la verificación en dos pasos»; el titular lo activa al crear la empresa. Aceptado. |
| PLT16-06 | Baja | Si producción corriera por error con `NODE_ENV` distinto de `production`, `/correos` y `/sistema-visual` quedarían visibles (`/correos` muestra enlaces de correo). | Mitigado: además del `NODE_ENV`, `/correos` solo lee el buzón local del conductor `log`; producción exige un proveedor real. Revisar en BAS-09. |
| PLT16-07 | Baja | Sin cabecera de IP confiable (`X-Forwarded-For` sobrescrito por un proxy), todos los clientes comparten el contador «unknown» y un atacante podría bloquear a todos, o variar la cabecera para evadir el límite por IP. | Requisito de producción documentado (ADR 0003). El límite por cuenta no depende de la IP. |
| PLT16-08 | Informativa | `braces` (dependencia de herramientas de ESLint) con aviso alto de `npm audit`. | No llega a producción (`npm audit --omit=dev` en CI). Revisar al actualizar ESLint. |
| PLT16-09 | Informativa | Server Actions detrás de un dominio o proxy distinto requieren `serverActions.allowedOrigins`; si no, Next rechaza (falla cerrado). | Revisar en BAS-09. |

## Controles revisados sin hallazgos

- Redirecciones: `safeRedirectPath` solo acepta rutas relativas de un solo `/` (sin `//`, `/\`, esquemas ni caracteres de control).
- Sesiones: cookie `HttpOnly`, `SameSite=Lax`, `Secure` en producción; sesión validada en la base en cada petición; nueva sesión al iniciar sesión y al activar MFA; todas cerradas al restablecer contraseña.
- MFA: desafío sin sesión hasta el código; 5 intentos por desafío, bloqueo de cuenta tras 10 fallos, límite por IP; códigos de un solo uso; recuperación por el mismo desafío; desactivar exige contraseña y código y está prohibido para titulares; restablecer contraseña no quita la MFA.
- Empresas: empresa activa en la fila de sesión y revalidada en cada petición; `forOrganization` obligatorio en código de negocio (ESLint); llaves compuestas en la base; batería de dos empresas; registro de revisión de cada Server Action.
- Bitácora: solo agregar por disparadores; metadatos sin secretos.
- Correos: no revelan si existe una cuenta; enlaces de un solo uso con vencimiento; página de restablecer con `no-referrer`.

## Siguiente revisión

Al cerrar USR (roles y permisos) y antes del piloto: revisión independiente, CSP de scripts (PLT16-04) y la matriz ASVS completa para lo que exista entonces.
