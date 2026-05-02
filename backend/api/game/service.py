from __future__ import annotations

import json
import os
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable

GREETING_ALLOWED_ROOMS = frozenset({"休息室", "会议室", "资料室", "机房"})
GREETING_COOLDOWN_SEC = 600.0
GAME_TICK_MINUTES = 1

from .llm_events import apply_parsed_events, extract_game_event_tags
from .models import Agent, GameWorld, Task, default_world
from .persistence import get_save_meta, init_db, load_world_from_db, save_world_to_db, _connect

EmitFn = Callable[[str, dict[str, Any]], None]


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
        if not self.sync_agents_from_hermes():
            self.sync_room_occupancy()
        try:
            self.refresh_hermes_sessions_after_agent_list_change()
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
            return self._world.to_dict()

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
                # 优先级：PROFESSION_MAP[key] > 定位字段 > DEFAULT
                # 用 None 做映射表默认值，区分"未命中"和"命中空字符串"
                prof = PROFESSION_MAP.get(profile_name) or prof_raw.strip() or DEFAULT_PROFESSION
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
                if old:
                    new_agents.append(
                        Agent(
                            id=aid,
                            name=name,
                            display_name=dis_name,
                            profession=prof,
                            profile=str(one.get("profile") or "default"),
                            gender=old.gender,
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
        return False

    def create_task(self, payload: dict[str, Any]) -> Task:
        with self._lock:
            tid = max((t.id for t in self._world.tasks), default=0) + 1
            task = Task(
                id=tid,
                name=str(payload.get("name") or "新任务"),
                description=str(payload.get("description") or ""),
                required_profession=str(payload.get("required_profession") or "程序员"),
                difficulty=int(payload.get("difficulty") or 2),
                reward=int(payload.get("reward") or 100),
                is_collaborative=bool(payload.get("is_collaborative") or False),
            )
            self._world.tasks.append(task)
            self._broadcast("task", {"action": "create", "task": task.to_dict()})
            return task

    def assign_task(self, task_id: int, agent_id: str | None) -> dict[str, Any]:
        """分配任务；同职业多人时随机竞争。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            prof = task.required_profession
            candidates = [a for a in self._world.agents if a.profession == prof]
            result: dict[str, Any] = {"ok": True, "task_id": task_id, "competition": False}

            if agent_id:
                task.assignee_id = agent_id
                task.status = "in_progress"
                for a in self._world.agents:
                    if a.id == agent_id:
                        a.status = "working"
                        a.current_task_id = task_id
                self._append_event_log("task_assign", {"task_id": task_id, "assignee_id": agent_id, "competition": False})
                self._broadcast("task", {"action": "assign", "task": task.to_dict()})
                return result

            if len(candidates) >= 2:
                # 同一 profile（owner）的同职业 Agent 不能互相竞争，只留一个
                by_profile: dict[str, Agent] = {}
                for c in candidates:
                    by_profile.setdefault(c.profile, c)
                competition_pool = list(by_profile.values())
                if len(competition_pool) < 2:
                    # 只有一个有效竞争者，直接分配
                    a = competition_pool[0]
                    task.assignee_id = a.id
                    task.status = "in_progress"
                    a.status = "working"
                    a.current_task_id = task_id
                    self._append_event_log(
                        "task_assign", {"task_id": task_id, "assignee_id": a.id, "competition": False}
                    )
                    self._broadcast("task", {"action": "assign", "task": task.to_dict()})
                    return result
                winner = random.choice(competition_pool)
                loser = next((c for c in competition_pool if c.id != winner.id), None)
                mood_gain = random.randint(8, 15)
                mood_loss = random.randint(5, 10)
                winner.mood = min(100, winner.mood + mood_gain)
                if loser:
                    loser.mood = max(0, loser.mood - mood_loss)
                task.assignee_id = winner.id
                task.status = "in_progress"
                winner.status = "working"
                winner.current_task_id = task_id
                hist = {
                    "id": str(uuid.uuid4()),
                    "task_id": task_id,
                    "profession": prof,
                    "winner_id": winner.id,
                    "loser_id": loser.id if loser else None,
                    "mood_gain": mood_gain,
                    "mood_loss": mood_loss,
                }
                self._world.competition_history.insert(0, hist)
                result["competition"] = True
                result["winner_id"] = winner.id
                self._broadcast("competition", hist)
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
            xp_gain = task.reward // 2
            gold_gain = task.reward
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
        from api.models import new_session

        ws = self._default_hermes_workspace()
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

    def _warm_hermes_session_from_disk(self, sid: str, expected_profile: str) -> bool:
        """Load session JSON into process LRU if file exists and profile matches agent."""
        from api.models import Session, get_session

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
        if os.environ.get("HERMES_BUNGALOW_SKIP_HERMES_SESSION_INIT", "").strip().lower() in (
            "1",
            "true",
            "yes",
        ):
            with self._lock:
                self._hermes_session_by_agent.setdefault(agent_id, f"test-session-{agent_id}")
                return self._hermes_session_by_agent[agent_id]
        with self._lock:
            existing = self._hermes_session_by_agent.get(agent_id)
            if existing:
                return existing
            agent = next((x for x in self._world.agents if x.id == agent_id), None)
            if not agent:
                raise KeyError(agent_id)
            profile = str(getattr(agent, "profile", None) or "default")
            persisted = getattr(agent, "hermes_session_id", None) or None
        if persisted and self._warm_hermes_session_from_disk(persisted, profile):
            with self._lock:
                if agent_id in self._hermes_session_by_agent:
                    return self._hermes_session_by_agent[agent_id]
                ag = next((x for x in self._world.agents if x.id == agent_id), None)
                if not ag:
                    raise KeyError(agent_id)
                self._hermes_session_by_agent[agent_id] = persisted
                ag.hermes_session_id = persisted
                return persisted
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


def read_json_body(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        return json.loads(body.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
