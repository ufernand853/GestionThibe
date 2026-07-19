#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<USAGE
Uso:
  BACKUP_DIR=/ruta/al/backup APP_DIR=/home/adminuser/gestionthibe ./scripts/restore_production.sh --force

Variables:
  BACKUP_DIR   Carpeta creada por backup_production.sh (obligatoria)
  APP_DIR      Carpeta donde restaurar la app (por defecto: repo actual)
  PM2_NAME     Nombre PM2 del backend (por defecto: gestionthibe)
  RESTORE_DB   true/false para restaurar MongoDB (por defecto: true)
USAGE
}

if [[ "${1:-}" != "--force" ]]; then
  usage
  echo
  echo "Este restore pisa archivos y puede pisar la base. Volvé a ejecutar con --force si estás seguro."
  exit 2
fi

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${BACKUP_DIR:-}"
PM2_NAME="${PM2_NAME:-gestionthibe}"
RESTORE_DB="${RESTORE_DB:-true}"

if [[ -z "$BACKUP_DIR" || ! -d "$BACKUP_DIR" ]]; then
  echo "BACKUP_DIR es obligatorio y debe existir."
  exit 2
fi

APP_ARCHIVE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'app-*.tar.gz' | sort | tail -n 1)"
MONGO_ARCHIVE="$(find "$BACKUP_DIR" -maxdepth 1 -name 'mongo-*.archive.gz' | sort | tail -n 1)"

if [[ -z "$APP_ARCHIVE" ]]; then
  echo "No se encontró app-*.tar.gz en $BACKUP_DIR"
  exit 2
fi

read_env_value() {
  local key="$1"
  local env_file="${APP_DIR}/backend/.env"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi
  awk -F= -v key="$key" '$0 !~ /^[[:space:]]*#/ && $1 == key { sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit }' "$env_file"
}

log() {
  printf '[restore] %s\n' "$*"
}

log "Deteniendo PM2 $PM2_NAME si existe..."
pm2 stop "$PM2_NAME" >/dev/null 2>&1 || true

log "Restaurando aplicación en $APP_DIR..."
mkdir -p "$APP_DIR"
tar -xzf "$APP_ARCHIVE" -C "$APP_DIR"

if [[ "$RESTORE_DB" == "true" ]]; then
  if [[ -z "$MONGO_ARCHIVE" ]]; then
    echo "No se encontró mongo-*.archive.gz en $BACKUP_DIR"
    exit 2
  fi
  MONGO_URI="${MONGO_URI:-$(read_env_value MONGO_URI || true)}"
  MONGO_DB_NAME="${MONGO_DB_NAME:-$(read_env_value MONGO_DB_NAME || true)}"
  if [[ -z "${MONGO_URI}" ]]; then
    MONGO_URI="mongodb://localhost:27017/${MONGO_DB_NAME:-gestionthibe}"
  fi
  log "Restaurando MongoDB desde $MONGO_ARCHIVE..."
  mongorestore --uri="$MONGO_URI" --archive="$MONGO_ARCHIVE" --gzip --drop
fi

log "Instalando dependencias backend..."
(cd "$APP_DIR/backend" && npm install)

log "Iniciando backend con PM2..."
(cd "$APP_DIR/backend" && pm2 start src/index.js --name "$PM2_NAME" --update-env || pm2 restart "$PM2_NAME" --update-env)
pm2 save >/dev/null 2>&1 || true

log "Restore finalizado. Revisá logs con: pm2 logs $PM2_NAME --lines 80"
