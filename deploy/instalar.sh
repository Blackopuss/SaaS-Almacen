#!/usr/bin/env bash
# Prepara un servidor Ubuntu 24.04 limpio para Almacén (BAS-09..11).
# Se corre como root, una vez; volver a correrlo es seguro (actualiza los
# scripts y plantillas sin tocar datos ni secretos).
#
#   bash deploy/instalar.sh \
#     --dominio almacen.mx \
#     --correo-ssl tu@correo.mx \
#     --clave-respaldos age1... \
#     [--repo git@github.com:Blackopuss/SaaS-Almacen.git] [--rama pruebas] \
#     [--admin usuario --llave-admin "ssh-ed25519 AAAA..."] \
#     [--llave-ci "ssh-ed25519 AAAA..."]
#
# Guía completa: docs/DESPLIEGUE.md
set -euo pipefail

DOMINIO=""
CORREO_SSL=""
CLAVE_RESPALDOS=""
REPO="git@github.com:Blackopuss/SaaS-Almacen.git"
RAMA="pruebas"
ADMIN=""
LLAVE_ADMIN=""
LLAVE_CI=""
PRUEBA=0 # --prueba: CI; certificado interno, sin firewall ni cambios a SSH.

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dominio) DOMINIO="$2"; shift 2 ;;
    --correo-ssl) CORREO_SSL="$2"; shift 2 ;;
    --clave-respaldos) CLAVE_RESPALDOS="$2"; shift 2 ;;
    --repo) REPO="$2"; shift 2 ;;
    --rama) RAMA="$2"; shift 2 ;;
    --admin) ADMIN="$2"; shift 2 ;;
    --llave-admin) LLAVE_ADMIN="$2"; shift 2 ;;
    --llave-ci) LLAVE_CI="$2"; shift 2 ;;
    --prueba) PRUEBA=1; shift ;;
    *) echo "Opción desconocida: $1" >&2; exit 2 ;;
  esac
done

