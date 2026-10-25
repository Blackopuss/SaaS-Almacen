# Auditoría de seguridad 3 (skill `security-audit`)

Tercera corrida de la skill sobre el commit `acd91d0` (rama `pruebas`), que ya incluía las correcciones de las auditorías 1 y 2. A diferencia de las dos primeras (perfil _quick_, solo código), esta se concentró en **la superficie nueva desde el commit `4830ff8`** —90 archivos, +5880 líneas que ninguna auditoría anterior había visto— y añadió **pruebas dinámicas contra el servidor de producción** (`https://18-224-247-13.sslip.io`) y una verificación de exposición de red, con autorización del fundador y datos de prueba.

- **Perfil:** standard.
- **Revisión:** Claude revisó los archivos de mayor valor de la superficie nueva (CSP con nonce, proxy/redirects tras Caddy, SMTP real, `/api/salud`, logs, sesión, confirmar-correo, allowlist HTTP, lector XLSX, y toda la carpeta `deploy/`). **Codex** hizo una revisión estática independiente del mismo diff.
- **Verificación dinámica:** en vivo contra producción (solo lectura / no destructivo): cabeceras, CSP, TLS/HSTS, gating de autenticación, open-redirect, endpoints de desarrollo, superficie `/api/auth`, `/api/salud`, y exposición de puertos. No se hicieron ataques de volumen ni se cerró la sesión del fundador.
- **Reporte completo:** fuera del repositorio, en `~/security-audit-skill/SaaS-Almacen/run-3/` (`REPORT.md`, `findings.json`).

## Hallazgos y corrección

| Severidad | Hallazgo | Corrección propuesta |
| --- | --- | --- |
| **Alta** | **Escalada a root por `respaldo.env`.** El servicio de respaldo (`almacen-respaldo.service`) corre `deploy/bin/respaldo` **como root**, y este hace `. "$BASE/shared/respaldo.env"` (lo **ejecuta** como shell, `respaldo:21`). El archivo es de root 600, pero su carpeta `/srv/almacen/shared` es de `almacen` (modo 750, `instalar.sh:168`): en Linux, el permiso de escritura sobre el **directorio** permite a `almacen` borrar y recrear ese archivo con contenido arbitrario. Como la app web y el worker corren como `almacen` con `ReadWritePaths=/srv/almacen/shared`, **cualquier escritura arbitraria o RCE en la app se convierte en root** en el siguiente respaldo (diario o pre-migración). El endurecimiento `NoNewPrivileges` de la app se evade por el servicio root separado. | Mover todo lo que root ejecuta o «sourcea» (`respaldo.env` y futura configuración) a una carpeta solo-root como `/etc/almacen/` (root:root, 0750). Dejar `/srv/almacen/shared` solo para datos de la app. Mejor aún: leer `respaldo.env` como `CLAVE=VALOR` validado, sin `source`. |
| **Media** | **Tokens de recuperación en el log de Caddy.** El restablecimiento usa `/api/auth/reset-password/<token>` (token en la ruta) → `/restablecer-contrasena?token=…` (token en el query). El `Caddyfile` registra el URI completo (`format json`, sin filtro), así que los tokens quedan en claro en `/var/log/caddy/almacen.log`. Quien lea ese log (root, un _pipeline_ de logs, o cualquier cuenta local si los archivos quedan legibles) puede canjear un token vigente y sin usar y **tomar la cuenta sin acceder al buzón**. La app sí recorta el query en sus propios logs; Caddy no. El token caduca y es de un solo uso, lo que acota la ventana. | Filtrar/redactar las rutas y queries con token en el log de Caddy (y las cabeceras `Location`/`Referer`). Idealmente no llevar el token en la URL (enviarlo en el cuerpo de un POST), o acortar mucho la ventana y asegurar que los archivos de `/var/log/caddy` sean `0600 caddy:caddy` y nunca se envíen sin redactar. |

## Resistieron sin fallas (verificado en esta corrida)

Postura fuerte, confirmada por código y —donde se indica— **en vivo en producción**:

