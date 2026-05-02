from __future__ import annotations

import json
from typing import Any, Callable


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
    return applied
