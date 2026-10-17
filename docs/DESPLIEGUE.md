# Despliegue en el servidor

Guía para poner Almacén en internet en un VPS con Ubuntu 24.04, por ejemplo la KVM 2 de Hostinger. La decisión y sus razones están en el ADR 0024.

Todo lo de esta guía ya está probado: el workflow «Despliegue de prueba» corre en GitHub, sobre un Ubuntu limpio, todo lo que sigue.
- Instala el servidor.
- Configura el correo.
- Despliega.
- Comprueba HTTPS, la política de seguridad y la salud.
- Hace un respaldo cifrado y verifica que se pueda abrir.
- Hace un segundo despliegue y regresa a la versión anterior.

## Cómo queda el servidor

```
Internet ──HTTPS──► Caddy (certificado de Let's Encrypt, renovación sola)
                      │
                      ▼  127.0.0.1:3000
              almacen-web (Next.js)      almacen-worker (cola de trabajos)
                      │                          │
                      └──────────┬───────────────┘
                                 ▼
                  MySQL 9.4 (contenedor, solo 127.0.0.1)

/srv/almacen/
  current → releases/20261020-153000-abc1234   versión activa
  releases/                                     últimas 5 versiones
  shared/.env.local                             configuración y secretos
  shared/storage/                               archivos de las empresas
  backups/                                      respaldos cifrados (root)
```

- **Firewall:** solo están abiertos SSH, 80 y 443. MySQL y la app no se ven desde fuera.
- **Servicios:** web, worker y respaldo son servicios de systemd. Se reinician solos si fallan o si el servidor se reinicia.
- **Actualizaciones de seguridad** del sistema: automáticas.
- **Reloj sincronizado con chrony.** Los códigos de verificación en dos pasos dependen de él.

## Antes de empezar (una sola vez)

### 1. Servidor y dominio

1. Contrata el VPS con **Ubuntu 24.04**. Anota su IP y la contraseña de root.
2. En el DNS de tu dominio crea un registro **A**: `almacen.mx → IP del servidor` (o el subdominio que quieras, como `app.almacen.mx`). Puede tardar de minutos a horas en propagarse. Revísalo con `nslookup almacen.mx`.

### 2. Proveedor de correo

Sin correo nadie puede confirmar su cuenta. Elige uno; todos tienen plan gratis para empezar:

| Proveedor | Servidor SMTP | Puerto |
| --- | --- | --- |
| Resend | `smtp.resend.com` (usuario `resend`, contraseña = API key) | 587 |
| Brevo | `smtp-relay.brevo.com` | 587 |
| Amazon SES | `email-smtp.<región>.amazonaws.com` | 587 |

En el proveedor:
- Verifica tu dominio: agrega los registros **SPF y DKIM** que te dé en tu DNS.
- Agrega un registro **DMARC**: `_dmarc.almacen.mx TXT "v=DMARC1; p=none"`.

Sin esto, los correos llegan a spam.

### 3. Llave de los respaldos

Los respaldos se cifran en el servidor con una llave pública. La privada, que es la única que los abre, se queda **contigo**, nunca en el servidor.

En tu computadora (Windows: `winget install FiloSottile.age`):

```bash
age-keygen -o almacen-respaldos.txt
```

- Muestra una línea `Public key: age1…`: esa es la que usa el servidor.
- Guarda `almacen-respaldos.txt` en tu gestor de contraseñas y en una USB. **Si la pierdes, ningún respaldo se puede abrir.**

### 4. Tu llave SSH

Si no tienes una: `ssh-keygen -t ed25519`. Tu llave pública está en `~/.ssh/id_ed25519.pub`.

## Instalación

1. Copia la carpeta `deploy` al servidor, desde la carpeta del proyecto en tu computadora:

   ```bash
   scp -r deploy root@IP_DEL_SERVIDOR:/root/
   ```

2. Entra al servidor y corre el instalador:

   ```bash
   ssh root@IP_DEL_SERVIDOR
   bash /root/deploy/instalar.sh \
     --dominio almacen.mx \
     --correo-ssl tu@correo.mx \
     --clave-respaldos age1TU_LLAVE_PUBLICA \
     --admin tuusuario \
     --llave-admin "$(cat ~/.ssh/authorized_keys | head -1)"
   ```

   - `--admin` crea tu cuenta con permisos de administración.
   - Al terminar, **ya no se puede entrar como root ni con contraseña, solo con tu llave**. Por eso `--llave-admin` debe ser tu llave pública.
   - Si entraste a root con contraseña, pega el contenido de tu `id_ed25519.pub` en lugar de `$(cat …)`.
   - Prueba `ssh tuusuario@almacen.mx` en otra terminal **antes de cerrar** la sesión de root.

3. **Permiso para leer el repositorio.**
   - La primera vez, el instalador se detiene y muestra una llave.
   - En GitHub: _Settings → Deploy keys → Add deploy key_. Pégala, deja _Allow write access_ **sin marcar** y guarda.
   - Vuelve a correr el mismo comando. Repetirlo es seguro: nunca cambia secretos ni datos.

4. **Correo:** llena la sección «Correo» con los datos de tu proveedor.

   ```bash
   sudo nano /srv/almacen/shared/.env.local
   ```

   `MAIL_FROM` debe ser una dirección de tu dominio verificado, por ejemplo `Almacén <avisos@almacen.mx>`.

