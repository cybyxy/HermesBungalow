#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="${ROOT_DIR}/.dev-start.lockdir"
BACKEND_PID_FILE="${ROOT_DIR}/backend/.dev-backend.pid"
FRONTEND_PID_FILE="${ROOT_DIR}/frontend/.dev-frontend.pid"

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti :"${port}" 2>/dev/null || true)"
  if [[ -z "${pids}" ]]; then
    echo "[stop-dev] port ${port}: no listeners"
    return
  fi
  echo "[stop-dev] port ${port}: stopping ${pids//$'\n'/,}"
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
}

stop_by_pid_file() {
  local name="$1"
  local pid_file="$2"

  if [[ ! -f "${pid_file}" ]]; then
    echo "[stop-dev] ${name}: pid file not found, skip"
    return
  fi

  local pid
  pid="$(cat "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    echo "[stop-dev] ${name}: empty pid, remove pid file"
    rm -f "${pid_file}"
    return
  fi

  if kill -0 "${pid}" >/dev/null 2>&1; then
    kill "${pid}" >/dev/null 2>&1 || true
    sleep 0.5
    if kill -0 "${pid}" >/dev/null 2>&1; then
      kill -9 "${pid}" >/dev/null 2>&1 || true
    fi
    echo "[stop-dev] ${name}: stopped pid=${pid}"
  else
    echo "[stop-dev] ${name}: pid=${pid} not running"
  fi

  rm -f "${pid_file}"
}

stop_by_pid_file "backend" "${BACKEND_PID_FILE}"
stop_by_pid_file "frontend" "${FRONTEND_PID_FILE}"
kill_port 8000
kill_port 3000
rmdir "${LOCK_DIR}" >/dev/null 2>&1 || true
rm -f "${ROOT_DIR}/.dev-start.lock" >/dev/null 2>&1 || true

echo "[stop-dev] done"
