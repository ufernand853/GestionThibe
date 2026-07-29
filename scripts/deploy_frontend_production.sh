#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FRONTEND_DIR="$APP_DIR/frontend"
FRONTEND_PM2_NAME="${FRONTEND_PM2_NAME:-gestionthibe-frontend}"

log() {
  printf '[frontend-deploy] %s\n' "$*"
}

if [[ ! -f "$FRONTEND_DIR/package.json" ]]; then
  echo "No se encontró el frontend en $FRONTEND_DIR" >&2
  exit 1
fi

log "Instalando dependencias..."
(cd "$FRONTEND_DIR" && npm install)

log "Generando los archivos estáticos de producción..."
(cd "$FRONTEND_DIR" && npm run build)

if ! grep -Rqs --include='*.js' 'filterLocation' "$FRONTEND_DIR/dist" "$FRONTEND_DIR/build" 2>/dev/null; then
  echo 'La compilación no contiene el filtro "Ubicación".' >&2
  exit 1
fi

if grep -Rqs --include='*.js' 'Ubicación de stock' "$FRONTEND_DIR/dist" "$FRONTEND_DIR/build" 2>/dev/null; then
  echo 'La compilación todavía contiene el filtro duplicado "Ubicación de stock".' >&2
  exit 1
fi

log 'Compilación verificada: el filtro "Ubicación" está incluido.'
log 'Compilación verificada: el filtro duplicado "Ubicación de stock" no existe.'

if command -v pm2 >/dev/null 2>&1 && pm2 describe "$FRONTEND_PM2_NAME" >/dev/null 2>&1; then
  log "Reiniciando el frontend administrado por PM2 ($FRONTEND_PM2_NAME)..."
  pm2 restart "$FRONTEND_PM2_NAME" --update-env
else
  log "No se encontró el proceso PM2 $FRONTEND_PM2_NAME; no es necesario reiniciar si Nginx sirve frontend/dist directamente."
fi

log 'Despliegue terminado. Actualizá el navegador con Ctrl+F5.'
