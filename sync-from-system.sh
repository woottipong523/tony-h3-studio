#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "[SYNC] Syncing /start.sh, /opt/tony, and /opt/tony-mcp into ${REPO_DIR}..."

cp /start.sh "${REPO_DIR}/start.sh"

rm -rf "${REPO_DIR}/tony" "${REPO_DIR}/tony-mcp"
mkdir -p "${REPO_DIR}/tony" "${REPO_DIR}/tony-mcp"

tar -C /opt/tony \
  --exclude='__pycache__' \
  --exclude='*.pyc' \
  --exclude='./Dockerfile' \
  -cf - . | tar -C "${REPO_DIR}/tony" -xf -

tar -C /opt/tony-mcp \
  --exclude='node_modules' \
  -cf - . | tar -C "${REPO_DIR}/tony-mcp" -xf -

echo "[SYNC] Done."

