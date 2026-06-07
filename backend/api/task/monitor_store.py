"""SQL persistence for user-facing Agent work-order monitoring (orchestrate / relay)."""

from __future__ import annotations

import time
import uuid
from typing import Any

from .events import extract_game_event_tags

MONITOR_DDL = """
CREATE TABLE IF NOT EXISTS monitor_work_orders (
    id TEXT PRIMARY KEY,
    user_prompt TEXT NOT NULL,
    primary_agent_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS monitor_timeline_events (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    kind TEXT NOT NULL,
    agent_id TEXT,
    label TEXT NOT NULL,
    snippet TEXT,
    artifact_id TEXT,
    created_at REAL NOT NULL,
    UNIQUE(work_order_id, seq)
);
CREATE TABLE IF NOT EXISTS monitor_artifacts (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL,
    agent_id TEXT,
    kind TEXT NOT NULL DEFAULT 'chat_reply',
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mon_tl_wo_seq ON monitor_timeline_events(work_order_id, seq);
CREATE INDEX IF NOT EXISTS idx_mon_art_wo ON monitor_artifacts(work_order_id);
"""


def _snip(text: str, max_len: int = 220) -> str:
    t = (text or "").strip().replace("\r\n", "\n")
    if len(t) <= max_len:
        return t
    return t[: max_len - 1] + "…"


