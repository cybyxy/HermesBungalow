#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# run_multi_agent.sh — Start Hermes Bungalow with multi-agent gateway
#
# Starts:
#   1. Agent processes (one per profile): ports 8001, 8002, ...
#   2. Main Bungalow server: port 8000 (WebSocket /ws/multi-agent)
#
# Usage:
#   ./scripts/run_multi_agent.sh          # start all
#   ./scripts/run_multi_agent.sh status  # show running agents
#   ./scripts/run_multi_agent.sh stop    # stop all agents
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/../backend"
SYSTEM_PYTHON="${PYTHON:-$(which python3)}"
HERMES_VENV_PYTHON="$HOME/.hermes/hermes-agent/venv/bin/python3"
if [[ -x "$HERMES_VENV_PYTHON" ]]; then
  PYTHON="$HERMES_VENV_PYTHON"
else
  PYTHON="$SYSTEM_PYTHON"
fi

# Agent profiles: "name|hermes_home" pairs (bash 3.2 compatible, no associative arrays)
AGENTS=(
  "default|$HOME/.hermes"
  "agent-993343|$HOME/.hermes/profiles/agent-993343"
)

BASE_PORT=8001
AGENT_PIDS=()

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Parse agent entry: returns profile name
agent_name() {
  echo "$1" | cut -d'|' -f1
}

# Parse agent entry: returns hermes_home
agent_home() {
  echo "$1" | cut -d'|' -f2
}

# Find a free port starting from a given number
find_free_port() {
  local port=$1
  while ss -tuln 2>/dev/null | grep -q ":$port "; do
    port=$((port + 1))
  done
  echo $port
}

start_agent() {
  local profile=$1
  local hermes_home=$2
  local port=$3

  # Check if already running on this port
  if ss -tuln 2>/dev/null | grep -q ":$port "; then
    log "Agent '$profile' already running on port $port"
    return 0
  fi

  log "Starting agent: profile=$profile, port=$port, HERMES_HOME=$hermes_home"

  env -u PYTHONHOME -u PYTHONPATH \
  "$PYTHON" \
    "$BACKEND_DIR/agent_server.py" \
    --profile "$profile" \
    --port "$port" \
    --hermes-home "$hermes_home" \
    >> "$HOME/.hermes/logs/agent-$profile.log" 2>&1 &

  AGENT_PIDS+=($!)
  log "Agent '$profile' started (pid=$!, port=$port)"
}

start_all_agents() {
  log "Starting agent processes..."

  local port=$BASE_PORT
  local idx=0
  for entry in "${AGENTS[@]}"; do
    local name=$(agent_name "$entry")
    local home=$(agent_home "$entry")
    start_agent "$name" "$home" $port
    port=$((port + 1))
    idx=$((idx + 1))
  done

  # Wait for agents to be ready
  sleep 3

  # Verify each agent
  idx=0
  for entry in "${AGENTS[@]}"; do
    local name=$(agent_name "$entry")
    local check_port=$((BASE_PORT + idx))
    if ss -tuln 2>/dev/null | grep -q ":$check_port "; then
      log "✓ Agent '$name' ready on port $check_port"
    else
      log "✗ Agent '$name' NOT ready on port $check_port"
    fi
    idx=$((idx + 1))
  done
}

start_server() {
  log "Starting Bungalow server on port 8000..."
  cd "$BACKEND_DIR"
  env -u PYTHONHOME -u PYTHONPATH \
  "$PYTHON" "$BACKEND_DIR/server.py"
}

status() {
  log "Agent processes:"
  local idx=0
  for entry in "${AGENTS[@]}"; do
    local name=$(agent_name "$entry")
    local check_port=$((BASE_PORT + idx))
    if ss -tuln 2>/dev/null | grep -q ":$check_port "; then
      echo "  ✓ $name (:$check_port)"
    else
      echo "  ✗ $name (:$check_port) — not running"
    fi
    idx=$((idx + 1))
  done

  if ss -tuln 2>/dev/null | grep -q ':8000 '; then
    echo "  ✓ Bungalow server (:8000)"
  else
    echo "  ✗ Bungalow server (:8000) — not running"
  fi
}

stop() {
  log "Stopping agent processes..."
  pkill -f "agent_server.py --profile" 2>/dev/null || true
  log "Agents stopped."
}

case "${1:-start}" in
  start)
    stop 2>/dev/null || true
    start_all_agents
    start_server
    ;;
  status)
    status
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    sleep 1
    start_all_agents
    start_server
    ;;
  *)
    echo "Usage: $0 {start|status|stop|restart}"
    exit 1
    ;;
esac
