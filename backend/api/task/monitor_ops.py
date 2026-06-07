"""Auto-extracted from service.py."""
from __future__ import annotations

import json
import time
from typing import Any

from .monitor_store import MonitorRecorder, record_orchestration_result, record_relay_result


class MonitorOpsMixin:
    """Mixin providing monitor_ops operations for TaskService."""

    def _monitor_resolve_agent_id(self, token: str) -> str | None:
        from api.task.orchestration import resolve_game_agent_token

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


