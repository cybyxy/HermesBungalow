"""Auto-extracted from service.py."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from .models import TaskWorld
from .persistence import get_save_meta, load_world_from_db, save_world_to_db


class HermesSessionsMixin:
    """Mixin providing hermes_sessions operations for TaskService."""

    def persist(self, slot: str = "default") -> None:
        with self._lock:
            save_world_to_db(self._conn, self._world, slot)

    def load_slot(self, slot: str = "default") -> bool:
        from .persistence import world_from_dict

        with self._lock:
            cur = self._conn.execute("SELECT payload FROM task_saves WHERE slot = ?", (slot,))
            row = cur.fetchone()
            if not row:
                return False
            self._world = world_from_dict(json.loads(row["payload"]))
            if not self.sync_agents_from_hermes():
                self.sync_room_occupancy()
        try:
            self.refresh_hermes_sessions_after_agent_list_change()
        except Exception:
            pass
        return True

    def _default_hermes_workspace(self) -> str:
        return str((Path.home() / "ai_projects" / "HermesBungalow" / "agent_workspace").resolve())

    def _create_hermes_session_sync(self, profile: str) -> str:
        from api.config import get_config
        from api.models import clear_bungalow_game_session_root, new_session, set_bungalow_game_session_root
        from api.profiles import game_session_dir_for_profile

        ws = self._default_hermes_workspace()
        root = game_session_dir_for_profile(profile)
        try:
            set_bungalow_game_session_root(root)
            s = new_session(workspace=ws, model=None, profile=profile)
            model = s.model
            if not model:
                try:
                    cfg = get_config()
                    model = str(cfg.get("model") or "").strip()
                except Exception:
                    model = ""
                if not model:
                    model = "mini-max-4-official"
            s.workspace = ws
            s.model = model
            s.save()
            return s.session_id
        finally:
            clear_bungalow_game_session_root()

    def _warm_hermes_session_from_disk(self, sid: str, expected_profile: str) -> bool:
        """Load session JSON into process LRU if file exists and profile matches agent."""
        import shutil

        from api.config import SESSION_DIR as web_session_dir
        from api.models import (
            Session,
            clear_bungalow_game_session_root,
            get_session,
            set_bungalow_game_session_root,
        )
        from api.profiles import game_session_dir_for_profile

        prof_dir = game_session_dir_for_profile(expected_profile)
        prof_p = prof_dir / f"{sid}.json"
        web_p = web_session_dir / f"{sid}.json"
        if not prof_p.exists() and web_p.exists() and prof_dir.resolve() != web_session_dir.resolve():
            try:
                shutil.copy2(web_p, prof_p)
                web_p.unlink(missing_ok=True)
            except Exception:
                pass
        if prof_p.exists():
            resolved = prof_dir
        elif web_p.exists():
            resolved = web_session_dir
        else:
            return False

        set_bungalow_game_session_root(resolved)
        try:
            s = Session.load(sid)
            if not s:
                return False
            sp = str(getattr(s, "profile", None) or "default")
            if sp != (expected_profile or "default"):
                return False
            try:
                get_session(sid)
            except KeyError:
                return False
            return True
        finally:
            clear_bungalow_game_session_root()

    def get_hermes_session_id(self, agent_id: str) -> str | None:
        with self._lock:
            return self._hermes_session_by_agent.get(agent_id)

    def record_hermes_session_if_rotated(self, agent_id: str, new_session_id: str) -> None:
        """After Hermes context compression, the chat session id may change.

        Keep ``Agent.hermes_session_id`` and the in-memory session map aligned so
        the next ``ensure_hermes_session_for_agent`` / ``get_session`` call does not
        use a stale id (KeyError / session not found / 404).
        """
        nid = (new_session_id or "").strip()
        if not nid:
            return
        changed = False
        with self._lock:
            agent = next((x for x in self._world.agents if x.id == agent_id), None)
            if not agent:
                return
            prev = (
                self._hermes_session_by_agent.get(agent_id)
                or (getattr(agent, "hermes_session_id", None) or "")
            )
            prev = str(prev).strip()
            if prev == nid:
                return
            self._hermes_session_by_agent[agent_id] = nid
            agent.hermes_session_id = nid
            changed = True
        if changed:
            self.persist()

    def ensure_hermes_session_for_agent(self, agent_id: str) -> str:
        """Return a Hermes chat session id for the agent.

        Reuses the process map or persisted ``Agent.hermes_session_id`` only when
        ``_warm_hermes_session_from_disk`` succeeds (session JSON exists and profile
        matches). Otherwise creates a new session and saves it on the agent.
        """
        if os.environ.get("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            with self._lock:
                self._hermes_session_by_agent.setdefault(agent_id, f"test-session-{agent_id}")
                return self._hermes_session_by_agent[agent_id]
        with self._lock:
            agent = next((x for x in self._world.agents if x.id == agent_id), None)
            if not agent:
                raise KeyError(agent_id)
            profile = str(getattr(agent, "profile", None) or "default")
            persisted = str(getattr(agent, "hermes_session_id", None) or "").strip() or None
            mapped = str(self._hermes_session_by_agent.get(agent_id) or "").strip() or None

        candidates: list[str] = []
        if mapped:
            candidates.append(mapped)
        if persisted and persisted not in candidates:
            candidates.append(persisted)

        chosen: str | None = None
        for cand in candidates:
            if self._warm_hermes_session_from_disk(cand, profile):
                chosen = cand
                break

        if chosen:
            with self._lock:
                ag = next((x for x in self._world.agents if x.id == agent_id), None)
                if not ag:
                    raise KeyError(agent_id)
                self._hermes_session_by_agent[agent_id] = chosen
                ag.hermes_session_id = chosen
            return chosen

        sid = self._create_hermes_session_sync(profile)
        with self._lock:
            if agent_id in self._hermes_session_by_agent:
                return self._hermes_session_by_agent[agent_id]
            ag = next((x for x in self._world.agents if x.id == agent_id), None)
            if not ag:
                raise KeyError(agent_id)
            self._hermes_session_by_agent[agent_id] = sid
            ag.hermes_session_id = sid
        self.persist()
        return sid

    def clear_agent_session(self, agent_id: str) -> None:
        """删除 agent 的 Hermes session 文件与内存映射，下次聊天创建新 session。"""
        from api.models import clear_bungalow_game_session_root, set_bungalow_game_session_root
        from api.profiles import game_session_dir_for_profile

        with self._lock:
            agent = next((a for a in self._world.agents if a.id == agent_id), None)
            if not agent:
                return
            profile = str(getattr(agent, "profile", None) or "default")
            old_sid = str(getattr(agent, "hermes_session_id", None) or "").strip()
            agent.hermes_session_id = ""
        if old_sid:
            prof_dir = game_session_dir_for_profile(profile)
            try:
                set_bungalow_game_session_root(prof_dir)
                from api.models import Session
                try:
                    s = Session.load(old_sid)
                    if s:
                        s.delete()
                except Exception:
                    pass
            finally:
                clear_bungalow_game_session_root()
            session_path = prof_dir / f"{old_sid}.json"
            try:
                session_path.unlink(missing_ok=True)
            except Exception:
                pass
        with self._lock:
            self._hermes_session_by_agent.pop(agent_id, None)

    def refresh_hermes_sessions_after_agent_list_change(self) -> None:
        if os.environ.get("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            with self._lock:
                for a in self._world.agents:
                    self._hermes_session_by_agent.setdefault(a.id, f"test-session-{a.id}")
                for dead in list(self._hermes_session_by_agent.keys()):
                    if dead not in {x.id for x in self._world.agents}:
                        del self._hermes_session_by_agent[dead]
            return
        with self._lock:
            valid = {a.id for a in self._world.agents}
            for dead in list(self._hermes_session_by_agent.keys()):
                if dead not in valid:
                    del self._hermes_session_by_agent[dead]
            agents_snapshot = list(self._world.agents)
        for a in agents_snapshot:
            try:
                self.ensure_hermes_session_for_agent(a.id)
            except Exception:
                pass

    # ── Agent 工作单监视（orchestrate / relay 落库）──────────────────────────

