#!/usr/bin/env bash
# Arma el paquete que recibe el servidor (ADR 0024): dependencias + build de
# producción, en GitHub Actions (Ubuntu x86_64, como el servidor), para que
# el servidor no compile. Se corre en la raíz del repositorio:
#
#   bash deploy/empaquetar.sh /ruta/paquete.tgz
#
# Deja junto al paquete su suma (paquete.tgz.sha256). El build no lleva
# secretos: la configuración real la pone el servidor (.env.local) al
# arrancar; aquí solo hay valores de relleno para que el build cargue.
set -euo pipefail

SALIDA="${1:?uso: empaquetar.sh <paquete.tgz>}"
[[ -f package.json && -d deploy ]] || { echo "Córrelo en la raíz del repositorio." >&2; exit 1; }
[[ ! -e .env.local ]] || { echo "Hay un .env.local aquí: no se empaqueta con secretos." >&2; exit 1; }

npm ci --include=dev --no-audit --no-fund --loglevel=error

env NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
  BETTER_AUTH_URL=https://almacen.invalid \
  BETTER_AUTH_SECRET="relleno-solo-para-el-build-$(date +%s)" \
  DATABASE_HOST=127.0.0.1 DATABASE_PORT=3306 DATABASE_NAME=almacen \
  DATABASE_APP_USER=relleno DATABASE_APP_PASSWORD=relleno \
  MAIL_DRIVER=smtp \
  npm run build

tar -czf "$SALIDA" \
  --exclude=./.git --exclude=./.github --exclude=./.next/cache \
  --exclude='./.env*' --exclude=./.local --exclude=./storage \
  --exclude=./node_modules/.cache --exclude=./qa \
  .
sha256sum "$SALIDA" | cut -d' ' -f1 > "$SALIDA.sha256"
echo "Paquete: $SALIDA ($(du -h "$SALIDA" | cut -f1)), sha256 $(cat "$SALIDA.sha256")"
