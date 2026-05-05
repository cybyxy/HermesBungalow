#!/usr/bin/env bash
# 将整个仓库打成 ZIP（含 .git、源码与文档；排除 node_modules / 虚拟环境 / 构建产物等以控制体积）
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VER="$(date +%Y%m%d-%H%M)"
mkdir -p "${ROOT}/dist"
OUT="${ROOT}/dist/HermesBungalow-full-${VER}.zip"
TMP="/tmp/HermesBungalow-full-${VER}.$$.zip"

cd "$ROOT"
rm -f "$OUT" "$TMP"

echo "[package-full] creating $OUT"

zip -rq "$TMP" . \
  -x "*node_modules/*" \
  -x "*node_modules*" \
  -x "*__pycache__/*" \
  -x "*__pycache__*" \
  -x "*.pyc" \
  -x "*.pyo" \
  -x ".venv/*" \
  -x "backend/.venv/*" \
  -x ".pytest_cache/*" \
  -x "frontend/dist/*" \
  -x "dist/*.zip" \
  -x ".DS_Store" \
  -x "*.tsbuildinfo" \
  -x ".cursor/*" \
  -x "terminals/*" \
  -x "*.log"

mv "$TMP" "$OUT"
ls -lh "$OUT"
echo "[package-full] done"
