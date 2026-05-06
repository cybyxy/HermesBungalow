from __future__ import annotations

import json
from typing import Any, Callable

_WORKFLOW_STEP_KINDS = frozenset({"analyze", "design", "implement", "test", "review", "deliver", "other"})


def normalize_workflow_steps(raw_steps: Any, *, max_steps: int = 40) -> list[dict[str, Any]]:
    """Normalize LLM ``steps`` array for ``Task.workflow_steps`` (persisted in save JSON)."""
    if not isinstance(raw_steps, list):
        return []
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(raw_steps[:max_steps]):
        if not isinstance(raw, dict):
            continue
        sid = str(raw.get("id") or "").strip() or f"step-{i + 1}"
        title = str(raw.get("title") or "").strip() or f"步骤 {i + 1}"
        kind = str(raw.get("kind") or "other").strip().lower()
        if kind not in _WORKFLOW_STEP_KINDS:
            kind = "other"
        try:
            oi = int(raw.get("order", i + 1))
        except (TypeError, ValueError):
            oi = i + 1
        row: dict[str, Any] = {"id": sid, "order": oi, "title": title, "kind": kind}
        det = str(raw.get("detail") or "").strip()
        if det:
            row["detail"] = det
        em = raw.get("estimated_minutes")
        if em is not None:
            try:
                emf = float(em)
                if emf >= 0:
                    row["estimated_minutes"] = emf
            except (TypeError, ValueError):
                pass
        dep = raw.get("depends_on")
        if isinstance(dep, list) and dep:
            deps = [str(x).strip() for x in dep if str(x).strip()]
            if deps:
                row["depends_on"] = deps
        out.append(row)
    out.sort(key=lambda r: int(r.get("order", 0)))
    return out


def extract_game_event_tags(text: str) -> list[dict[str, Any]]:
    """Parse `[[GAME_EVENT:{...json...}]]` segments (may span lines)."""
    out: list[dict[str, Any]] = []
    key = "[[GAME_EVENT:"
    i = 0
    while True:
        start = text.find(key, i)
        if start < 0:
            break
        end = text.find("]]", start)
        if end < 0:
            break
        blob = text[start + len(key) : end].strip()
        try:
            out.append(json.loads(blob))
        except json.JSONDecodeError:
            pass
        i = end + 2
    return out


def apply_parsed_events(
    world: Any,
    events: list[dict[str, Any]],
    emit: Callable[[str, dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Mutate world (GameWorld) in place. Returns applied event log."""
    applied: list[dict[str, Any]] = []
    for ev in events:
        t = ev.get("type")
        if t == "task_progress":
            tid = int(ev.get("task_id", 0))
            prog = float(ev.get("progress", 0))
            for task in world.tasks:
                if task.id == tid:
                    task.progress = max(0, min(100, prog))
                    if emit:
                        emit("task", {"task_id": tid, "progress": task.progress, "status": task.status})
                    applied.append(ev)
                    break
        elif t == "agent_mood":
            aid = str(ev.get("agent_id", ""))
            mood = int(ev.get("mood", 70))
            for a in world.agents:
                if a.id == aid:
                    a.mood = max(0, min(100, mood))
                    if emit:
                        emit("agent_status", {"agent_id": aid, "mood": a.mood})
                    applied.append(ev)
                    break
        elif t == "agent_move":
            aid = str(ev.get("agent_id", ""))
            room = str(ev.get("room", ""))
            for a in world.agents:
                if a.id == aid:
                    a.location = room
                    if emit:
                        emit("agent_status", {"agent_id": aid, "location": room})
                    applied.append(ev)
                    break
        elif t == "money_delta":
            delta = int(ev.get("delta", 0))
            world.money = max(0, world.money + delta)
            if emit:
                emit("task", {"money": world.money})
            applied.append(ev)
        elif t == "log":
            msg = str(ev.get("message", ""))
            if emit:
                emit("social", {"message": msg})
            applied.append(ev)
        elif t == "task_workflow_plan":
            tid = int(ev.get("task_id", 0))
            steps = normalize_workflow_steps(ev.get("steps"))
            if not tid or not steps:
                continue
            for task in world.tasks:
                if task.id == tid:
                    task.workflow_steps = steps
                    if emit:
                        emit("task", {"action": "update", "task": task.to_dict()})
                    applied.append(ev)
                    break
    return applied
