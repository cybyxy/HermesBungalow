"""Single Hermes session turn — runs one LLM inference round on an existing session."""
from __future__ import annotations

import queue
import threading
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Any

from api.task.stream_drain import _drain_agent_stream

try:
    from api.streaming import STREAMS, STREAMS_LOCK, _run_agent_streaming
except ImportError:
    STREAMS = {}
    STREAMS_LOCK = threading.RLock()


def sync_session_turn(
    session_id: str,
    message: str,
    task_service: Any,
    *,
    bungalow_agent_id: str | None = None,
    attachments: list[str] | None = None,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
) -> dict[str, Any]:
    """Run one Hermes turn on an existing session (keeps conversation history)."""
    from api.config import _get_session_agent_lock, get_config
    from api.task.service import bungalow_session_tls_for_agent_id
    from api.models import get_session

    with bungalow_session_tls_for_agent_id(task_service, bungalow_agent_id):
        s = get_session(session_id)
        profile = str(getattr(s, "profile", None) or "default")
        default_ws = str((Path.home() / "ai_projects" / "HermesBungalow" / "agent_workspace").resolve())
        workspace = str(Path(s.workspace or default_ws).expanduser().resolve())
        model = s.model
        if not model:
            try:
                cfg = get_config()
                model = str(cfg.get("model") or "").strip()
            except Exception:
                model = ""
            if not model:
                model = "mini-max-4-official"

        # Agent 指定了模型时优先使用（格式 provider_id/model_id → provider_id:model_id）
        if bungalow_agent_id and task_service:
            try:
                with task_service._lock:
                    agents = list(task_service.world.agents)
                for a in agents:
                    if a.id == bungalow_agent_id:
                        rm = (getattr(a, "reasoning_model", None) or "").strip()
                        if rm and rm != "auto":
                            model = rm.replace("/", ":", 1)
                        break
            except Exception:
                pass

        current_stream_id = getattr(s, "active_stream_id", None)
        if current_stream_id:
            with STREAMS_LOCK:
                stale = current_stream_id not in STREAMS
            if stale:
                with _get_session_agent_lock(s.session_id):
                    s.active_stream_id = None
                    s.save()
            else:
                return {
                    "ok": False,
                    "reply": "",
                    "error": "session_already_streaming",
                    "profile": profile,
                    "internal_session_id": s.session_id,
                }
        stream_id = uuid.uuid4().hex
        step_id = uuid.uuid4().hex
        q: queue.Queue[tuple[str, Any]] = queue.Queue()
        with STREAMS_LOCK:
            STREAMS[stream_id] = q
        with _get_session_agent_lock(s.session_id):
            s.workspace = workspace
            s.model = model
            s.active_stream_id = stream_id
            s.save()
        thr = threading.Thread(
            target=_run_agent_streaming,
            args=(s.session_id, message, model, workspace, stream_id, attachments),
            kwargs={"bungalow_agent_id": bungalow_agent_id},
            daemon=True,
        )
        thr.start()
        if event_sink and run_id and step_id and bungalow_agent_id:
            event_sink(
                {
                    "type": "step_begin",
                    "run_id": run_id,
                    "step_id": step_id,
                    "agent_id": bungalow_agent_id,
                    "stream_id": stream_id,
                }
            )
        final, err, trace = _drain_agent_stream(
            stream_id,
            s.session_id,
            thr,
            q,
            session_ref=s,
            event_sink=event_sink,
            run_id=run_id,
            step_id=step_id,
            agent_id=bungalow_agent_id,
        )
        ok = bool(final) and err is None
        if event_sink and run_id and step_id:
            if err == "cancelled":
                event_sink(
                    {
                        "type": "stopped",
                        "run_id": run_id,
                        "step_id": step_id,
                        "agent_id": bungalow_agent_id,
                    }
                )
            elif err:
                event_sink(
                    {
                        "type": "error",
                        "run_id": run_id,
                        "step_id": step_id,
                        "agent_id": bungalow_agent_id,
                        "message": err,
                        "fatal": False,
                    }
                )
            elif final and bungalow_agent_id:
                event_sink(
                    {
                        "type": "assistant_message",
                        "run_id": run_id,
                        "step_id": step_id,
                        "agent_id": bungalow_agent_id,
                        "markdown": final,
                    }
                )
            event_sink(
                {
                    "type": "step_done",
                    "run_id": run_id,
                    "step_id": step_id,
                    "agent_id": bungalow_agent_id,
                }
            )
        return {
            "ok": ok,
            "reply": final,
            "error": err,
            "profile": profile,
            "internal_session_id": s.session_id,
            "trace": trace,
        }
