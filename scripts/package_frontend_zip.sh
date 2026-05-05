#!/usr/bin/env bash
# 前端 npm run build 后，将 frontend/dist 打成 ZIP（根目录为 HermesBungalow-frontend-<时间戳>/）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(date +%Y%m%d-%H%M)"
STAGE_PARENT="${ROOT}/dist/.stage-frontend-${VER}"
STAGE_NAME="HermesBungalow-frontend-${VER}"
STAGE="${STAGE_PARENT}/${STAGE_NAME}"
ZIP="${ROOT}/dist/${STAGE_NAME}.zip"

mkdir -p "${ROOT}/dist"
rm -rf "${STAGE_PARENT}"
mkdir -p "${STAGE}"

echo "[package-frontend] npm run build"
(cd "${ROOT}/frontend" && npm run build)

echo "[package-frontend] copy dist -> ${STAGE}"
cp -R "${ROOT}/frontend/dist/." "${STAGE}/"

echo "[package-frontend] zip -> ${ZIP}"
(
  cd "${STAGE_PARENT}"
  rm -f "${ZIP}"
  zip -rq "${ZIP}" "${STAGE_NAME}"
)

rm -rf "${STAGE_PARENT}"

echo "[package-frontend] done: ${ZIP}"
ls -lh "${ZIP}"
