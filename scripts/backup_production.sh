#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_ROOT="${BACKUP_ROOT:-${APP_DIR}_backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${STAMP}"
ARCHIVE_NAME="app-${STAMP}.tar.gz"
MONGO_ARCHIVE_NAME="mongo-${STAMP}.archive.gz"
MANIFEST_FILE="${BACKUP_DIR}/manifest.txt"

log() {
  printf '[backup] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    return 1
  fi
}

read_env_value() {
  local key="$1"
  local env_file="${APP_DIR}/backend/.env"
  if [[ ! -f "$env_file" ]]; then
    return 1
  fi
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^"|"$/, "")
      gsub(/^'"'"'|'"'"'$/, "")
      print
      exit
    }
  ' "$env_file"
}

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

log "Aplicación: $APP_DIR"
log "Destino: $BACKUP_DIR"

{
  echo "Backup GestionThibe"
  echo "Fecha UTC: $STAMP"
  echo "Aplicación: $APP_DIR"
  echo "Host: $(hostname)"
  echo "Usuario: $(id -un)"
  echo "Git commit: $(git -C "$APP_DIR" rev-parse --short HEAD 2>/dev/null || echo 'sin-git')"
  echo "Git branch: $(git -C "$APP_DIR" branch --show-current 2>/dev/null || echo 'sin-git')"
} > "$MANIFEST_FILE"

log "Respaldando archivos de la aplicación..."
tar \
  --exclude='./.git' \
  --exclude='./backend/node_modules' \
  --exclude='./frontend/node_modules' \
  --exclude='./frontend/dist' \
  --exclude='./backend/uploads/tmp' \
  -C "$APP_DIR" \
  -czf "${BACKUP_DIR}/${ARCHIVE_NAME}" \
  .
chmod 600 "${BACKUP_DIR}/${ARCHIVE_NAME}"

log "Guardando estado PM2 si está disponible..."
if require_command pm2; then
  pm2 jlist > "${BACKUP_DIR}/pm2-jlist.json" 2>/dev/null || true
  pm2 list > "${BACKUP_DIR}/pm2-list.txt" 2>/dev/null || true
fi
if [[ -d "${HOME}/.pm2" ]]; then
  tar -C "$HOME" -czf "${BACKUP_DIR}/pm2-home-${STAMP}.tar.gz" .pm2/dump.pm2 .pm2/logs 2>/dev/null || true
  chmod 600 "${BACKUP_DIR}/pm2-home-${STAMP}.tar.gz" 2>/dev/null || true
fi

MONGO_URI="${MONGO_URI:-$(read_env_value MONGO_URI || true)}"
MONGO_DB_NAME="${MONGO_DB_NAME:-$(read_env_value MONGO_DB_NAME || true)}"
if [[ -z "${MONGO_URI}" ]]; then
  MONGO_URI="mongodb://localhost:27017/${MONGO_DB_NAME:-gestionthibe}"
fi

log "Respaldando MongoDB..."
if require_command mongodump; then
  if mongodump --uri="$MONGO_URI" --archive="${BACKUP_DIR}/${MONGO_ARCHIVE_NAME}" --gzip; then
    chmod 600 "${BACKUP_DIR}/${MONGO_ARCHIVE_NAME}"
    echo "Mongo archive: ${MONGO_ARCHIVE_NAME}" >> "$MANIFEST_FILE"
  else
    log "ERROR: mongodump falló. El backup de aplicación existe, pero falta MongoDB."
    exit 1
  fi
else
  log "ERROR: mongodump no está instalado. Instalá mongodb-database-tools para respaldar la base."
  exit 1
fi

sha256sum "${BACKUP_DIR}/${ARCHIVE_NAME}" "${BACKUP_DIR}/${MONGO_ARCHIVE_NAME}" > "${BACKUP_DIR}/SHA256SUMS"
chmod 600 "${BACKUP_DIR}/SHA256SUMS" "$MANIFEST_FILE"

log "Backup terminado correctamente."
log "Carpeta: $BACKUP_DIR"
log "Archivo app: ${BACKUP_DIR}/${ARCHIVE_NAME}"
log "Archivo Mongo: ${BACKUP_DIR}/${MONGO_ARCHIVE_NAME}"