class MonitorRecorder:
    def __init__(self, conn: Any) -> None:
        self._conn = conn

    def create_work_order(self, user_prompt: str, primary_agent_id: str) -> str:
        wid = uuid.uuid4().hex
        now = time.time()
        up = (user_prompt or "")[:8000]
        self._conn.execute(
            """
            INSERT INTO monitor_work_orders (id, user_prompt, primary_agent_id, status, created_at, updated_at)
            VALUES (?, ?, ?, 'running', ?, ?)
            """,
            (wid, up, primary_agent_id, now, now),
        )
        return wid

    def _next_seq(self, work_order_id: str) -> int:
        row = self._conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM monitor_timeline_events WHERE work_order_id = ?",
            (work_order_id,),
        ).fetchone()
        return int(row["n"]) if row else 1

    def add_event(
        self,
        work_order_id: str,
        *,
        kind: str,
        agent_id: str | None,
        label: str,
        snippet: str | None = None,
        artifact_id: str | None = None,
    ) -> str:
        eid = uuid.uuid4().hex
        now = time.time()
        seq = self._next_seq(work_order_id)
        sn = (snippet or "")[:4000]
        self._conn.execute(
            """
            INSERT INTO monitor_timeline_events
            (id, work_order_id, seq, kind, agent_id, label, snippet, artifact_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (eid, work_order_id, seq, kind, agent_id, label[:500], sn, artifact_id, now),
        )
        return eid

    def add_artifact(
        self,
        work_order_id: str,
        *,
        agent_id: str | None,
        kind: str,
        title: str,
        content: str,
    ) -> str:
        aid = uuid.uuid4().hex
        now = time.time()
        self._conn.execute(
            """
            INSERT INTO monitor_artifacts (id, work_order_id, agent_id, kind, title, content, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (aid, work_order_id, agent_id, kind, title[:500], content[:500000], now),
        )
        return aid

    def add_artifact_with_timeline(
        self,
        work_order_id: str,
        *,
        timeline_kind: str,
        agent_id: str | None,
        label: str,
        body: str,
        artifact_kind: str,
    ) -> str:
        aid = self.add_artifact(
            work_order_id,
            agent_id=agent_id,
            kind=artifact_kind,
            title=label[:200],
            content=body,
        )
        self.add_event(
            work_order_id,
            kind=timeline_kind,
            agent_id=agent_id,
            label=label,
            snippet=_snip(body),
            artifact_id=aid,
        )
        return aid

    def finalize(self, work_order_id: str, status: str) -> None:
        now = time.time()
        self._conn.execute(
            "UPDATE monitor_work_orders SET status = ?, updated_at = ? WHERE id = ?",
            (status[:32], now, work_order_id),
        )


def _record_event_tag(rec: MonitorRecorder, work_order_id: str, ev: dict[str, Any], fallback_agent_id: str | None) -> None:
    """将单个 GAME_EVENT tag 转为时间线事件。"""
    t = ev.get("type")
    if t == "task_chain_create":
        name = str(ev.get("name", "项目")).strip()
        sub_tasks = ev.get("sub_tasks")
        sub_count = len(sub_tasks) if isinstance(sub_tasks, list) else 0
        rec.add_event(
            work_order_id,
            kind="task_chain_create",
            agent_id=fallback_agent_id,
            label=f"创建项目: {name}",
            snippet=f"共 {sub_count} 个子任务",
        )
    elif t == "artifact_create":
        kind = str(ev.get("kind", "")).strip()
        title = str(ev.get("title", "")).strip()
        rec.add_event(
            work_order_id,
            kind="artifact_create",
            agent_id=fallback_agent_id,
            label=f"产出物: {title}" if title else "产出物",
            snippet=f"类型: {kind}" if kind else None,
        )
    elif t == "task_progress":
        tid = ev.get("task_id")
        prog = ev.get("progress")
        rec.add_event(
            work_order_id,
            kind="task_workflow",
            agent_id=fallback_agent_id,
            label=f"任务 #{tid} 进度更新",
            snippet=f"进度 {prog}%",
        )
    elif t == "task_workflow_plan":
        tid = ev.get("task_id")
        steps = ev.get("steps")
        step_count = len(steps) if isinstance(steps, list) else 0
        rec.add_event(
            work_order_id,
            kind="task_workflow",
            agent_id=fallback_agent_id,
            label=f"任务 #{tid} 流程规划",
            snippet=f"共 {step_count} 个步骤",
        )
    elif t == "log":
        msg = str(ev.get("message", ""))
        rec.add_event(
            work_order_id,
            kind="agent_log",
            agent_id=fallback_agent_id,
            label="Agent 日志",
            snippet=_snip(msg),
        )


def record_orchestration_result(
    conn: Any,
    *,
    work_order_id: str,
    user_prompt: str,
    primary_agent_id: str,
    result: dict[str, Any],
    resolve_agent_id_for_token: Any,
) -> None:
    """Append timeline + artifacts from orchestrate JSON (primary + delegations tree)."""
    rec = MonitorRecorder(conn)
    rec.add_event(
        work_order_id,
        kind="intake",
        agent_id=primary_agent_id,
        label="你的指令",
        snippet=_snip(user_prompt),
    )

    prim = result.get("primary")
    if isinstance(prim, dict):
        uh = prim.get("user_handoff")
        reply = str(prim.get("reply") or "")
        err = prim.get("error")
        if reply.strip():
            rec.add_artifact_with_timeline(
                work_order_id,
                timeline_kind="primary_reply",
                agent_id=primary_agent_id,
                label="主 Agent 回复",
                body=reply,
                artifact_kind="primary_reply",
            )
            # 扫描主 Agent 回复中的 task_chain_create / artifact_create 等事件
            for ev in extract_game_event_tags(reply):
                _record_event_tag(rec, work_order_id, ev, primary_agent_id)
        elif uh:
            rec.add_event(
                work_order_id,
                kind="user_handoff",
                agent_id=primary_agent_id,
                label=f"用户级派发（{uh}）",
                snippet=_snip(user_prompt),
            )
        if not prim.get("ok") and err:
            rec.add_event(
                work_order_id,
                kind="error",
                agent_id=primary_agent_id,
                label="主 Agent 错误",
                snippet=str(err)[:2000],
            )

    def walk(delegations: list[Any], depth: int) -> None:
        for d in delegations or []:
            if not isinstance(d, dict):
                continue
            tgt = str(d.get("target") or "")
            prof = str(d.get("profile") or "")
            reply = str(d.get("reply") or "")
            ok = bool(d.get("ok"))
            err = d.get("error")
            aid = resolve_agent_id_for_token(tgt) or resolve_agent_id_for_token(prof)
            label = f"同伴回复 · @{tgt}" + (f" (depth {depth})" if depth else "")
            if ok and reply.strip():
                rec.add_artifact_with_timeline(
                    work_order_id,
                    timeline_kind="delegation_reply",
                    agent_id=aid,
                    label=label,
                    body=reply,
                    artifact_kind="delegation_reply",
                )
                for ev in extract_game_event_tags(reply):
                    _record_event_tag(rec, work_order_id, ev, aid)
            elif not ok:
                rec.add_event(
                    work_order_id,
                    kind="delegation_error",
                    agent_id=aid,
                    label=f"同伴失败 · @{tgt}",
                    snippet=str(err or "error")[:2000],
                )
            nested = d.get("nested")
            if isinstance(nested, list) and nested:
                walk(nested, depth + 1)

    walk(result.get("delegations") or [], 0)

    status = "completed"
    if not result.get("ok"):
        status = "failed"
    else:
        deleg = result.get("delegations") or []

        def any_fail(ds: list[Any]) -> bool:
            for x in ds or []:
                if not isinstance(x, dict):
                    continue
                if not x.get("ok"):
                    return True
                if any_fail(x.get("nested") or []):
                    return True
            return False

        if any_fail(deleg):
            status = "partial"
    rec.finalize(work_order_id, status)


def record_relay_result(
    conn: Any,
    *,
    work_order_id: str,
    agent_id: str,
    user_message: str,
    result: dict[str, Any],
) -> None:
    rec = MonitorRecorder(conn)
    rec.add_event(
        work_order_id,
        kind="intake",
        agent_id=agent_id,
        label="Relay 输入",
        snippet=_snip(user_message),
    )
    reply = str(result.get("reply") or "")
    if result.get("ok") and reply.strip():
        rec.add_artifact_with_timeline(
            work_order_id,
            timeline_kind="relay_reply",
            agent_id=agent_id,
            label="Relay 回复",
            body=reply,
            artifact_kind="relay_reply",
        )
    elif not result.get("ok"):
        rec.add_event(
            work_order_id,
            kind="error",
            agent_id=agent_id,
            label="Relay 错误",
            snippet=str(result.get("error") or "")[:2000],
        )
    rec.finalize(work_order_id, "completed" if result.get("ok") else "failed")
