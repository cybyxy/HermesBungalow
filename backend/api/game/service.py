from __future__ import annotations

import atexit
import contextlib
import json
import os
import random
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

GREETING_ALLOWED_ROOMS = frozenset({"休息室", "会议室", "资料室", "机房"})
GREETING_COOLDOWN_SEC = 600.0
GAME_TICK_MINUTES = 1

from .competition import resolve_task_competition
from .llm_events import apply_parsed_events, extract_game_event_tags
from .models import Agent, GameWorld, Task, default_world
from .monitor_store import MonitorRecorder, record_orchestration_result, record_relay_result
from .persistence import get_save_meta, init_db, load_world_from_db, save_world_to_db, _connect

EmitFn = Callable[[str, dict[str, Any]], None]

_META_PEER_PRESETS = "bungalow_peer_presets"
_META_ACTIVE_OUTBOUND = "bungalow_active_outbound"

# 完成任务时的固定结算（不再使用 per-task 积分字段）
TASK_COMPLETE_XP = 50
TASK_COMPLETE_GOLD = 100


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
    location: str


@contextlib.contextmanager
def bungalow_session_tls_for_agent_id(game_service: Any, bungalow_agent_id: str | None):
    """Set thread-local Hermes session JSON root to the agent's profile ``sessions/``."""
    if not bungalow_agent_id:
        yield
        return
    from api.models import clear_bungalow_game_session_root, set_bungalow_game_session_root
    from api.profiles import game_session_dir_for_profile

    with game_service._lock:
        ag = next((x for x in game_service.world.agents if x.id == bungalow_agent_id), None)
    if ag is None:
        yield
        return
    prof = str(getattr(ag, "profile", None) or "default")
    set_bungalow_game_session_root(game_session_dir_for_profile(prof))
    try:
        yield
    finally:
        clear_bungalow_game_session_root()


