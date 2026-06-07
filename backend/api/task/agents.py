"""Auto-extracted from service.py."""
from __future__ import annotations

import os
from typing import Any

from .models import Agent
from .persistence import _connect


class AgentsMixin:
    """Mixin providing agents operations for TaskService."""

    def sync_agents_from_hermes(self) -> bool:
        """Replace world agents with one entry per Hermes profile.

        Source is Hermes profile list + each profile's SOUL/config display name.
        Set HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC=1 to disable (tests).
        """
        if os.environ.get("HERMES_BUNGALOW_SKIP_HERMES_AGENT_SYNC", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            return False
        from api.hermes_personalities import list_hermes_profile_agents

        rows = list_hermes_profile_agents()
        if not rows:
            return False
        with self._lock:
            old_list = list(self._world.agents)
            old_by_id = {a.id: a for a in old_list}
            old_by_name = {a.name: a for a in old_list}
            DEFAULT_PROFESSION = "分析师"
            new_agents: list[Agent] = []
            for i, one in enumerate(rows):
                name = one["name"]
                desc = one.get("description") or ""
                aid = one["id"]
                old = old_by_id.get(aid) or old_by_name.get(name)
                # 已持久化的职业优先（用户可能在 UI 中修改过）
                if old and str(getattr(old, "profession", "") or "").strip():
                    prof = str(old.profession).strip()
                else:
                    prof_raw = one.get("profession") or ""
                    prof = prof_raw.strip() or DEFAULT_PROFESSION
                # display_name: keep DB value if exists, otherwise use Hermes display_name or name
                if old and str(getattr(old, "display_name", "") or "").strip():
                    dis_name = str(old.display_name).strip()
                else:
                    dis_name = str(one.get("display_name") or "").strip() or name
                pers_raw = one.get("personality")
                pers = pers_raw if pers_raw is not None and pers_raw != "" else (desc if len(desc) <= 500 else desc[:500] + "…")
                catchphrase_raw = one.get("catchphrase")
                if catchphrase_raw is not None and catchphrase_raw != "":
                    snippet = catchphrase_raw[0] if isinstance(catchphrase_raw, list) and catchphrase_raw else str(catchphrase_raw)
                else:
                    snippet = (desc[:80] + "…") if len(desc) > 80 else desc
                memes = list(one.get("memes") or [])
                avatar_val = str(one.get("avatar") or "")
                gender_val = str(one.get("gender") or "male")
                if old:
                    new_agents.append(
                        Agent(
                            id=aid,
                            name=name,
                            display_name=dis_name,
                            profession=prof,
                            profile=str(one.get("profile") or "default"),
                            gender=gender_val or old.gender,
                            catchphrase=snippet or old.catchphrase,
                            personality=pers or old.personality,
                            memes=memes or list(old.memes),
                            avatar=avatar_val or old.avatar,
                            reasoning_model=old.reasoning_model,
                            channel=getattr(old, "channel", "") or "",
                            current_task_id=old.current_task_id,
                            hermes_session_id=getattr(old, "hermes_session_id", None),
                        )
                    )
                else:
                    new_agents.append(
                        Agent(
                            id=aid,
                            name=name,
                            display_name=dis_name,
                            profession=prof,
                            profile=str(one.get("profile") or "default"),
                            catchphrase=snippet,
                            personality=pers,
                            memes=memes,
                            avatar=avatar_val,
                            gender=gender_val,
                        )
                    )
            self._world.agents = new_agents
            valid = {a.id for a in new_agents}
            for t in self._world.tasks:
                if t.assignee_id and t.assignee_id not in valid:
                    tid = t.id
                    for a in self._world.agents:
                        if a.current_task_id == tid:
                            a.current_task_id = None
                    t.assignee_id = None
                    if t.status == "in_progress":
                        t.status = "pending"
            self._append_event_log(
                "hermes_agents_sync",
                {"count": len(new_agents), "source": "hermes.profile_list"},
            )
        self.persist()
        try:
            self.refresh_hermes_sessions_after_agent_list_change()
        except Exception:
            pass
        return True

    def add_agent(self, payload: dict[str, Any]) -> Agent:
        with self._lock:
            aid = str(payload.get("id") or chr(65 + len(self._world.agents)))
            profile_key = str(payload.get("profile") or "")
            agent_name = str(payload.get("name") or "新Agent")
            skills = payload.get("skills") or [{"name": "通用", "level": 3}]
            agent = Agent(
                id=aid,
                name=agent_name,
                display_name=str(payload.get("display_name") or agent_name),
                profession=str(payload.get("profession") or "程序员"),
                profile=str(payload.get("profile") or "default"),
                gender=str(payload.get("gender") or "random"),
                catchphrase=str(payload.get("catchphrase") or ""),
                personality=str(payload.get("personality") or ""),
                skills=skills,
            )
            self._world.agents.append(agent)
            self._append_event_log("agent_add", {"agent_id": agent.id})
            self._broadcast("agent_status", {"action": "add", "agent": agent.to_dict()})
            self.persist()
        try:
            self.ensure_hermes_session_for_agent(agent.id)
        except Exception:
            pass
        return agent

    def delete_agent(self, agent_id: str) -> dict[str, Any]:
        with self._lock:
            agent = next((a for a in self._world.agents if a.id == agent_id), None)
            if not agent:
                return {"ok": False, "error": "agent_not_found"}
            if agent.name == "default":
                return {"ok": False, "error": "cannot_delete_default_agent"}
            aid = agent.id
            profile = getattr(agent, "profile", None) or "default"
            for t in self._world.tasks:
                if t.assignee_id == aid:
                    t.assignee_id = None
                    if t.status == "in_progress":
                        t.status = "pending"
            self._world.agents = [a for a in self._world.agents if a.id != aid]
            self._hermes_session_by_agent.pop(aid, None)
            self._append_event_log("agent_delete", {"agent_id": aid, "name": agent.name})
            self._broadcast("agent_status", {"action": "delete", "agent": agent.to_dict()})

        # Stop the agent subprocess (outside lock to avoid deadlock)
        try:
            from api.multi_agent_gateway import MANAGER
            agent_proc = MANAGER.get(profile)
            if agent_proc is not None and agent_proc.is_alive():
                agent_proc.stop()
        except Exception:
            pass

        # Remove profile directory
        try:
            from api.profiles import _DEFAULT_HERMES_HOME
            if profile == "default":
                # Only clean sessions for default profile — never delete ~/.hermes
                _clean_profile_sessions(_DEFAULT_HERMES_HOME)
            else:
                profile_dir = _DEFAULT_HERMES_HOME / "profiles" / profile
                if profile_dir.is_dir():
                    import shutil
                    shutil.rmtree(profile_dir)
        except Exception:
            pass

        return {"ok": True, "agent_id": aid}

    def update_agent(self, payload: dict[str, Any]) -> Agent | None:
        aid = str(payload.get("id") or "")
        with self._lock:
            for a in self._world.agents:
                if a.id == aid:
                    for key, val in payload.items():
                        if key == "id" or not hasattr(a, key):
                            continue
                        if key == "profession" and val is not None:
                            val = str(val).strip()
                        setattr(a, key, val)
                    self._append_event_log("agent_update", {"agent_id": a.id})
                    self.persist()
                    self._broadcast("agent_status", {"action": "update", "agent": a.to_dict()})
                    return a
        return None


