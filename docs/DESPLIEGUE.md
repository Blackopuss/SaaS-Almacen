# Despliegue en el servidor

Guía para poner Almacén en internet en un servidor con Ubuntu 24.04 o más nuevo: una EC2 de AWS, como la actual (Ubuntu 26.04, 2 vCPU, 4 GB), o un VPS como la KVM 2 de Hostinger.

**El build se hace en GitHub, no en el servidor.** El workflow «Desplegar» compila y le manda al servidor el paquete terminado, y el servidor solo lo instala. Así no gasta memoria compilando, que con 4 GB competiría con MySQL y la app. La decisión y sus razones están en el ADR 0024.

Todo lo de esta guía ya está probado: el workflow «Despliegue de prueba» corre en GitHub, sobre un Ubuntu limpio, todo lo que sigue.
- Arma el paquete.
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

1. Servidor con **Ubuntu 24.04 o más nuevo**.
   - En AWS: asígnale una **IP elástica**. Si no, la IP cambia al detener la instancia y el dominio deja de apuntar.
   - En su **grupo de seguridad**, abre la entrada a **80 y 443 desde 0.0.0.0/0** (HTTPS y la renovación del certificado) y a **22** desde donde despliegas. GitHub Actions entra desde IPs variables, así que 22 queda abierto a 0.0.0.0/0; la llave de despliegue solo puede desplegar.
2. En el DNS de tu dominio crea un registro **A**: `almacen.mx → IP del servidor` (o un subdominio, como `app.almacen.mx`). Puede tardar de minutos a horas en propagarse; revísalo con `nslookup almacen.mx`.
   - **Mientras no tengas dominio**, usa `18-216-231-155.sslip.io` (la IP con guiones). Ese nombre apunta solo a tu IP y Let's Encrypt le da certificado. Cuando tengas el dominio, vuelve a correr el instalador con `--dominio almacen.mx`.

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

### 4. Llave para que GitHub despliegue

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/almacen-despliegue -C "github-actions"
```

En el servidor, esta llave solo puede desplegar: no abre una terminal.

## Instalación

1. Copia la carpeta `deploy` al servidor, desde la carpeta del proyecto en tu computadora:

   ```bash
   scp -i ~/.ssh/MIvps.pem -r deploy ubuntu@SERVIDOR:/tmp/
   ```

2. Entra y corre el instalador. Repetirlo es seguro: nunca cambia secretos ni datos.

   ```bash
   ssh -i ~/.ssh/MIvps.pem ubuntu@SERVIDOR
   sudo bash /tmp/deploy/instalar.sh \
     --dominio almacen.mx \
     --clave-respaldos age1TU_LLAVE_PUBLICA \
     --llave-ci "ssh-ed25519 AAAA… github-actions"
   ```

   - `--llave-ci` es el contenido de `~/.ssh/almacen-despliegue.pub`.
   - `--correo-ssl tu@correo.mx` (opcional): Let's Encrypt avisa ahí si un certificado no se pudo renovar.
   - En AWS la cuenta `ubuntu` ya entra solo con llave. En un VPS al que entras como root con contraseña, agrega `--admin tuusuario --llave-admin "ssh-ed25519 …"`. Así se crea tu cuenta y se cierra el acceso con contraseña; prueba la nueva cuenta en otra terminal antes de cerrar la de root.

3. **Correo:** llena la sección «Correo» con los datos de tu proveedor.

   ```bash
   sudo nano /srv/almacen/shared/.env.local
   ```

   `MAIL_FROM` debe ser una dirección de tu dominio verificado, por ejemplo `Almacén <avisos@almacen.mx>`. Si ya hay una versión activa: `sudo systemctl restart almacen-web almacen-worker`.

4. **Secretos en GitHub** (_Settings → Secrets and variables → Actions_):
   - `DEPLOY_HOST`: el dominio, o la IP.
   - `DEPLOY_SSH_KEY`: el contenido de `~/.ssh/almacen-despliegue`, la privada.
   - `DEPLOY_KNOWN_HOSTS`: la salida de `ssh-keyscan -t ed25519 almacen.mx`.

5. **Desplegar:** lleva a la rama `produccion` un commit que ya pasó CI en `pruebas`.

   ```bash
   git push origin pruebas:produccion
   ```

   El workflow «Desplegar» arranca solo; míralo en _Actions_. Cuando el archivo del workflow esté también en la rama principal, aparece además el botón _Actions → Desplegar → Run workflow_, para elegir rama o commit. Al terminar:

   ```bash
   almacen correo:prueba tu@correo.mx
   ```

6. Abre `https://almacen.mx`, crea tu cuenta y tu empresa, y date acceso a la consola interna:

   ```bash
   almacen staff add tu@correo.mx
   ```

**Alternativa sin GitHub Actions:** instala con `--repo git@github.com:Blackopuss/SaaS-Almacen.git` y agrega en GitHub la _deploy key_ de solo lectura que muestra el instalador. Después despliega en el servidor con `sudo -u almacen /usr/local/lib/almacen/desplegar`, que compila ahí mismo. Con 4 GB funciona, pero tarda más y aprieta la memoria.

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
| `backup` | el último respaldo falló o el último correcto tiene más de 26 horas |
| `errors` | hubo 20 errores o más en 15 minutos |

Además, el **worker avisa por correo** (PIL-04, ADR 0025) cuando algo de esa tabla empieza a fallar, cuando la app web deja de responder y cuando se recupera. Revisa cada minuto, avisa si la falla dura dos revisiones seguidas y no repite el aviso mientras siga igual. Para recibirlo, pon tu correo en `/srv/almacen/shared/.env.local` y reinicia el worker:

```bash
sudo nano /srv/almacen/shared/.env.local     # ALERT_EMAIL=tu@correo.mx
sudo systemctl restart almacen-worker
```

Necesita el correo SMTP configurado. Mientras no lo esté (o con `ALERT_EMAIL` vacío), el aviso queda solo en el registro: `journalctl -u almacen-worker | grep ops_alert`. Si el worker o el servidor entero se caen, nadie adentro puede avisar: para eso es el monitor de UptimeRobot.

### 7. Copia fuera del servidor (recomendado)

Un respaldo que solo vive en el servidor se pierde con el servidor. Hay dos opciones:
- Activa los **snapshots** del VPS en Hostinger.
- Configura un destino de rclone (Backblaze B2 cuesta centavos al mes) y anótalo en `RCLONE_DESTINO`:

```bash
sudo rclone config               # crea el remoto, p. ej. «b2»
sudo nano /etc/almacen/respaldo.env          # RCLONE_DESTINO=b2:almacen-respaldos
sudo systemctl start almacen-respaldo.service  # prueba
```

## Operación diaria

| Para | Comando |
| --- | --- |
| Desplegar | `git push origin pruebas:produccion` (o _Actions → Desplegar → Run workflow_) |
| Regresar a la versión anterior | `sudo -u almacen /usr/local/lib/almacen/volver` |
| Ver versiones | `ls /srv/almacen/releases` |
| Estado | `curl -s localhost:3000/api/salud` y `systemctl status almacen-web almacen-worker` |
| Registros de la app | `journalctl -u almacen-web -f` (uno por línea, en JSON) |
| Registros del worker | `journalctl -u almacen-worker -f` |
| Respaldo ahora | `sudo systemctl start almacen-respaldo.service` |
| Revisar existencias contra historial | `almacen stock:reconcile` |
| Estado de migraciones | `almacen db:status` |

**Cada despliegue:**
1. Construye la versión nueva en GitHub y verifica la suma del paquete al recibirlo.
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
