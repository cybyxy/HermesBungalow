#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
FRONTEND_URL="${FRONTEND_URL:-http://127.0.0.1:3000}"

wait_http_ok() {
  local url="$1"
  local max_try="${2:-20}"
  local sleep_s="${3:-0.5}"
  local i
  for ((i=1; i<=max_try; i++)); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_s}"
  done
  return 1
}

echo "[self-test] checking backend health..."
wait_http_ok "${BACKEND_URL}/health" 30 0.5
echo "[self-test] backend ok"

echo "[self-test] checking frontend availability..."
wait_http_ok "${FRONTEND_URL}" 30 0.5
echo "[self-test] frontend ok"

echo "[self-test] checking hermes health-check..."
curl -fsS "${BACKEND_URL}/api/hermes/health-check?include_chat=0" >/dev/null
echo "[self-test] hermes health-check ok"

echo "[self-test] checking streaming chat endpoint..."
chat_output="$(curl -fsS -N -m 30 \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{"message":"你好，请只回复ok","stream":true}' \
  "${BACKEND_URL}/api/v1/chat")"

echo "${chat_output}" | rg "\"type\": \"done\"" >/dev/null
echo "${chat_output}" | rg "\"text\": \"ok\"" >/dev/null

echo "[self-test] stream chat ok"
echo "[self-test] all checks passed"
