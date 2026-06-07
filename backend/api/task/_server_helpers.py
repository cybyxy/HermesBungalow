"""Shared state and helpers for server.py route handlers.

Import this module AFTER ``server.task_service`` is initialized to avoid circular imports.
"""
from __future__ import annotations

import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any


def _ensure_hermes_agent_on_syspath() -> None:
    hermes_agent = Path.home() / ".hermes" / "hermes-agent"
    if str(hermes_agent) not in sys.path and hermes_agent.is_dir():
        sys.path.insert(0, str(hermes_agent))


# ── SSE / Multi-round session state ──────────────────────────────────

_ORCH_SSE_LOCK = threading.Lock()
_ORCH_SSE_QUEUES: dict[str, queue.Queue] = {}

_MULTI_ROUND_LOCK = threading.Lock()
_MULTI_ROUND_SESSIONS: dict[str, dict[str, Any]] = {}
_MULTI_ROUND_TTL_SEC = int(os.getenv("HERMES_BUNGALOW_MULTI_ROUND_TTL_SEC", "1800"))


def _cleanup_stale_multi_round_sessions() -> None:
    now = time.time()
    with _MULTI_ROUND_LOCK:
        stale = [
            sid for sid, s in _MULTI_ROUND_SESSIONS.items()
            if now - s.get("created_at", 0) > _MULTI_ROUND_TTL_SEC
        ]
        for sid in stale:
            _MULTI_ROUND_SESSIONS.pop(sid, None)


def _resolve_game_agent_token(token: str, task_service: Any):
    """Resolve an agent by id/profile/name/display_name（wrapper for route files）。"""
    from api.task.orchestration import resolve_game_agent_token

    return resolve_game_agent_token(token, task_service)


def _resolve_game_agent_from_body(body: dict[str, Any], task_service: Any):
    """Resolve an agent from a JSON request body (reads ``agent_id`` field)."""
    agent_id = str(body.get("agent_id") or "").strip()
    if not agent_id:
        return None
    return _resolve_game_agent_token(agent_id, task_service)


def _sync_session_turn(
    session_id: str, message: str, task_service: Any, *, bungalow_agent_id: str | None = None
) -> dict[str, Any]:
    """Thin wrapper around ``orchestration.sync_session_turn`` for route files."""
    from api.task.orchestration import sync_session_turn

    return sync_session_turn(
        session_id, message, task_service, bungalow_agent_id=bungalow_agent_id
    )


def _orchestrate_turn_sync(
    primary_agent: Any,
    user_message: str,
    auto_peer: bool,
    task_service: Any,
    **kwargs: Any,
) -> dict[str, Any]:
    """Thin wrapper around ``orchestration.orchestrated_peer_turns_sync`` for route files."""
    from api.task.orchestration import orchestrated_peer_turns_sync

    return orchestrated_peer_turns_sync(
        primary_agent, user_message, auto_peer, task_service, **kwargs
    )
