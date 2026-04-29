#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${ROOT_DIR}/.dev-start.lockdir"
BACKEND_LOG="${ROOT_DIR}/backend/.dev-backend.log"
FRONTEND_LOG="${ROOT_DIR}/frontend/.dev-frontend.log"
BACKEND_PID_FILE="${ROOT_DIR}/backend/.dev-backend.pid"
FRONTEND_PID_FILE="${ROOT_DIR}/frontend/.dev-frontend.pid"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "[start-dev] another start-dev is running, abort"
  exit 1
fi
trap 'rmdir "${LOCK_DIR}" >/dev/null 2>&1 || true' EXIT

echo "[start-dev] root: ${ROOT_DIR}"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti :"${port}" 2>/dev/null || true)"
  if [[ -n "${pids}" ]]; then
    echo "[start-dev] freeing port ${port} (pids: ${pids//$'\n'/,})"
    while IFS= read -r pid; do
      [[ -z "${pid}" ]] && continue
      kill "${pid}" >/dev/null 2>&1 || true
    done <<< "${pids}"
    sleep 0.6
    pids="$(lsof -ti :"${port}" 2>/dev/null || true)"
    if [[ -n "${pids}" ]]; then
      while IFS= read -r pid; do
        [[ -z "${pid}" ]] && continue
        kill -9 "${pid}" >/dev/null 2>&1 || true
      done <<< "${pids}"
    fi
  fi
}

wait_port() {
  local port="$1"
  local tries="${2:-40}"
  local i
  for ((i=1; i<=tries; i++)); do
    if lsof -ti :"${port}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

# Stop old local dev processes started by this script.
if [[ -f "${BACKEND_PID_FILE}" ]]; then
  old_pid="$(cat "${BACKEND_PID_FILE}" || true)"
  if [[ -n "${old_pid}" ]]; then
    kill "${old_pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${BACKEND_PID_FILE}"
fi

if [[ -f "${FRONTEND_PID_FILE}" ]]; then
  old_pid="$(cat "${FRONTEND_PID_FILE}" || true)"
  if [[ -n "${old_pid}" ]]; then
    kill "${old_pid}" >/dev/null 2>&1 || true
  fi
  rm -f "${FRONTEND_PID_FILE}"
fi

# Also clear any stray processes already holding dev ports.
kill_port 8000
kill_port 3000

echo "[start-dev] starting backend on 127.0.0.1:8000"
(
  cd "${ROOT_DIR}" && \
  HERMES_WEBUI_ENABLED=1 \
  HERMES_WEBUI_AUTOSTART=1 \
  HERMES_SKIP_STARTUP_SESSION=1 \
  python3 -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
) >"${BACKEND_LOG}" 2>&1 &
backend_pid=$!
echo "${backend_pid}" > "${BACKEND_PID_FILE}"

echo "[start-dev] starting frontend on 127.0.0.1:3000"
(
  cd "${ROOT_DIR}/frontend"
  if [[ -f "${ROOT_DIR}/frontend/node_modules/vite/bin/vite.js" ]]; then
    exec node "${ROOT_DIR}/frontend/node_modules/vite/bin/vite.js" --host 127.0.0.1 --port 3000 --strictPort
  else
    exec npm run dev -- --host 127.0.0.1 --port 3000 --strictPort
  fi
) >"${FRONTEND_LOG}" 2>&1 &
frontend_pid=$!
echo "${frontend_pid}" > "${FRONTEND_PID_FILE}"

if ! wait_port 8000 60; then
  echo "[start-dev] backend failed to listen on 8000, see ${BACKEND_LOG}"
  kill "${backend_pid}" >/dev/null 2>&1 || true
  kill "${frontend_pid}" >/dev/null 2>&1 || true
  exit 1
fi
if ! wait_port 3000 60; then
  echo "[start-dev] frontend failed to listen on 3000, see ${FRONTEND_LOG}"
  kill "${backend_pid}" >/dev/null 2>&1 || true
  kill "${frontend_pid}" >/dev/null 2>&1 || true
  exit 1
fi

# Refresh pid files using real listener pids.
backend_listener_pid="$(lsof -tiTCP:8000 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
frontend_listener_pid="$(lsof -tiTCP:3000 -sTCP:LISTEN 2>/dev/null | head -n 1 || true)"
if [[ -n "${backend_listener_pid}" ]]; then
  echo "${backend_listener_pid}" > "${BACKEND_PID_FILE}"
fi
if [[ -n "${frontend_listener_pid}" ]]; then
  echo "${frontend_listener_pid}" > "${FRONTEND_PID_FILE}"
fi

echo "[start-dev] backend pid=${backend_pid}, frontend pid=${frontend_pid}"
echo "[start-dev] logs:"
echo "  - ${BACKEND_LOG}"
echo "  - ${FRONTEND_LOG}"
echo "[start-dev] run self-test: bash scripts/self-test.sh"