- **CSP con nonce por petición** + `strict-dynamic`, sin `unsafe-inline`/`unsafe-eval` en scripts (en vivo: nonce de 128 bits distinto por respuesta).
- **Cabeceras de seguridad** HSTS (2 años, `includeSubDomains`), `X-Frame-Options: DENY`, `nosniff`, COOP, `Referrer-Policy`, `Permissions-Policy` (en vivo).
- **Open redirect cerrado:** `safeRedirectPath` rechaza rutas absolutas y protocolo-relativas revalidando la ruta ya normalizada; el `siguiente` se refleja URL-encodeado (en vivo + código).
- **Endpoints de desarrollo** (`/correos`, `/sistema-visual`) → 404 en producción (en vivo).
- **`/api/auth`** con allowlist: `verify-email` cerrado (404 en vivo); solo el enlace de restablecimiento.
- **SMTP real:** rechaza CRLF/control en cabeceras (sin inyección), TLS con `rejectUnauthorized` y `minVersion` 1.2, `disableFileAccess/UrlAccess`, host desde entorno (sin SSRF por petición), adjuntos acotados; destinatario desde dato guardado.
- **Lector XLSX/CSV:** una sola pasada (`indexOf`), descompresión acotada (anti zip-bomb), XXE rechazado, contadores topados; el cambio `state="visible"` no introdujo regresión.
- **Límite de intentos** atómico (`reserveAttempt` antes de verificar); confirmación de correo con enlace **y** contraseña; cookies de sesión `__Secure-`/`httpOnly`/`SameSite=lax`, sin caché de cookie (valida contra la base cada petición).
- **IP del cliente** desde el final de `X-Forwarded-For`: detrás de Caddy el cliente no puede falsearla.
- **Despliegue:** entradas validadas con regex, llave de CI con comando forzado (`no-pty`, solo despliega), paquete verificado por sha256, secretos generados en el servidor, acciones de GitHub ancladas por commit, sin secretos en el paquete.
- **Exposición de red (en vivo):** solo 443 (Caddy) público; `3000` (app), `3306` (MySQL) y `2525` (SMTP de prueba) cerrados desde fuera; `22` filtrado desde una IP arbitraria (restringido por el _security group_; el despliegue entra desde GitHub Actions).
- **Aislamiento entre empresas, permisos por rol/módulo, cupos, archivos/exportaciones, cola y correo, SQL:** cubiertos por las auditorías 1 y 2 y el banco de pruebas (`two-companies`, `tenant-db`, `server-actions`, `module-guard`); no se reabrieron a fondo en esta corrida centrada en lo nuevo.

## Sugerencias anotadas (no son vulnerabilidades)

- **Contraseña de root de MySQL en `argv`:** `respaldo` e `instalar.sh` la pasan con `-e MYSQL_PWD=…`/`-e MYSQL_ROOT_PASSWORD=…`, visible en el listado de procesos mientras corre. En un host con solo `almacen` y `root` es de bajo valor (y el hallazgo Alto ya da root). Pasarla por `--env-file`.
- **La cuenta de negocio del fundador es además personal de plataforma:** puede entrar a `/interno`. Esperado para quien opera la plataforma, pero concentra el riesgo; conviene separar la identidad de plataforma de la cuenta de negocio (mínimo privilegio).
- **`workflow_dispatch` de «Desplegar»** acepta un `ref` manual sin comprobar que ese commit exacto pasó CI; el riesgo depende de la protección de rama y del entorno `produccion`. Revisar esas protecciones en GitHub.
- El token de verificación de correo también queda en el log de Caddy (misma causa que el hallazgo Medio), pero hoy el enlace por sí solo no activa nada (auditoría 2), así que su impacto es menor.

## Correcciones aplicadas (18 de octubre de 2026)

- **Alta — escalada a root:** la configuración que el respaldo (root) lee se movió de `/srv/almacen/shared/respaldo.env` (escribible por `almacen`) a `/etc/almacen/respaldo.env` (`root:root`, directorio `0750`, archivo `0640`), fuera del árbol que la app puede escribir. Además, `deploy/bin/respaldo` ya **no** hace `source` del archivo: lo lee como `CLAVE=VALOR` aceptando solo las tres claves conocidas y validando `AGE_RECIPIENT`/`RETENER_DIAS`, así que ni aun escribiéndolo se puede inyectar shell. `instalar.sh` crea la carpeta y migra el archivo anterior al reinstalar.
- **Media — tokens en el log de Caddy:** el bloque `log` del `Caddyfile` pasó de `format json` a `format filter` y redacta el token de recuperación/confirmación tanto en la ruta (`/api/auth/reset-password/<token>`) como en el query (`?token=…`), en `request>uri` y en el `Referer`, reemplazándolo por `[redactado]` antes de escribir.
- **Sugerencia aplicada — contraseña de MySQL en `argv`:** `respaldo` e `instalar.sh` pasan la contraseña de root por `--env-file` (archivo `600`), no con `-e MYSQL_PWD=…`, así que ya no aparece en la lista de procesos.
- **Prueba de regresión:** `despliegue-prueba.yml` comprueba en un Ubuntu limpio que `almacen` no puede escribir ni reemplazar `/etc/almacen/respaldo.env`, que ya no existe el archivo en `shared`, que la contraseña no aparece en `ps`, y que un token enviado al endpoint de recuperación **no** queda en el log de Caddy (aparece `/api/auth/[redactado]`).

Validación final: estas son correcciones de la capa de despliegue (bash/Caddyfile/systemd); las confirma el workflow «Despliegue de prueba» al subir a `pruebas` (no se pueden ejercitar en la máquina de desarrollo Windows).

## Pendiente

- Verificar en el host la nota de protecciones de rama/entorno del despliegue (`workflow_dispatch`).
- Considerar separar la identidad de personal de plataforma de la cuenta de negocio del fundador (mínimo privilegio; nota informativa).