5. **Primer despliegue:**

   ```bash
   sudo -u almacen /usr/local/lib/almacen/desplegar
   almacen correo:prueba tu@correo.mx
   ```

6. Abre `https://almacen.mx`, crea tu cuenta y tu empresa, y date acceso a la consola interna:

   ```bash
   almacen staff add tu@correo.mx
   ```

### 5. Respaldo del secreto de autenticación

Copia `BETTER_AUTH_SECRET` de `/srv/almacen/shared/.env.local` a tu gestor de contraseñas. Cifra la verificación en dos pasos de todos: **si se pierde o se cambia, nadie con MFA puede entrar** (ADR 0003).

### 6. Monitor de disponibilidad

En [UptimeRobot](https://uptimerobot.com) (gratis) crea un monitor de tipo _Keyword_:
- URL: `https://almacen.mx/api/salud`.
- Palabra clave: `"ok":true`.
- Cada 5 minutos, con aviso a tu correo.

Avisa cuando falla cualquiera de estas cosas:

| Revisión | Falla cuando |
| --- | --- |
| `database` | la app no llega a MySQL |
| `worker` | el worker lleva más de 2 minutos sin latido |
| `queue` | un trabajo lleva 10 minutos esperando |
| `backup` | el último respaldo correcto tiene más de 26 horas |
| `errors` | hubo 20 errores o más en 15 minutos |

### 7. Copia fuera del servidor (recomendado)

Un respaldo que solo vive en el servidor se pierde con el servidor. Hay dos opciones:
- Activa los **snapshots** del VPS en Hostinger.
- Configura un destino de rclone (Backblaze B2 cuesta centavos al mes) y anótalo en `RCLONE_DESTINO`:

```bash
sudo rclone config               # crea el remoto, p. ej. «b2»
sudo nano /srv/almacen/shared/respaldo.env   # RCLONE_DESTINO=b2:almacen-respaldos
sudo systemctl start almacen-respaldo.service  # prueba
```

### 8. Desplegar desde GitHub (opcional)

1. En tu computadora: `ssh-keygen -t ed25519 -f despliegue-almacen -N ""`.
2. Vuelve a correr `instalar.sh` con `--llave-ci "$(cat despliegue-almacen.pub)"`. Esa llave solo puede desplegar: no abre una terminal.
3. En GitHub, en _Settings → Secrets and variables → Actions_, crea:
   - `DEPLOY_HOST`: `almacen.mx`.
   - `DEPLOY_SSH_KEY`: el contenido de `despliegue-almacen`, la privada.
   - `DEPLOY_KNOWN_HOSTS`: la salida de `ssh-keyscan -t ed25519 almacen.mx`.
4. Desde ese momento: _Actions → Desplegar → Run workflow_.

## Operación diaria

| Para | Comando |
| --- | --- |
| Desplegar lo último de `pruebas` | `sudo -u almacen /usr/local/lib/almacen/desplegar` |
| Desplegar un commit | `sudo -u almacen /usr/local/lib/almacen/desplegar abc1234` |
| Regresar a la versión anterior | `sudo -u almacen /usr/local/lib/almacen/volver` |
| Ver versiones | `ls /srv/almacen/releases` |
| Estado | `curl -s localhost:3000/api/salud` y `systemctl status almacen-web almacen-worker` |
| Registros de la app | `journalctl -u almacen-web -f` (uno por línea, en JSON) |
| Registros del worker | `journalctl -u almacen-worker -f` |
| Respaldo ahora | `sudo systemctl start almacen-respaldo.service` |
| Revisar existencias contra historial | `almacen stock:reconcile` |
| Estado de migraciones | `almacen db:status` |

**Cada despliegue:**
1. Construye la versión nueva aparte.
2. Hace un **respaldo verificado**.
3. Aplica las migraciones.
4. Cambia de versión y revisa la salud.

Si la versión nueva no responde, regresa sola a la anterior.

**Regla para las migraciones:** solo agregar. Una columna o tabla que se deja de usar se borra en un despliegue posterior, nunca en el mismo. Así `volver` siempre funciona sin tocar la base.

## Restaurar un respaldo

Hazlo solo ante una pérdida de datos, y practícalo una vez antes del piloto (PIL-03):

```bash
scp almacen-respaldos.txt tuusuario@almacen.mx:/tmp/llave.txt
ssh tuusuario@almacen.mx
sudo mv /tmp/llave.txt /root/ && sudo chmod 600 /root/llave.txt
ls /srv/almacen/backups
sudo /usr/local/lib/almacen/restaurar \
  /srv/almacen/backups/almacen-FECHA.sql.gz.age /root/llave.txt \
  /srv/almacen/backups/archivos-FECHA.tar.gz.age
sudo shred -u /root/llave.txt
```

El script pide escribir `RESTAURAR`, detiene la app, reemplaza la base y los archivos, y la vuelve a arrancar.

## Actualizar los scripts del servidor

Los scripts de `/usr/local/lib/almacen` y los servicios los instala `instalar.sh`, y son de root. Una versión nueva de la carpeta `deploy` se aplica copiándola otra vez y corriendo el instalador con las mismas opciones.