class GameService:
    def __init__(self, db_path: str | Path | None = None) -> None:
        self._lock = threading.RLock()
        base = Path(__file__).resolve().parent.parent.parent / "data"
        self._db_path = Path(db_path) if db_path else base / "game.db"
        self._conn = _connect(self._db_path)
        init_db(self._conn)
        loaded = load_world_from_db(self._conn)
        self._world = loaded if loaded else default_world()
        self._emit: EmitFn | None = None
        self._greeting_cooldown: dict[frozenset[str], float] = {}
        self._hermes_session_by_agent: dict[str, str] = {}
        self._peer_visitors: list[PeerVisitor] = []
        if not self.sync_agents_from_hermes():
            self.sync_room_occupancy()
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
    def world(self) -> GameWorld:
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
        cur = self._conn.execute("SELECT value FROM game_meta WHERE key = ?", (key,))
        row = cur.fetchone()
        return str(row["value"]) if row else None

    def _meta_set_unlocked(self, key: str, value: str) -> None:
        self._conn.execute(
            "INSERT INTO game_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        self._conn.commit()

    def get_peer_presets_raw(self) -> list[dict[str, Any]]:
        with self._lock:
            raw = self._meta_get_unlocked(_META_PEER_PRESETS)
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return []
        return data if isinstance(data, list) else []

    def _peer_presets_for_api_unlocked(self) -> list[dict[str, Any]]:
        pub: list[dict[str, Any]] = []
        for p in self.get_peer_presets_raw():
            pid = str(p.get("id") or "").strip()
            if not pid:
                continue
            t = str(p.get("peer_token") or "").strip()
            pub.append(
                {
                    "id": pid,
                    "label": str(p.get("label") or pid).strip() or pid,
                    "base_url": str(p.get("base_url") or "").strip(),
                    "relay_agent_id": str(p.get("relay_agent_id") or "").strip(),
                    "has_peer_token": bool(t),
                }
            )
        return pub

    def get_peer_preset(self, preset_id: str) -> dict[str, Any] | None:
        pid = (preset_id or "").strip()
        if not pid:
            return None
        for p in self.get_peer_presets_raw():
            if str(p.get("id") or "").strip() == pid:
                return dict(p)
        return None

    def put_peer_presets(self, presets: list[Any]) -> dict[str, Any]:
        from api.game.peers import normalize_peer_base_url

        _MISSING = object()
        with self._lock:
            old_by_id = {str(p.get("id", "")).strip(): p for p in self.get_peer_presets_raw() if str(p.get("id") or "").strip()}
            out: list[dict[str, Any]] = []
            seen: set[str] = set()
            for p in presets:
                if not isinstance(p, dict):
                    continue
                pid = str(p.get("id") or "").strip()
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                label = str(p.get("label") or pid).strip() or pid
                base_url = str(p.get("base_url") or "").strip()
                if not base_url:
                    continue
                norm_base = normalize_peer_base_url(base_url)
                relay = str(p.get("relay_agent_id") or "").strip()
                tok_raw = p.get("peer_token", _MISSING)
                if tok_raw is _MISSING:
                    old_p = old_by_id.get(pid) or {}
                    old_t = old_p.get("peer_token")
                    tok = str(old_t).strip() if isinstance(old_t, str) else ""
                elif isinstance(tok_raw, str):
                    tok = tok_raw.strip()
                else:
                    tok = ""
                out.append(
                    {
                        "id": pid,
                        "label": label,
                        "base_url": norm_base,
                        "relay_agent_id": relay,
                        "peer_token": tok,
                    }
                )
            self._meta_set_unlocked(_META_PEER_PRESETS, json.dumps(out, ensure_ascii=False))
            return {"ok": True, "count": len(out)}

    def allowed_peer_bases(self) -> list[str]:
        from api.game.peers import load_peer_allowlist, normalize_peer_base_url

        bases = list(load_peer_allowlist())
        for p in self.get_peer_presets_raw():
            u = str(p.get("base_url") or "").strip()
            if not u:
                continue
            try:
                bases.append(normalize_peer_base_url(u))
            except ValueError:
                pass
        return sorted(set(bases))

    def get_active_outbound_visit(self) -> dict[str, Any] | None:
        with self._lock:
            raw = self._meta_get_unlocked(_META_ACTIVE_OUTBOUND)
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        if not str(data.get("visitor_id") or "").strip() or not str(data.get("target_base_url") or "").strip():
            return None
        return data

    def _active_outbound_public_unlocked(self) -> dict[str, Any] | None:
        raw = self._meta_get_unlocked(_META_ACTIVE_OUTBOUND)
        if not raw:
            return None
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            return None
        if not isinstance(data, dict):
            return None
        if not str(data.get("visitor_id") or "").strip():
            return None
        return {
            "preset_id": str(data.get("preset_id") or ""),
            "label": str(data.get("label") or ""),
            "target_base_url": str(data.get("target_base_url") or ""),
        }

    def set_active_outbound_visit(self, preset_id: str, label: str, target_base_url: str, visitor_id: str) -> None:
        from api.game.peers import normalize_peer_base_url

        tgt = normalize_peer_base_url(target_base_url)
        payload = json.dumps(
            {
                "preset_id": (preset_id or "").strip(),
                "label": label or "",
                "target_base_url": tgt,
                "visitor_id": visitor_id.strip(),
            },
            ensure_ascii=False,
        )
        with self._lock:
            self._meta_set_unlocked(_META_ACTIVE_OUTBOUND, payload)

    def clear_active_outbound_visit(self) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM game_meta WHERE key = ?", (_META_ACTIVE_OUTBOUND,))
            self._conn.commit()

    def peer_visitor_as_agent(self, v: PeerVisitor) -> Agent:
        return Agent(
            id=v.visitor_id,
            name=v.name,
            display_name=v.display_name or v.name,
            profession=v.profession,
            profile=v.profile,
            location=v.location,
            status="idle",
            peer_relay_base_url=v.relay_base_url,
            peer_relay_agent_id=v.relay_agent_id,
            hermes_session_id=None,
        )

    def _peer_visitor_public_dict(self, v: PeerVisitor) -> dict[str, Any]:
        d = self.peer_visitor_as_agent(v).to_dict()
        d["bungalow_peer_api"] = 1
        d["hermes_session_id"] = ""
        return d

    def iter_agents_for_api(self):
        with self._lock:
            for a in self._world.agents:
                yield a
            for v in self._peer_visitors:
                yield self.peer_visitor_as_agent(v)

    def iter_agents_for_token_resolve(self):
        with self._lock:
            world = list(self._world.agents)
            visitors = [self.peer_visitor_as_agent(v) for v in self._peer_visitors]
        yield from world
        yield from visitors

    def register_peer_visitor(self, v: PeerVisitor) -> None:
        with self._lock:
            self._peer_visitors = [
                x
                for x in self._peer_visitors
                if not (x.relay_base_url == v.relay_base_url and x.relay_agent_id == v.relay_agent_id)
            ]
            self._peer_visitors.append(v)
            self.sync_room_occupancy()
            self._append_event_log("peer_visit", {"visitor_id": v.visitor_id, "source": v.relay_base_url})
            self._broadcast("agent_status", {"action": "peer_visit", "agent": self._peer_visitor_public_dict(v)})

    def revoke_peer_visitor(self, visitor_id: str) -> bool:
        with self._lock:
            before = len(self._peer_visitors)
            self._peer_visitors = [x for x in self._peer_visitors if x.visitor_id != visitor_id]
            if len(self._peer_visitors) == before:
                return False
            self.sync_room_occupancy()
            self._append_event_log("peer_leave", {"visitor_id": visitor_id})
            self._broadcast("agent_status", {"action": "peer_leave", "visitor_id": visitor_id})
            return True

    def is_peer_visitor_agent_id(self, agent_id: str) -> bool:
        with self._lock:
            return any(x.visitor_id == agent_id for x in self._peer_visitors)

    def sync_agents_from_hermes(self) -> bool:
        """Replace world agents with one entry per Hermes profile.

        Source is Hermes profile list + each profile's SOUL/config display name.
        Preserves location/energy/mood by matching old id or name.
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
            default_room = next((r.name for r in self._world.rooms if r.name == "休息室"), "")
            if not default_room and self._world.rooms:
                default_room = self._world.rooms[0].name
            if not default_room:
                default_room = "休息室"
            PROFESSION_MAP = {
                "崽崽": "城主",
                "default": "城主",
                "pymaster": "后端开发",
                "uiwizard": "前端开发",
                "ui": "设计师",
                "libra": "测试员",
                "compass": "需求分析专家",
                "apex": "技术架构专家",
                "scriptorium": "技术文档专家",
                "keystone": "首席系统策略架构师",
            }
            DISPLAY_NAME_MAP: dict[str, str] = {
                "崽崽": "崽崽",
                "pymaster": "马斯特",
                "uiwizard": "陆向宇",
                "ui": "林见溪",
                "libra": "秦鉴微",
                "compass": "顾言卿",
                "apex": "沈枢衡",
                "scriptorium": "苏砚书",
                "keystone": "江定策",
            }
            DEFAULT_PROFESSION = "分析师"
            new_agents: list[Agent] = []
            for i, one in enumerate(rows):
                name = one["name"]
                desc = one.get("description") or ""
                aid = one["id"]
                old = old_by_id.get(aid) or old_by_name.get(name)
                profile_name = str(one.get("profile") or "")
                prof_raw = one.get("profession") or ""
                # Hermes/SOUL 推导的职业（首次落库用）
                prof_computed = PROFESSION_MAP.get(profile_name) or prof_raw.strip() or DEFAULT_PROFESSION
                # 存档里已有非空职业则保留（用户可在详情中改；避免每次 sync 覆盖数据库已写入结果）
                if old and str(getattr(old, "profession", "") or "").strip():
                    prof = str(old.profession).strip()
                else:
                    prof = prof_computed
                dis_name = DISPLAY_NAME_MAP.get(profile_name) or name
                # personality: prefer dedicated field, fall back to description
                pers_raw = one.get("personality")
                pers = pers_raw if pers_raw is not None and pers_raw != "" else (desc if len(desc) <= 500 else desc[:500] + "…")
                # catchphrase: prefer list join, fall back to snippet
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
                            status=old.status,
                            location=old.location,
                            energy=old.energy,
                            mood=old.mood,
                            affection=old.affection,
                            relation=old.relation,
                            focus=old.focus,
                            sleepiness=old.sleepiness,
                            satiety=old.satiety,
                            speed=old.speed,
                            catchphrase=snippet or old.catchphrase,
                            personality=pers or old.personality,
                            memes=memes or list(old.memes),
                            avatar=avatar_val or old.avatar,
                            reasoning_model=old.reasoning_model,
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
                            status="idle",
                            location=default_room,
                            energy=80,
                            mood=75,
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
                            a.status = "idle"
                    t.assignee_id = None
                    if t.status == "in_progress":
                        t.status = "pending"
            self.sync_room_occupancy()
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

    def sync_room_occupancy(self) -> None:
        """Keep `Room.agent_ids` aligned with `Agent.location` (match room `name` or `id`)."""
        with self._lock:
            for r in self._world.rooms:
                r.agent_ids = []
            for a in self._world.agents:
                room = next(
                    (r for r in self._world.rooms if r.name == a.location or r.id == a.location),
                    None,
                )
                if room is not None and a.id not in room.agent_ids:
                    room.agent_ids.append(a.id)
            for v in self._peer_visitors:
                room = next(
                    (r for r in self._world.rooms if r.name == v.location or r.id == v.location),
                    None,
                )
                if room is not None and v.visitor_id not in room.agent_ids:
                    room.agent_ids.append(v.visitor_id)

    def _append_event_log(self, kind: str, payload: dict[str, Any]) -> None:
        entry: dict[str, Any] = {"at": time.time(), "kind": kind, **payload}
        self._world.event_log.insert(0, entry)
        if len(self._world.event_log) > 80:
            self._world.event_log = self._world.event_log[:80]

    def add_agent(self, payload: dict[str, Any]) -> Agent:
        with self._lock:
            aid = str(payload.get("id") or chr(65 + len(self._world.agents)))
            profile_key = str(payload.get("profile") or "")
            DISPLAY_NAME_MAP: dict[str, str] = {
                "崽崽": "崽崽",
                "pymaster": "马斯特",
                "uiwizard": "陆向宇",
                "ui": "林见溪",
                "libra": "秦鉴微",
                "compass": "顾言卿",
                "apex": "沈枢衡",
                "scriptorium": "苏砚书",
                "keystone": "江定策",
            }
            # 职业能力默认值，按 profile 映射
            SKILLS_MAP: dict[str, list[dict[str, Any]]] = {
                "pymaster": [{"name": "代码", "level": 5}, {"name": "沟通", "level": 3}],
                "uiwizard": [{"name": "代码", "level": 4}, {"name": "沟通", "level": 3}],
                "ui": [{"name": "设计", "level": 5}, {"name": "沟通", "level": 4}],
                "libra": [{"name": "测试", "level": 5}, {"name": "分析", "level": 3}],
                "compass": [{"name": "分析", "level": 5}, {"name": "沟通", "level": 4}],
                "apex": [{"name": "架构", "level": 5}, {"name": "分析", "level": 4}],
                "scriptorium": [{"name": "写作", "level": 5}, {"name": "沟通", "level": 3}],
                "keystone": [{"name": "策略", "level": 5}, {"name": "沟通", "level": 4}],
                "崽崽": [{"name": "管理", "level": 5}, {"name": "沟通", "level": 5}],
            }
            skills = payload.get("skills") or SKILLS_MAP.get(profile_key, [{"name": "通用", "level": 3}])
            agent = Agent(
                id=aid,
                name=str(payload.get("name") or "新Agent"),
                display_name=DISPLAY_NAME_MAP.get(profile_key) or str(payload.get("name") or "新Agent"),
                profession=str(payload.get("profession") or "程序员"),
                profile=str(payload.get("profile") or "default"),
                gender=str(payload.get("gender") or "random"),
                location=str(payload.get("location") or "休息室"),
                catchphrase=str(payload.get("catchphrase") or ""),
                personality=str(payload.get("personality") or ""),
                skills=skills,
            )
            self._world.agents.append(agent)
            self.sync_room_occupancy()
            self._append_event_log("agent_add", {"agent_id": agent.id})
            self._broadcast("agent_status", {"action": "add", "agent": agent.to_dict()})
        try:
            self.ensure_hermes_session_for_agent(agent.id)
        except Exception:
            pass
        return agent

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
                    self.sync_room_occupancy()
                    self._append_event_log("agent_update", {"agent_id": a.id})
                    self._broadcast("agent_status", {"action": "update", "agent": a.to_dict()})
                    return a
        return None

    def move_agent(self, agent_id: str, room_id: str) -> bool:
        with self._lock:
            for a in self._world.agents:
                if a.id == agent_id:
                    a.location = room_id
                    self.sync_room_occupancy()
                    self._append_event_log("move", {"agent_id": agent_id, "room": room_id})
                    self._broadcast("agent_status", {"action": "move", "agent_id": agent_id, "room": room_id})
                    return True
            for v in self._peer_visitors:
                if v.visitor_id == agent_id:
                    v.location = room_id
                    self.sync_room_occupancy()
                    self._append_event_log("move", {"agent_id": agent_id, "room": room_id, "peer_visitor": True})
                    self._broadcast("agent_status", {"action": "move", "agent_id": agent_id, "room": room_id})
                    return True
        return False

    def create_task(self, payload: dict[str, Any]) -> Task:
        with self._lock:
            tid = max((t.id for t in self._world.tasks), default=0) + 1
            try:
                est = float(payload.get("estimated_hours", 2.0))
            except (TypeError, ValueError):
                est = 2.0
            task = Task(
                id=tid,
                name=str(payload.get("name") or "新任务"),
                description=str(payload.get("description") or ""),
                is_collaborative=bool(payload.get("is_collaborative") or False),
                estimated_hours=max(0.0, est),
                due_at=str(payload.get("due_at") or "").strip()[:32],
                deliverables=str(payload.get("deliverables") or ""),
                acceptance_criteria=str(payload.get("acceptance_criteria") or ""),
                catalog=str(payload.get("catalog") or "").strip()[:256],
            )
            self._world.tasks.append(task)
            self._broadcast("task", {"action": "create", "task": task.to_dict()})
            return task

    def update_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Partial update: 名称、描述、截止、产物、验收、预计工时、协作标记。"""
        with self._lock:
            tid = int(payload.get("task_id", 0))
            task = next((t for t in self._world.tasks if t.id == tid), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            if "name" in payload:
                n = str(payload.get("name") or "").strip()
                if n:
                    task.name = n
            if "description" in payload:
                task.description = str(payload.get("description") or "")
            if "due_at" in payload:
                task.due_at = str(payload.get("due_at") or "").strip()[:32]
            if "deliverables" in payload:
                task.deliverables = str(payload.get("deliverables") or "")
            if "acceptance_criteria" in payload:
                task.acceptance_criteria = str(payload.get("acceptance_criteria") or "")
            if "catalog" in payload:
                task.catalog = str(payload.get("catalog") or "").strip()[:256]
            if "estimated_hours" in payload:
                try:
                    task.estimated_hours = max(0.0, float(payload.get("estimated_hours")))
                except (TypeError, ValueError):
                    pass
            if "is_collaborative" in payload:
                task.is_collaborative = bool(payload.get("is_collaborative"))
            self._broadcast("task", {"action": "update", "task": task.to_dict()})
            return {"ok": True, "task": task.to_dict()}

    def delete_task(self, task_id: int) -> dict[str, Any]:
        """Remove task; clear assignees' current_task_id and idle working agents."""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            tid = task.id
            for a in self._world.agents:
                if a.current_task_id == tid:
                    a.current_task_id = None
                    if getattr(a, "status", None) == "working":
                        a.status = "idle"
            self._world.tasks = [t for t in self._world.tasks if t.id != tid]
            self._append_event_log("task_delete", {"task_id": tid})
            self._broadcast("task", {"action": "delete", "task_id": tid})
            return {"ok": True, "task_id": tid}

    def assign_task(self, task_id: int, agent_id: str | None) -> dict[str, Any]:
        """分配任务；多名空闲 Agent 未点名时随机竞争。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            candidates = [a for a in self._world.agents if getattr(a, "status", None) == "idle"]
            result: dict[str, Any] = {"ok": True, "task_id": task_id, "competition": False}

            if agent_id:
                target = next((a for a in self._world.agents if a.id == agent_id), None)
                if not target:
                    return {"ok": False, "error": "agent_not_found"}
                task.assignee_id = agent_id
                task.status = "in_progress"
                target.status = "working"
                target.current_task_id = task_id
                self._append_event_log("task_assign", {"task_id": task_id, "assignee_id": agent_id, "competition": False})
                self._broadcast("task", {"action": "assign", "task": task.to_dict()})
                return result

            if len(candidates) >= 2:
                # 竞争抽签：使用 competition.py
                competition_result = resolve_task_competition(
                    task=task,
                    world_agents=self._world.agents,
                    broadcast_fn=self._broadcast,
                )
                if competition_result:
                    result["competition"] = True
                    result["winner_id"] = competition_result.winner_id
                    # 已在 resolve_task_competition 内广播
                    # 同步写 event_logs（数据完整性 > 性能）
                    self._append_event_log(
                        "competition_result",
                        {
                            "task_id": task_id,
                            "winner_id": competition_result.winner_id,
                            "loser_ids": competition_result.loser_ids,
                            "winner_reward": competition_result.winner_reward,
                            "loser_moods": competition_result.loser_moods,
                            "loser_relations": competition_result.loser_relations,
                            "double_penalty": competition_result.double_penalty,
                        },
                    )
                    return result
                # 兜底：单人分配
                a = candidates[0]
                task.assignee_id = a.id
                task.status = "in_progress"
                a.status = "working"
                a.current_task_id = task_id
                self._append_event_log(
                    "task_assign", {"task_id": task_id, "assignee_id": a.id, "competition": False}
                )
                self._broadcast("task", {"action": "assign", "task": task.to_dict()})
                return result
            elif len(candidates) == 1:
                a = candidates[0]
                task.assignee_id = a.id
                task.status = "in_progress"
                a.status = "working"
                a.current_task_id = task_id
            else:
                task.assignee_id = None
                task.status = "pending"
                return {"ok": False, "error": "no_candidate"}

            self._append_event_log(
                "task_assign",
                {"task_id": task_id, "assignee_id": task.assignee_id, "competition": result.get("competition")},
            )
            self._broadcast("task", {"action": "assign", "task": task.to_dict()})
            return result

    def greeting(self, agent_id_a: str, agent_id_b: str) -> dict[str, Any]:
        with self._lock:
            aa = next((a for a in self._world.agents if a.id == agent_id_a), None)
            bb = next((a for a in self._world.agents if a.id == agent_id_b), None)
            if not aa or not bb:
                return {"ok": False, "error": "agent_not_found"}
            if aa.profession == bb.profession:
                return {"ok": False, "error": "same_profession"}
            if aa.location != bb.location:
                return {"ok": False, "error": "different_rooms"}
            if aa.location not in GREETING_ALLOWED_ROOMS:
                return {"ok": False, "error": "room_not_allowed"}
            pair = frozenset({agent_id_a, agent_id_b})
            now = time.time()
            last = self._greeting_cooldown.get(pair, 0.0)
            if now - last < GREETING_COOLDOWN_SEC:
                return {"ok": False, "error": "cooldown", "retry_after_sec": round(GREETING_COOLDOWN_SEC - (now - last), 1)}
            self._greeting_cooldown[pair] = now
            aff_gain = random.randint(1, 3)
            aa.affection = min(100, aa.affection + aff_gain)
            bb.affection = min(100, bb.affection + aff_gain)
            aa.relation = min(100, aa.relation + 1)
            bb.relation = min(100, bb.relation + 1)
            payload = {"agent_a": agent_id_a, "agent_b": agent_id_b, "relation": aa.relation, "affection_gain": aff_gain, "room": aa.location}
            self._append_event_log("greeting", payload)
            self._broadcast("social", {"type": "greeting", **payload})
            return {"ok": True, **payload}

    def complete_task(self, task_id: int, quality: int = 0) -> dict[str, Any]:
        """完成任务并结算奖励：经验+金币，状态联动。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            if task.status == "completed":
                return {"ok": False, "error": "already_completed"}
            task.status = "completed"
            task.progress = 100.0
            task.quality = max(0, min(100, quality))
            xp_gain = TASK_COMPLETE_XP
            gold_gain = TASK_COMPLETE_GOLD
            if task.is_collaborative:
                gold_gain = int(gold_gain * (1 + task.collaboration_bonus))
            if task.assignee_id:
                for a in self._world.agents:
                    if a.id == task.assignee_id:
                        a.status = "idle"
                        a.current_task_id = None
                        a.focus = max(0, a.focus - 10)
                        self._world.lord_xp += xp_gain
                        self._world.money += gold_gain
                        self._append_event_log(
                            "task_complete",
                            {
                                "task_id": task_id,
                                "assignee_id": task.assignee_id,
                                "xp": xp_gain,
                                "gold": gold_gain,
                                "quality": task.quality,
                            },
                        )
                        self._broadcast(
                            "task",
                            {"action": "complete", "task": task.to_dict(), "xp": xp_gain, "gold": gold_gain},
                        )
                        return {
                            "ok": True,
                            "task_id": task_id,
                            "xp": xp_gain,
                            "gold": gold_gain,
                            "quality": task.quality,
                        }
            self._append_event_log("task_complete", {"task_id": task_id, "xp": xp_gain, "gold": gold_gain})
            self._broadcast("task", {"action": "complete", "task": task.to_dict(), "xp": xp_gain, "gold": gold_gain})
            return {"ok": True, "task_id": task_id, "xp": xp_gain, "gold": gold_gain, "quality": task.quality}

    def collaboration(self, task_id: int) -> dict[str, Any]:
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            task.is_collaborative = True
            task.collaboration_bonus = 0.3
            self._broadcast("task", {"action": "collaboration", "task": task.to_dict()})
            return {"ok": True, "task": task.to_dict()}

    def apply_llm_tags(self, text: str) -> dict[str, Any]:
        events = extract_game_event_tags(text)
        with self._lock:
            applied = apply_parsed_events(self._world, events, emit=self._broadcast)
            self.sync_room_occupancy()
            self._append_event_log("llm_tags", {"count": len(applied)})
            return {"extracted": events, "applied": applied}

    def tick_time(self, minutes: int | None = None) -> dict[str, Any]:
        """Advance in-game clock (default GAME_TICK_MINUTES per call). Roll day after 24:00."""
        delta = int(minutes) if minutes is not None else GAME_TICK_MINUTES
        with self._lock:
            parts = self._world.time.split(":")
            h = int(parts[0]) if len(parts) > 1 else 8
            m = int(parts[1]) if len(parts) > 1 else 30
            m += max(1, delta)
            while m >= 60:
                m -= 60
                h += 1
            while h >= 24:
                h -= 24
                self._world.day += 1
            self._world.time = f"{h:02d}:{m:02d}"
            self._append_event_log("tick", {"time": self._world.time, "day": self._world.day})
            snap = {"day": self._world.day, "time": self._world.time}
            self._broadcast("task", {"action": "time", **snap})
            return snap

    def persist(self, slot: str = "default") -> None:
        with self._lock:
            save_world_to_db(self._conn, self._world, slot)

    def load_slot(self, slot: str = "default") -> bool:
        from .persistence import world_from_dict

        with self._lock:
            cur = self._conn.execute("SELECT payload FROM game_saves WHERE slot = ?", (slot,))
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
        return str((Path.home() / "ai_projects" / "HermesBungalow").resolve())

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

    def _monitor_resolve_agent_id(self, token: str) -> str | None:
        from api.game.agent import resolve_game_agent_token

        t = (token or "").strip()
        if not t:
            return None
        with self._lock:
            a = resolve_game_agent_token(t, self)
        return str(a.id) if a else None

    def monitor_start_work_order(self, user_prompt: str, primary_agent_id: str) -> str:
        with self._lock:
            rec = MonitorRecorder(self._conn)
            wid = rec.create_work_order(user_prompt, primary_agent_id)
            self._conn.commit()
            return wid

    def monitor_abort_work_order(self, work_order_id: str, reason: str) -> None:
        with self._lock:
            rec = MonitorRecorder(self._conn)
            rec.add_event(
                work_order_id,
                kind="aborted",
                agent_id=None,
                label="已中止",
                snippet=(reason or "")[:4000],
            )
            rec.finalize(work_order_id, "failed")
            self._conn.commit()

    def monitor_record_orchestrate(self, work_order_id: str, user_prompt: str, primary_agent_id: str, result: dict[str, Any]) -> None:
        with self._lock:
            record_orchestration_result(
                self._conn,
                work_order_id=work_order_id,
                user_prompt=user_prompt,
                primary_agent_id=primary_agent_id,
                result=result,
                resolve_agent_id_for_token=self._monitor_resolve_agent_id,
            )
            self._conn.commit()

    def monitor_record_relay(self, work_order_id: str, agent_id: str, user_message: str, result: dict[str, Any]) -> None:
        with self._lock:
            record_relay_result(
                self._conn,
                work_order_id=work_order_id,
                agent_id=agent_id,
                user_message=user_message,
                result=result,
            )
            self._conn.commit()

    def monitor_list_work_orders(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock:
            cur = self._conn.execute(
                """
                SELECT id, user_prompt, primary_agent_id, status, created_at, updated_at
                FROM monitor_work_orders ORDER BY created_at DESC LIMIT ?
                """,
                (limit,),
            )
            return [dict(r) for r in cur.fetchall()]

    def monitor_get_work_order_detail(self, wo_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT id, user_prompt, primary_agent_id, status, created_at, updated_at
                FROM monitor_work_orders WHERE id = ?
                """,
                (wo_id,),
            ).fetchone()
            if not row:
                return None
            base: dict[str, Any] = dict(row)
            tl = self._conn.execute(
                """
                SELECT id, seq, kind, agent_id, label, snippet, artifact_id, created_at
                FROM monitor_timeline_events WHERE work_order_id = ? ORDER BY seq ASC
                """,
                (wo_id,),
            ).fetchall()
            arts = self._conn.execute(
                """
                SELECT id, agent_id, kind, title, created_at
                FROM monitor_artifacts WHERE work_order_id = ? ORDER BY created_at ASC
                """,
                (wo_id,),
            ).fetchall()
            base["timeline"] = [dict(r) for r in tl]
            base["artifacts_index"] = [dict(r) for r in arts]
            return base

    def monitor_get_artifact_body(self, artifact_id: str) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                """
                SELECT id, work_order_id, agent_id, kind, title, content, created_at
                FROM monitor_artifacts WHERE id = ?
                """,
                (artifact_id,),
            ).fetchone()
            return dict(row) if row else None


def read_json_body(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
