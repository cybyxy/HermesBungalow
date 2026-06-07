"""Hermes 数字工作室 —— 任务管理服务（多 Agent 编排 + 任务链 DAG）。"""
from __future__ import annotations

import atexit
import contextlib
import json
import os
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from .models import Agent, TaskWorld, Task
from .persistence import init_db, load_world_from_db, _connect

from .peers import PeersMixin
from .agents import AgentsMixin
from .task_ops import TaskOpsMixin
from .hermes_sessions import HermesSessionsMixin
from .monitor_ops import MonitorOpsMixin

EmitFn = Callable[[str, dict[str, Any]], None]

_META_PEER_PRESETS = "bungalow_peer_presets"
_META_ACTIVE_OUTBOUND = "bungalow_active_outbound"


def _collect_orchestrate_reply_texts(result: dict[str, Any]) -> list[str]:
    """Gather primary + delegation Hermes reply bodies for ``[[GAME_EVENT:…]]`` parsing."""
    out: list[str] = []

    def walk(x: Any) -> None:
        if isinstance(x, dict):
            r = x.get("reply")
            if isinstance(r, str) and r.strip():
                out.append(r)
            for k in ("nested", "delegations"):
                v = x.get(k)
                if isinstance(v, list):
                    for it in v:
                        walk(it)
        elif isinstance(x, list):
            for it in x:
                walk(it)

    prim = result.get("primary")
    if isinstance(prim, dict):
        walk(prim)
    dels = result.get("delegations")
    if isinstance(dels, list):
        walk(dels)
    return out


def read_json_body(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return {}


@dataclass
class PeerVisitor:
    """Ephemeral row for a remote Hermes agent shown on this instance (not in world.agents)."""

    visitor_id: str
    relay_base_url: str
    relay_agent_id: str
    name: str
    display_name: str
    profession: str
    profile: str


@contextlib.contextmanager
def bungalow_session_tls_for_agent_id(task_service: Any, bungalow_agent_id: str | None):
    """Set thread-local Hermes session JSON root to the agent's profile ``sessions/``."""
    if not bungalow_agent_id:
        yield
        return
    from api.models import clear_bungalow_game_session_root, set_bungalow_game_session_root
    from api.profiles import game_session_dir_for_profile

    with task_service._lock:
        ag = next((x for x in task_service.world.agents if x.id == bungalow_agent_id), None)
    if ag is None:
        yield
        return
    prof = str(getattr(ag, "profile", None) or "default")
    set_bungalow_game_session_root(game_session_dir_for_profile(prof))
    try:
        yield
    finally:
        clear_bungalow_game_session_root()


def _clean_profile_sessions(base: Path) -> None:
    """Remove sessions directory for a profile, preserving the base directory."""
    sessions_dir = base / "sessions"
    if sessions_dir.is_dir():
        import shutil
        shutil.rmtree(sessions_dir)


class TaskService(PeersMixin, AgentsMixin, TaskOpsMixin, HermesSessionsMixin, MonitorOpsMixin):
    def __init__(self, db_path: str | Path | None = None) -> None:
        self._lock = threading.RLock()
        base = Path(__file__).resolve().parent.parent.parent / "data"
        self._db_path = Path(db_path) if db_path else base / "task.db"
        self._conn = _connect(self._db_path)
        init_db(self._conn)
        loaded = load_world_from_db(self._conn)
        self._world = loaded if loaded else TaskWorld()
        self._emit: EmitFn | None = None
        self._hermes_session_by_agent: dict[str, str] = {}
        self._peer_visitors: list[PeerVisitor] = []
        if not self.sync_agents_from_hermes():
            pass
        try:
            self.refresh_hermes_sessions_after_agent_list_change()
        except Exception:
            pass
        # 进程退出时自动存档
        atexit.register(self._auto_persist)

    def _auto_persist(self) -> None:
        try:
            self.persist()
        except Exception:
            pass

    def set_emit(self, fn: EmitFn | None) -> None:
        self._emit = fn

    def _broadcast(self, channel: str, data: dict[str, Any]) -> None:
        if self._emit:
            self._emit(channel, data)

    @property
    def world(self) -> TaskWorld:
        return self._world

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            d = self._world.to_dict()
            extras = [self._peer_visitor_public_dict(v) for v in self._peer_visitors]
            d["agents"] = list(d["agents"]) + extras
            d["peer_presets"] = self._peer_presets_for_api_unlocked()
            pub = self._active_outbound_public_unlocked()
            if pub:
                d["active_peer_visit"] = pub
            return d

    def _meta_get_unlocked(self, key: str) -> str | None:
        cur = self._conn.execute("SELECT value FROM task_meta WHERE key = ?", (key,))
        row = cur.fetchone()
        return str(row["value"]) if row else None

    def _meta_set_unlocked(self, key: str, value: str) -> None:
        self._conn.execute(
            "INSERT INTO task_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        self._conn.commit()

    def _append_event_log(self, kind: str, payload: dict[str, Any]) -> None:
        entry: dict[str, Any] = {"at": time.time(), "kind": kind, **payload}
        self._world.event_log.insert(0, entry)
        if len(self._world.event_log) > 80:
            self._world.event_log = self._world.event_log[:80]
