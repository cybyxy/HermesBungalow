from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any

from .models import Agent, TaskWorld, Task
from .monitor_store import MONITOR_DDL

TASK_DDL = """
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'pending',
    assignee_id TEXT DEFAULT NULL,
    required_profession TEXT NOT NULL DEFAULT '程序员',
    difficulty INTEGER NOT NULL DEFAULT 2,
    reward INTEGER NOT NULL DEFAULT 100,
    quality INTEGER NOT NULL DEFAULT 0,
    estimated_hours REAL NOT NULL DEFAULT 2.0,
    is_collaborative INTEGER NOT NULL DEFAULT 0,
    collaboration_bonus REAL NOT NULL DEFAULT 0.3,
    due_at TEXT NOT NULL DEFAULT '',
    deliverables TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    catalog TEXT NOT NULL DEFAULT '',
    workflow_steps TEXT NOT NULL DEFAULT '[]',
    depends_on TEXT NOT NULL DEFAULT '[]',
    parent_task_id INTEGER NOT NULL DEFAULT 0,
    created_at REAL NOT NULL DEFAULT 0.0,
    updated_at REAL NOT NULL DEFAULT 0.0
);
CREATE TABLE IF NOT EXISTS task_chain (
    id INTEGER PRIMARY KEY,
    parent_task_id INTEGER NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    progress REAL NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'pending',
    assignee_id TEXT DEFAULT NULL,
    required_profession TEXT NOT NULL DEFAULT '程序员',
    difficulty INTEGER NOT NULL DEFAULT 2,
    depends_on TEXT NOT NULL DEFAULT '[]',
    order_index INTEGER NOT NULL DEFAULT 0,
    deliverables TEXT NOT NULL DEFAULT '',
    created_at REAL NOT NULL DEFAULT 0.0,
    updated_at REAL NOT NULL DEFAULT 0.0,
    FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_task_chain_parent ON task_chain(parent_task_id);
"""


