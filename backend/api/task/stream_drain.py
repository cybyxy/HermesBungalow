"""SSE stream draining utilities — consumed by ``session_turn.py``."""
from __future__ import annotations

import json
import queue
import threading
from collections.abc import Callable
from typing import Any


def _extract_assistant_from_done_payload(data: Any) -> str:
    if not isinstance(data, dict):
        return ""
    sess = data.get("session")
    if not isinstance(sess, dict):
        return ""
    msgs = sess.get("messages") or []
    if not isinstance(msgs, list):
        return ""
    for m in reversed(msgs):
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        if m.get("_error"):
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            return c.strip()
        if isinstance(c, list):
            for part in c:
                if not isinstance(part, dict):
                    continue
                if part.get("type") in ("text", "output_text"):
                    t = str(part.get("text", "")).strip()
                    if t:
                        return t
    return ""


def _fallback_assistant_from_session_disk(session_id: str) -> str:
    from api.models import Session as SessionModel

    reloaded = SessionModel.load(session_id)
    if not reloaded:
        return ""
    for m in reversed(reloaded.messages or []):
        if not isinstance(m, dict) or m.get("role") != "assistant":
            continue
        if m.get("_error"):
            continue
        c = m.get("content")
        if isinstance(c, str) and c.strip():
            return c.strip()
    return ""


def _drain_agent_stream(
    stream_id: str,
    session_id: str,
    stream_thread: threading.Thread,
    stream_queue: "queue.Queue[tuple[str, Any]]",
    *,
    session_ref: Any | None = None,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
    step_id: str = "",
    agent_id: str | None = None,
) -> tuple[str, str | None, list[dict[str, Any]]]:
    """Drain streaming queue; collect ``trace`` rows for UI (reasoning / tool / tool_complete)."""
    final = ""
    err: str | None = None
    trace: list[dict[str, Any]] = []
    reasoning_buf: list[str] = []
    text_buf: list[str] = []

    def _flush_reasoning() -> None:
        if not reasoning_buf:
            return
        chunk = "".join(reasoning_buf).strip()
        reasoning_buf.clear()
        if chunk:
            trace.append({"type": "reasoning", "text": chunk})

    def _args_summary(args_obj: Any) -> str:
        if not isinstance(args_obj, dict) or not args_obj:
            return ""
        try:
            s = json.dumps(args_obj, ensure_ascii=False)
        except (TypeError, ValueError):
            s = str(args_obj)
        return s[:800]

    try:
        while True:
            try:
                item = stream_queue.get(timeout=600)
            except queue.Empty:
                err = "relay_timeout"
                break
            ev, data = item
            if ev == "token" and isinstance(data, dict):
                t = data.get("text")
                if t is not None and str(t):
                    piece = str(t)
                    text_buf.append(piece)
                    if event_sink:
                        event_sink(
                            {
                                "type": "text_delta",
                                "run_id": run_id,
                                "step_id": step_id,
                                "agent_id": agent_id,
                                "text": piece,
                            }
                        )
                continue
            if ev == "reasoning" and isinstance(data, dict):
                t = data.get("text")
                if t is not None and str(t):
                    piece = str(t)
                    reasoning_buf.append(piece)
                    if event_sink and step_id:
                        event_sink(
                            {
                                "type": "reasoning_delta",
                                "run_id": run_id,
                                "step_id": step_id,
                                "agent_id": agent_id,
                                "text": piece,
                            }
                        )
                continue
            if ev == "tool" and isinstance(data, dict):
                _flush_reasoning()
                trace.append(
                    {
                        "type": "tool",
                        "name": str(data.get("name") or ""),
                        "preview": str(data.get("preview") or "")[:4000],
                        "event_type": str(data.get("event_type") or ""),
                        "args": data.get("args") if isinstance(data.get("args"), dict) else {},
                    }
                )
                if event_sink and step_id:
                    event_sink(
                        {
                            "type": "tool_start",
                            "run_id": run_id,
                            "step_id": step_id,
                            "agent_id": agent_id,
                            "name": str(data.get("name") or "工具"),
                            "args_summary": _args_summary(data.get("args")),
                        }
                    )
                continue
            if ev == "tool_complete" and isinstance(data, dict):
                _flush_reasoning()
                trace.append(
                    {
                        "type": "tool_complete",
                        "name": str(data.get("name") or ""),
                        "preview": str(data.get("preview") or "")[:4000],
                        "event_type": str(data.get("event_type") or ""),
                        "duration": data.get("duration"),
                        "is_error": bool(data.get("is_error")),
                    }
                )
                if event_sink and step_id:
                    ok = not bool(data.get("is_error"))
                    prev = str(data.get("preview") or "").strip()
                    dur = data.get("duration")
                    bits = [x for x in (prev, f"耗时: {dur}" if dur is not None else "") if x]
                    event_sink(
                        {
                            "type": "tool_end",
                            "run_id": run_id,
                            "step_id": step_id,
                            "agent_id": agent_id,
                            "name": str(data.get("name") or "工具"),
                            "ok": ok,
                            "result_summary": "\n".join(bits) if bits else ("完成" if ok else "失败"),
                            "error": None if ok else (prev or "失败"),
                        }
                    )
                continue
            if ev == "done":
                _flush_reasoning()
                final = _extract_assistant_from_done_payload(data)
                break
            if ev == "apperror":
                _flush_reasoning()
                if isinstance(data, dict):
                    err = str(data.get("message") or data.get("type") or "apperror")
                else:
                    err = "apperror"
                break
            if ev == "error":
                _flush_reasoning()
                err = str(data)
                break
            if ev == "cancel":
                _flush_reasoning()
                err = "cancelled"
                break
    finally:
        stream_thread.join(timeout=180)
    sid_for_disk = session_id
    if session_ref is not None and getattr(session_ref, "session_id", None):
        sid_for_disk = str(session_ref.session_id)
    _flush_reasoning()
    if not final and not err:
        final = _fallback_assistant_from_session_disk(sid_for_disk)
    if not final and not err:
        err = "empty_reply"
    return final, err, trace
