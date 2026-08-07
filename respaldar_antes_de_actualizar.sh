#!/usr/bin/env bash
set -Eeuo pipefail

# Lanzador corto para el respaldo completo de produccion. Mantener la logica en
# scripts/backup_production.sh permite usar el mismo procedimiento manualmente o
# desde una tarea programada.
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "${REPO_DIR}/scripts/backup_production.sh" "$@"