def _connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        CREATE TABLE IF NOT EXISTS task_saves (
            slot TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS task_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        """
    )
    conn.executescript(MONITOR_DDL)
    conn.executescript(TASK_DDL)
    conn.commit()


def _task_from_row(row: sqlite3.Row | dict[str, Any]) -> Task:
    """从 tasks / task_chain 表行构造 Task 对象。"""
    d = dict(row) if hasattr(row, "keys") else row
    return Task(
        id=int(d["id"]),
        name=str(d.get("name", "")),
        description=str(d.get("description", "")),
        progress=float(d.get("progress", 0.0)),
        status=str(d.get("status", "pending")),
        assignee_id=d.get("assignee_id") or None,
        required_profession=str(d.get("required_profession", "程序员")),
        difficulty=int(d.get("difficulty", 2)),
        reward=int(d.get("reward", 100)),
        quality=int(d.get("quality", 0)),
        estimated_hours=float(d.get("estimated_hours", 2.0)),
        is_collaborative=bool(int(d.get("is_collaborative", 0))),
        collaboration_bonus=float(d.get("collaboration_bonus", 0.3)),
        due_at=str(d.get("due_at", "")),
        deliverables=str(d.get("deliverables", "")),
        acceptance_criteria=str(d.get("acceptance_criteria", "")),
        catalog=str(d.get("catalog", "")),
        workflow_steps=json.loads(str(d.get("workflow_steps", "[]"))),
        depends_on=json.loads(str(d.get("depends_on", "[]"))),
        parent_task_id=int(d.get("parent_task_id", 0)),
    )


def _task_to_row(task: Task, ts: float) -> dict[str, Any]:
    """将 Task 转为表行 dict。"""
    return {
        "id": task.id,
        "name": task.name,
        "description": task.description,
        "progress": task.progress,
        "status": task.status,
        "assignee_id": task.assignee_id,
        "required_profession": task.required_profession,
        "difficulty": task.difficulty,
        "reward": task.reward,
        "quality": task.quality,
        "estimated_hours": task.estimated_hours,
        "is_collaborative": 1 if task.is_collaborative else 0,
        "collaboration_bonus": task.collaboration_bonus,
        "due_at": task.due_at,
        "deliverables": task.deliverables,
        "acceptance_criteria": task.acceptance_criteria,
        "catalog": task.catalog,
        "workflow_steps": json.dumps(task.workflow_steps, ensure_ascii=False),
        "depends_on": json.dumps(task.depends_on, ensure_ascii=False),
        "parent_task_id": task.parent_task_id,
        "created_at": ts,
        "updated_at": ts,
    }


def world_from_dict(d: dict[str, Any]) -> TaskWorld:
    agents = [Agent(**{k: v for k, v in a.items() if k in Agent.__dataclass_fields__}) for a in d.get("agents", [])]
    tasks = []
    for t in d.get("tasks", []):
        kw = {k: v for k, v in t.items() if k in Task.__dataclass_fields__}
        tasks.append(Task(**kw))
    return TaskWorld(
        agents=agents,
        tasks=tasks,
        event_log=list(d.get("event_log", [])),
    )


def load_tasks_from_db(conn: sqlite3.Connection) -> list[Task]:
    """从 tasks + task_chain 表加载所有任务。"""
    tasks: list[Task] = []
    rows = conn.execute("SELECT * FROM tasks ORDER BY id").fetchall()
    for row in rows:
        tasks.append(_task_from_row(row))
    # task_chain 中的子任务作为 parent_task_id > 0 的 Task
    chain_rows = conn.execute("SELECT * FROM task_chain ORDER BY parent_task_id, order_index").fetchall()
    for row in chain_rows:
        d = dict(row)
        # task_chain 表字段映射到 Task
        t = Task(
            id=int(d["id"]),
            name=str(d.get("name", "")),
            description=str(d.get("description", "")),
            progress=float(d.get("progress", 0.0)),
            status=str(d.get("status", "pending")),
            assignee_id=d.get("assignee_id") or None,
            required_profession=str(d.get("required_profession", "程序员")),
            difficulty=int(d.get("difficulty", 2)),
            depends_on=json.loads(str(d.get("depends_on", "[]"))),
            parent_task_id=int(d.get("parent_task_id", 0)),
            deliverables=str(d.get("deliverables", "")),
        )
        tasks.append(t)
    return tasks


def save_tasks_to_db(conn: sqlite3.Connection, tasks: list[Task]) -> None:
    """将任务写入 tasks + task_chain 表。父任务（parent_task_id=0）→ tasks，子任务 → task_chain。"""
    ts = time.time()
    for task in tasks:
        row = _task_to_row(task, ts)
        if task.parent_task_id == 0:
            conn.execute(
                """INSERT INTO tasks (
                    id, name, description, progress, status, assignee_id, required_profession,
                    difficulty, reward, quality, estimated_hours, is_collaborative,
                    collaboration_bonus, due_at, deliverables, acceptance_criteria, catalog,
                    workflow_steps, depends_on, parent_task_id, created_at, updated_at
                ) VALUES (
                    :id, :name, :description, :progress, :status, :assignee_id, :required_profession,
                    :difficulty, :reward, :quality, :estimated_hours, :is_collaborative,
                    :collaboration_bonus, :due_at, :deliverables, :acceptance_criteria, :catalog,
                    :workflow_steps, :depends_on, :parent_task_id, :created_at, :updated_at
                ) ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, description=excluded.description, progress=excluded.progress,
                    status=excluded.status, assignee_id=excluded.assignee_id,
                    deliverables=excluded.deliverables, depends_on=excluded.depends_on,
                    workflow_steps=excluded.workflow_steps, updated_at=excluded.updated_at""",
                row,
            )
        else:
            conn.execute(
                """INSERT INTO task_chain (
                    id, parent_task_id, name, description, progress, status, assignee_id,
                    required_profession, difficulty, depends_on, order_index, deliverables,
                    created_at, updated_at
                ) VALUES (
                    :id, :parent_task_id, :name, :description, :progress, :status, :assignee_id,
                    :required_profession, :difficulty, :depends_on,
                    COALESCE((SELECT MAX(order_index)+1 FROM task_chain WHERE parent_task_id=:parent_task_id), 0),
                    :deliverables, :created_at, :updated_at
                ) ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name, description=excluded.description, progress=excluded.progress,
                    status=excluded.status, assignee_id=excluded.assignee_id,
                    deliverables=excluded.deliverables, depends_on=excluded.depends_on,
                    updated_at=excluded.updated_at""",
                row,
            )
    conn.commit()


def delete_task_from_db(conn: sqlite3.Connection, task_id: int) -> None:
    """从表中删除任务（CASCADE 自动清理 task_chain）。"""
    conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    conn.execute("DELETE FROM task_chain WHERE id = ? OR parent_task_id = ?", (task_id, task_id))
    conn.commit()


def load_world_from_db(conn: sqlite3.Connection) -> TaskWorld | None:
    # 先从表加载任务
    tasks = load_tasks_from_db(conn)
    # 再从 JSON 加载 agents + event_log
    cur = conn.execute("SELECT payload FROM task_saves WHERE slot = ?", ("default",))
    row = cur.fetchone()
    if row:
        d = json.loads(row["payload"])
        agents = [Agent(**{k: v for k, v in a.items() if k in Agent.__dataclass_fields__}) for a in d.get("agents", [])]
        event_log = list(d.get("event_log", []))
        # 迁移：表中无任务但 JSON 中有 → 写入新表
        if not tasks and d.get("tasks"):
            for t in d.get("tasks", []):
                kw = {k: v for k, v in t.items() if k in Task.__dataclass_fields__}
                tasks.append(Task(**kw))
            save_tasks_to_db(conn, tasks)
    else:
        agents = []
        event_log = []
    return TaskWorld(agents=agents, tasks=tasks, event_log=event_log)


def save_world_to_db(conn: sqlite3.Connection, world: TaskWorld, slot: str = "default") -> None:
    # 任务写入独立表
    save_tasks_to_db(conn, world.tasks)
    # agents + event_log 仍走 JSON
    payload = json.dumps({
        "agents": [a.to_dict() for a in world.agents],
        "event_log": list(world.event_log),
    }, ensure_ascii=False)
    conn.execute(
        """
        INSERT INTO task_saves (slot, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(slot) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
        """,
        (slot, payload, time.time()),
    )
    conn.commit()


def get_save_meta(conn: sqlite3.Connection, slot: str = "default") -> dict[str, Any] | None:
    cur = conn.execute("SELECT slot, updated_at FROM task_saves WHERE slot = ?", (slot,))
    row = cur.fetchone()
    if not row:
        return None
    return {"slot": row["slot"], "updated_at": row["updated_at"]}
