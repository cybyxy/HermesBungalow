#!/usr/bin/env bash
# 生成可拷到 Windows（或任意机）的 zip：backend + frontend/dist + requirements + Windows 启动脚本
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(date +%Y%m%d-%H%M)"
STAGE="${ROOT}/dist/HermesBungalow-${VER}"
ZIP="${ROOT}/dist/HermesBungalow-${VER}.zip"

mkdir -p "${ROOT}/dist"
rm -rf "${STAGE}"
mkdir -p "${STAGE}/backend" "${STAGE}/frontend/dist"

echo "[package] frontend: npm run build"
(cd "${ROOT}/frontend" && npm run build)

echo "[package] copy backend (exclude venv / pycache)"
(
  cd "${ROOT}/backend"
  tar cf - \
    --exclude='__pycache__' \
    --exclude='.venv' \
    --exclude='*.pyc' \
    --exclude='.dev-backend.log' \
    --exclude='.dev-backend.pid' \
    .
) | (cd "${STAGE}/backend" && tar xf -)

echo "[package] copy frontend/dist"
cp -R "${ROOT}/frontend/dist/." "${STAGE}/frontend/dist/"

cp "${ROOT}/backend/requirements.txt" "${STAGE}/"
cp "${ROOT}/scripts/windows/README-WINDOWS.txt" "${STAGE}/"
cp "${ROOT}/scripts/windows/start-bungalow.ps1" "${STAGE}/"

echo "[package] zip -> ${ZIP}"
(
  cd "${ROOT}/dist"
  rm -f "$(basename "${ZIP}")"
  zip -rq "$(basename "${ZIP}")" "$(basename "${STAGE}")"
)

echo "[package] done: ${ZIP}"
ls -lh "${ZIP}"