paso() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
falla() { printf '\n\033[1;31mError: %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || falla "córrelo como root (sudo bash deploy/instalar.sh …)."
[[ -n "$DOMINIO" ]] || falla "falta --dominio."
[[ "$DOMINIO" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || falla "dominio inválido: $DOMINIO"
[[ -n "$CORREO_SSL" || $PRUEBA -eq 1 ]] || falla "falta --correo-ssl (avisos de Let's Encrypt)."
[[ "$CLAVE_RESPALDOS" =~ ^age1[0-9a-z]{58}$ ]] || falla "falta --clave-respaldos (llave pública de age, empieza con age1)."
[[ "$RAMA" =~ ^[A-Za-z0-9._/-]+$ ]] || falla "rama inválida: $RAMA"
if [[ -n "$ADMIN" ]]; then
  [[ "$ADMIN" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || falla "usuario admin inválido: $ADMIN"
  [[ "$LLAVE_ADMIN" =~ ^ssh-(ed25519|rsa)\ [A-Za-z0-9+/=]+ ]] || falla "--admin necesita --llave-admin (tu llave pública SSH)."
fi
if [[ -n "$LLAVE_CI" ]]; then
  [[ "$LLAVE_CI" =~ ^ssh-ed25519\ [A-Za-z0-9+/=]+ ]] || falla "--llave-ci debe ser una llave ssh-ed25519."
fi
. /etc/os-release
[[ "$ID" == "ubuntu" ]] || falla "este script es para Ubuntu 24.04 (encontré $PRETTY_NAME)."

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd /
BASE=/srv/almacen
LIB=/usr/local/lib/almacen
SECRETO_ROOT=/root/.almacen-mysql-root
export DEBIAN_FRONTEND=noninteractive

paso "Paquetes del sistema y actualizaciones automáticas de seguridad"
apt-get update -q
[[ $PRUEBA -eq 1 ]] || apt-get upgrade -yq
apt-get install -yq ca-certificates curl gnupg git jq age rclone chrony \
  unattended-upgrades fail2ban ufw xz-utils debian-keyring \
  debian-archive-keyring apt-transport-https
dpkg-reconfigure -f noninteractive unattended-upgrades
timedatectl set-timezone UTC
systemctl enable --now chrony # Reloj al segundo: los códigos MFA dependen de él.

if [[ $(swapon --show | wc -l) -eq 0 && ! -f /swapfile ]]; then
  paso "Memoria de intercambio de 2 GB (para el build)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if [[ $PRUEBA -eq 0 ]]; then
  paso "Firewall: solo SSH, HTTP y HTTPS"
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw allow 443/udp
  ufw --force enable
fi

if [[ -n "$ADMIN" ]]; then
  paso "Cuenta de administración «$ADMIN» con llave SSH"
  id "$ADMIN" >/dev/null 2>&1 || adduser --disabled-password --gecos "" "$ADMIN"
  usermod -aG sudo "$ADMIN"
  install -d -m 700 -o "$ADMIN" -g "$ADMIN" "/home/$ADMIN/.ssh"
  grep -qxF "$LLAVE_ADMIN" "/home/$ADMIN/.ssh/authorized_keys" 2>/dev/null ||
    echo "$LLAVE_ADMIN" >> "/home/$ADMIN/.ssh/authorized_keys"
  chown "$ADMIN:$ADMIN" "/home/$ADMIN/.ssh/authorized_keys"
  chmod 600 "/home/$ADMIN/.ssh/authorized_keys"
  echo "$ADMIN ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/90-$ADMIN"
  chmod 440 "/etc/sudoers.d/90-$ADMIN"
  if [[ $PRUEBA -eq 0 ]]; then
    # Solo con una llave de admin ya instalada: si no, nadie podría entrar.
    # «01-»: sshd usa el primer valor que lee, y la imagen de la nube trae
    # 50-cloud-init.conf con contraseña permitida.
    cat > /etc/ssh/sshd_config.d/01-almacen.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
    sshd -t || falla "configuración de SSH inválida."
    # Ubuntu 24.04 arranca sshd por socket: cada conexión nueva ya la lee.
    systemctl try-reload-or-restart ssh.service || true
  fi
fi

if ! command -v docker >/dev/null; then
  paso "Docker (solo para MySQL)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -yq docker-ce docker-ce-cli containerd.io
fi
systemctl enable --now docker

paso "Node.js 24 (binario oficial, con su suma verificada)"
NODE_ACTUAL="$(/usr/local/bin/node --version 2>/dev/null || true)"
SUMAS="$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)"
ARCH=$(dpkg --print-architecture); [[ "$ARCH" == "amd64" ]] && ARCH=x64
ARCHIVO="$(grep -oE "node-v24\.[0-9]+\.[0-9]+-linux-${ARCH}\.tar\.xz" <<<"$SUMAS" | head -1)"
[[ -n "$ARCHIVO" ]] || falla "no encontré Node 24 para $ARCH."
VERSION="${ARCHIVO#node-}"; VERSION="${VERSION%%-linux*}"
if [[ "$NODE_ACTUAL" != "$VERSION" ]]; then
  TMP=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/latest-v24.x/$ARCHIVO" -o "$TMP/$ARCHIVO"
  (cd "$TMP" && grep " $ARCHIVO\$" <<<"$SUMAS" | sha256sum -c -) || falla "la suma de Node no coincide."
  rm -rf "/opt/node-$VERSION"
  tar -xJf "$TMP/$ARCHIVO" -C /opt
  mv "/opt/${ARCHIVO%.tar.xz}" "/opt/node-$VERSION"
  for bin in node npm npx; do ln -sfn "/opt/node-$VERSION/bin/$bin" "/usr/local/bin/$bin"; done
  rm -rf "$TMP"
fi
/usr/local/bin/node --version

if ! command -v caddy >/dev/null; then
  paso "Caddy (HTTPS automático)"
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key |
    gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q
  apt-get install -yq caddy
fi

paso "Cuenta «almacen» y carpetas"
id almacen >/dev/null 2>&1 || useradd --system --create-home --home-dir "$BASE" --shell /bin/bash almacen
install -d -o almacen -g almacen -m 750 "$BASE" "$BASE/releases" "$BASE/shared" "$BASE/shared/run"
install -d -o almacen -g almacen -m 700 "$BASE/shared/storage"
install -d -o root -g root -m 700 "$BASE/backups"
install -d -o root -g root -m 755 "$LIB"

secreto() { head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n'; }

paso "MySQL 9.4 (contenedor, solo en 127.0.0.1)"
if [[ ! -f "$SECRETO_ROOT" ]]; then
  (umask 077 && secreto > "$SECRETO_ROOT")
fi
if ! docker inspect almacen-mysql >/dev/null 2>&1; then
  docker run -d --name almacen-mysql --restart unless-stopped --network host \
    -e MYSQL_ROOT_PASSWORD="$(cat "$SECRETO_ROOT")" \
    -v almacen-mysql:/var/lib/mysql \
    mysql:9.4 \
    --bind-address=127.0.0.1 --mysqlx=OFF \
    --log-bin-trust-function-creators=1 \
    --innodb-buffer-pool-size=1G \
    --character-set-server=utf8mb4 --collation-server=utf8mb4_0900_ai_ci \
    --default-time-zone=+00:00
fi
for _ in $(seq 1 60); do
  docker exec -e MYSQL_PWD="$(cat "$SECRETO_ROOT")" almacen-mysql \
    mysqladmin -uroot -h127.0.0.1 ping >/dev/null 2>&1 && break
  sleep 2
done
docker exec -e MYSQL_PWD="$(cat "$SECRETO_ROOT")" almacen-mysql \
  mysqladmin -uroot -h127.0.0.1 ping >/dev/null || falla "MySQL no arrancó (docker logs almacen-mysql)."

paso "Configuración de producción (secretos generados aquí)"
ENV="$BASE/shared/.env.local"
if [[ ! -f "$ENV" ]]; then
  sed -e "s|@@DOMINIO@@|$DOMINIO|g" \
    -e "s|@@AUTH_SECRET@@|$(secreto)|" \
    -e "s|@@APP_PASSWORD@@|$(secreto)|" \
    -e "s|@@MIGRATOR_PASSWORD@@|$(secreto)|" \
    "$AQUI/plantillas/env.production" > "$ENV"
  chown almacen:almacen "$ENV"
  chmod 600 "$ENV"
fi
valor() { grep -E "^$1=" "$ENV" | head -1 | cut -d= -f2-; }

paso "Base «almacen» y usuarios de mínimo privilegio"
docker exec -i -e MYSQL_PWD="$(cat "$SECRETO_ROOT")" almacen-mysql mysql -uroot -h127.0.0.1 <<SQL
CREATE DATABASE IF NOT EXISTS \`almacen\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'almacen_app'@'127.0.0.1' IDENTIFIED BY '$(valor DATABASE_APP_PASSWORD)';
ALTER USER 'almacen_app'@'127.0.0.1' IDENTIFIED BY '$(valor DATABASE_APP_PASSWORD)';
CREATE USER IF NOT EXISTS 'almacen_migrator'@'127.0.0.1' IDENTIFIED BY '$(valor DATABASE_MIGRATOR_PASSWORD)';
ALTER USER 'almacen_migrator'@'127.0.0.1' IDENTIFIED BY '$(valor DATABASE_MIGRATOR_PASSWORD)';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`almacen\`.* TO 'almacen_app'@'127.0.0.1';
GRANT ALL PRIVILEGES ON \`almacen\`.* TO 'almacen_migrator'@'127.0.0.1';
SQL

paso "Respaldos: llave pública de cifrado"
if [[ -f "$BASE/shared/respaldo.env" ]]; then
  sed -i "s|^AGE_RECIPIENT=.*|AGE_RECIPIENT=$CLAVE_RESPALDOS|" "$BASE/shared/respaldo.env"
else
  cat > "$BASE/shared/respaldo.env" <<EOF
# Llave pública de age: los respaldos se cifran para ella. La privada vive
# fuera del servidor (docs/DESPLIEGUE.md).
AGE_RECIPIENT=$CLAVE_RESPALDOS
# Días que se conservan en el servidor.
RETENER_DIAS=14
# Copia fuera del servidor con rclone (vacío = no copiar), p. ej. b2:almacen-respaldos
RCLONE_DESTINO=
EOF
fi
chmod 600 "$BASE/shared/respaldo.env"

paso "Scripts de operación y servicios"
for script in desplegar volver respaldo restaurar almacen; do
  install -m 755 -o root -g root "$AQUI/bin/$script" "$LIB/$script"
done
ln -sfn "$LIB/almacen" /usr/local/bin/almacen
for unidad in almacen-web.service almacen-worker.service almacen-respaldo.service almacen-respaldo.timer; do
  install -m 644 "$AQUI/plantillas/$unidad" "/etc/systemd/system/$unidad"
done
install -m 440 "$AQUI/plantillas/sudoers" /etc/sudoers.d/almacen
visudo -cf /etc/sudoers.d/almacen >/dev/null || falla "sudoers inválido."
systemctl daemon-reload
systemctl enable almacen-web.service almacen-worker.service almacen-respaldo.timer
systemctl start almacen-respaldo.timer

paso "Caddy para https://$DOMINIO"
TLS=""
[[ $PRUEBA -eq 1 ]] && TLS="tls internal"
sed -e "s|@@DOMINIO@@|$DOMINIO|g" -e "s|@@CORREO_SSL@@|${CORREO_SSL:-admin@$DOMINIO}|" \
  -e "s|@@TLS@@|$TLS|" "$AQUI/plantillas/Caddyfile" > /etc/caddy/Caddyfile
install -d -o caddy -g caddy /var/log/caddy
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
# Validar como root crea el archivo de registro; el servicio corre como caddy.
chown -R caddy:caddy /var/log/caddy
systemctl enable caddy
systemctl reload-or-restart caddy

paso "Acceso al repositorio"
install -d -o almacen -g almacen -m 700 "$BASE/.ssh"
if [[ ! -f "$BASE/.ssh/id_ed25519" ]]; then
  sudo -u almacen ssh-keygen -q -t ed25519 -N "" -C "almacen@$DOMINIO" -f "$BASE/.ssh/id_ed25519"
fi
if [[ "$REPO" == git@github.com:* ]]; then
  # Huella publicada por GitHub (docs.github.com, «GitHub's SSH key fingerprints»).
  HUELLA="SHA256:+DiY3wvvV6TuJJhbpZisF/zLDA0zPMSvHdkr4UvCOqU"
  LLAVE_GH="$(ssh-keyscan -t ed25519 github.com 2>/dev/null)"
  [[ "$(ssh-keygen -lf - <<<"$LLAVE_GH" | awk '{print $2}')" == "$HUELLA" ]] ||
    falla "la llave de github.com no coincide con la publicada."
  echo "$LLAVE_GH" > "$BASE/.ssh/known_hosts"
  chown almacen:almacen "$BASE/.ssh/known_hosts"
fi
if [[ -n "$LLAVE_CI" ]]; then
  # Esta llave solo puede desplegar: no abre una terminal.
  echo "command=\"$LIB/desplegar --desde-ssh\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty $LLAVE_CI" \
    > "$BASE/.ssh/authorized_keys"
  chown almacen:almacen "$BASE/.ssh/authorized_keys"
  chmod 600 "$BASE/.ssh/authorized_keys"
fi
[[ $PRUEBA -eq 1 ]] && git config --system --add safe.directory '*'
if [[ ! -d "$BASE/repo/.git" ]]; then
  if ! sudo -u almacen git clone --quiet --branch "$RAMA" "$REPO" "$BASE/repo"; then
    rm -rf "$BASE/repo"
    cat <<EOF

Falta permiso para leer el repositorio. En GitHub: Settings → Deploy keys →
Add deploy key (solo lectura) y pega esta llave:

$(cat "$BASE/.ssh/id_ed25519.pub")

Después vuelve a correr este mismo comando.
EOF
    exit 3
  fi
fi
echo "RAMA=$RAMA" > "$BASE/shared/despliegue.env"
chown almacen:almacen "$BASE/shared/despliegue.env"

if [[ -z "$(valor SMTP_HOST)" ]]; then
  printf '\n\033[1;32mServidor listo.\033[0m Falta el correo:\n'
  echo "  1. sudo nano $ENV   (sección «Correo»: datos SMTP de tu proveedor)"
  echo "  2. sudo -u almacen $LIB/desplegar"
  echo "  3. almacen correo:prueba tu@correo.mx"
  exit 0
fi

if [[ -L "$BASE/current" ]]; then
  # Reinstalación: la versión activa sigue; desplegar es aparte.
  printf '\n\033[1;32mServidor actualizado.\033[0m Para una versión nueva: sudo -u almacen %s/desplegar\n' "$LIB"
  exit 0
fi
paso "Primer despliegue"
sudo -u almacen "$LIB/desplegar"
printf '\n\033[1;32mListo:\033[0m https://%s\n' "$DOMINIO"
