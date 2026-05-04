from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .models import Agent, GameWorld, Room, Task, default_world
from .monitor_store import MONITOR_DDL


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS game_saves (
            slot TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS game_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    conn.executescript(MONITOR_DDL)
    conn.commit()


def world_from_dict(d: dict[str, Any]) -> GameWorld:
    agents = [Agent(**{k: v for k, v in a.items() if k in Agent.__dataclass_fields__}) for a in d.get("agents", [])]
    tasks = []
    for t in d.get("tasks", []):
        kw = {k: v for k, v in t.items() if k in Task.__dataclass_fields__}
        tasks.append(Task(**kw))
    rooms = [Room(**{k: v for k, v in r.items() if k in Room.__dataclass_fields__}) for r in d.get("rooms", [])]
    return GameWorld(
        day=d.get("day", 1),
        time=d.get("time", "08:30"),
        money=d.get("money", 0),
        lord_level=d.get("lord_level", 1),
        lord_xp=d.get("lord_xp", 0),
        agents=agents,
        tasks=tasks,
        rooms=rooms,
        competition_history=list(d.get("competition_history", [])),
        event_log=list(d.get("event_log", [])),
    )


def load_world_from_db(conn: sqlite3.Connection) -> GameWorld | None:
    cur = conn.execute("SELECT payload FROM game_saves WHERE slot = ?", ("default",))
    row = cur.fetchone()
    if not row:
        return None
    return world_from_dict(json.loads(row["payload"]))


def save_world_to_db(conn: sqlite3.Connection, world: GameWorld, slot: str = "default") -> None:
    payload = json.dumps(world.to_dict(), ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO game_saves (slot, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(slot) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        """,
        (slot, payload, time.time()),
    )
    conn.commit()


def get_save_meta(conn: sqlite3.Connection, slot: str = "default") -> dict[str, Any] | None:
    cur = conn.execute("SELECT slot, updated_at FROM game_saves WHERE slot = ?", (slot,))
    row = cur.fetchone()
    if not row:
        return None
    return {"slot": row["slot"], "updated_at": row["updated_at"]}
