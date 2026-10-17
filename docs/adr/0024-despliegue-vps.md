# ADR 0024: Despliegue en un VPS con versiones, respaldos verificados y monitor

- **Estado:** aceptada.
- **Fecha:** 2026-10-16.

## Contexto

- El fundador eligió un VPS (KVM 2 de Hostinger: 2 vCPU, 8 GB, NVMe) en lugar de un servicio administrado.
- Antes de contratarlo, quiere todo listo para que solo falte subirlo.
- BAS-09..11 piden HTTPS, red privada para la base, secretos fuera del repositorio, logs, captura de errores y un respaldo restaurado.
- PIL-01 pide poder regresar a la versión anterior sin una migración destructiva.

## Decisión

- **Un solo servidor, con Ubuntu 24.04:**
  - **Caddy** delante, con HTTPS automático (Let's Encrypt).
  - **App y worker** como servicios de systemd, con la cuenta `almacen` y escritura solo en sus carpetas.
  - **MySQL 9.4** en un contenedor Docker con la versión exacta de desarrollo y CI. Usa `--network host` y escucha solo en 127.0.0.1, así que los usuarios quedan en `127.0.0.1` y no en `%`.
  - **Node 24** desde el binario oficial, con su suma verificada.
- **`deploy/instalar.sh`:**
  - Deja un Ubuntu limpio listo.
  - Es idempotente: no cambia secretos ni datos al repetirse.
  - Genera los secretos en el servidor.
  - Configura firewall, SSH solo con llave (si se da una cuenta de administración), actualizaciones automáticas, reloj sincronizado y memoria de intercambio.
- **Versiones en `releases/<fecha>-<commit>`, con el enlace `current` a la activa.** `desplegar` sigue este orden:
  1. build aparte;
  2. respaldo verificado;
  3. migraciones;
  4. cambio de enlace y reinicio;
  5. revisión de salud.

  Si la salud falla, regresa a la anterior. `volver` cambia el enlace sin tocar la base, y se conservan 5 versiones.
- **Migraciones solo de expansión.** Lo que se deja de usar se borra en un despliegue posterior. Así la versión anterior siempre entiende la base.
- **Respaldos diarios y antes de cada migración:**
  - `mysqldump` consistente.
  - Restauración de prueba en una base aparte, comparando tablas, disparadores y migraciones.
  - Cifrado con `age` para una llave pública. La privada vive fuera del servidor.
  - Archivos de las empresas, también cifrados.
  - Copia opcional fuera del servidor con rclone.
  - Retención de 14 días.

  Si la verificación falla, el despliegue se detiene antes de migrar y `/api/salud` lo reporta.
- **Observación:**
  - Logs en JSON por línea en journald.
  - `src/instrumentation.ts` para los errores.
  - `/api/salud` para un monitor externo (UptimeRobot): base, latido del worker, cola detenida, último respaldo y errores recientes.
- **Despliegue desde GitHub (manual):** el workflow `Desplegar` entra por SSH con una llave que en el servidor solo puede correr `desplegar` (comando forzado).
- **Prueba de punta a punta:** el workflow `Despliegue de prueba` corre en Ubuntu 24.04 limpio cuando cambia `deploy/`, con certificado interno y un SMTP local.

## Alternativas descartadas

- **Todo en Docker Compose:** una imagen más que construir y vigilar. El worker con `tsx` y los hooks de `server-only` complican la imagen. Solo MySQL gana algo en un contenedor (la versión exacta).
- **MySQL de los paquetes de Ubuntu:** trae la 8.0, no la 9.4. El repositorio de Oracle pide una configuración interactiva.
- **Nginx con certbot:** más piezas que Caddy para lo mismo.
- **Sentry u otro servicio de errores:** queda para después. Hoy bastan journald, el conteo de errores y el monitor de salud, sin mandar datos a terceros.

## Consecuencias

- **Un solo servidor es un solo punto de falla.** Mitigado con respaldos cifrados verificados, snapshots del VPS y copia fuera con rclone. El RPO es de un día (o el último despliegue) y el RTO es lo que tarde `instalar.sh` más una restauración. Se mide en PIL-03.
- **El fundador guarda dos secretos fuera del servidor:** la llave privada de respaldos y `BETTER_AUTH_SECRET`.
- **Una versión nueva de `deploy/`** se aplica volviendo a correr el instalador. Los scripts que corren como root no los puede cambiar la cuenta `almacen`.
- Guía de operación: `docs/DESPLIEGUE.md`.
