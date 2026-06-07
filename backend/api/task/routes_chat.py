"""Chat + orchestration + SSE + multi-round routes."""
from __future__ import annotations

import asyncio
import itertools
import json
import queue
import threading
import time
import uuid
from functools import partial
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse

from api.task import orchestration as bung_agent
from api.task.service import read_json_body
from ._server_helpers import (
    _ORCH_SSE_LOCK,
    _ORCH_SSE_QUEUES,
    _MULTI_ROUND_LOCK,
    _MULTI_ROUND_SESSIONS,
    _cleanup_stale_multi_round_sessions,
    _resolve_game_agent_token,
    _resolve_game_agent_from_body,
    _orchestrate_turn_sync,
    _sync_session_turn,
)


# ── Lord & Social Chat ───────────────────────────────────────────────


async def post_lord_chat(request: Request) -> JSONResponse:
    """城主单一入口：用户直接与城主对话，自动注入任务链上下文。"""
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    message = str(body.get("message") or "").strip()
    if not message:
        return JSONResponse({"ok": False, "error": "message_required"}, status_code=400)
    wo_id = task_service.monitor_start_work_order(message, "lord")
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            partial(bung_agent.main_agent_orchestrated_turn, message, task_service),
        )
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "lord_turn_failed", "detail": str(e)}, status_code=500)
    try:
        task_service.monitor_record_orchestrate(wo_id, message, "lord", result)
    except Exception:
        pass
    try:
        task_service.apply_game_events_from_orchestrate_result(result)
    except Exception:
        pass
    task_service.persist()
    result = dict(result)
    result["work_order_id"] = wo_id
    return JSONResponse(result)


async def post_agent_social_chat(request: Request) -> JSONResponse:
    """空闲 Agent 闲聊：直接对话，不解析 @handoff，不注入任务上下文。"""
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    message = str(body.get("message") or "").strip()
    if not agent_id or not message:
        return JSONResponse({"ok": False, "error": "agent_id_and_message_required"}, status_code=400)
    agent = _resolve_game_agent_token(agent_id, task_service)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    with task_service._lock:
        for a in task_service.world.agents:
            if a.id == agent.id:
                a.status = "social"
                break
    sid = task_service.ensure_hermes_session_for_agent(agent.id)
    result = _sync_session_turn(sid, message, task_service, bungalow_agent_id=agent.id)
    with task_service._lock:
        for a in task_service.world.agents:
            if a.id == agent.id and a.status == "social":
                a.status = "idle"
                break
    task_service.persist()
    result = dict(result)
    result["agent_id"] = agent.id
    return JSONResponse(result)


async def post_agent_relay_chat(request: Request) -> JSONResponse:
    """Run one LLM turn as another task_service agent (by id, profile, or display name)."""
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    token = str(body.get("to_agent_id") or body.get("target") or "").strip()
    message = str(body.get("message") or "").strip()
    if not token or not message:
        return JSONResponse({"ok": False, "error": "to_agent_id_and_message_required"}, status_code=400)
    agent = _resolve_game_agent_token(token, task_service)
    if not agent:
        return JSONResponse({"ok": False, "error": "target_agent_not_found", "token": token}, status_code=404)
    wo_id = task_service.monitor_start_work_order(f"relay → {token}: {message}", agent.id)
    loop = asyncio.get_event_loop()
    try:
        sid = task_service.ensure_hermes_session_for_agent(agent.id)
        result = await loop.run_in_executor(
            None,
            partial(_sync_session_turn, sid, message, task_service, bungalow_agent_id=agent.id),
        )
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "relay_failed", "detail": str(e)}, status_code=500)
    try:
        task_service.monitor_record_relay(wo_id, agent.id, message, result)
    except Exception:
        pass
    result = dict(result)
    result["work_order_id"] = wo_id
    return JSONResponse(result)


# ── Orchestrated Chat ────────────────────────────────────────────────


async def post_agent_chat_orchestrated(request: Request) -> JSONResponse:
    """One request: peer hint → primary Hermes turn → parse @ handoffs → peer relay turns."""
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    message = str(body.get("message") or "").strip()
    auto_peer = bool(body.get("auto_peer", True))
    raw_atts = body.get("attachments")
    if isinstance(raw_atts, list):
        primary_attachments = [str(x).strip() for x in raw_atts if str(x).strip()]
    else:
        primary_attachments = None
    if not agent_id or not message:
        return JSONResponse({"ok": False, "error": "agent_id_and_message_required"}, status_code=400)
    primary = _resolve_game_agent_token(agent_id, task_service)
    if not primary:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    wo_id = task_service.monitor_start_work_order(message, primary.id)
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            partial(_orchestrate_turn_sync, primary, message, auto_peer, task_service,
                    primary_attachments, event_sink=None, run_id=""),
        )
    except ValueError as e:
        code = str(e)
        task_service.monitor_abort_work_order(wo_id, code)
        if code == "empty_handoff_body":
            return JSONResponse({"ok": False, "error": "empty_handoff_body"}, status_code=400)
        if code == "need_two_agents_for_broadcast":
            return JSONResponse({"ok": False, "error": "need_two_agents_for_broadcast"}, status_code=400)
        return JSONResponse({"ok": False, "error": "orchestrate_failed", "detail": code}, status_code=500)
    except LookupError:
        task_service.monitor_abort_work_order(wo_id, "target_agent_not_found")
        return JSONResponse({"ok": False, "error": "target_agent_not_found"}, status_code=404)
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "orchestrate_failed", "detail": str(e)}, status_code=500)
    try:
        task_service.monitor_record_orchestrate(wo_id, message, primary.id, result)
    except Exception:
        pass
    try:
        task_service.apply_game_events_from_orchestrate_result(result)
    except Exception:
        pass
    task_service.persist()
    result = dict(result)
    result["work_order_id"] = wo_id
    return JSONResponse(result)


# ── Orchestrated SSE ─────────────────────────────────────────────────


def _orchestrate_sse_worker(
    run_id: str,
    wo_id: str,
    primary: Any,
    message: str,
    auto_peer: bool,
    primary_attachments: list[str] | None,
    q: "queue.Queue[dict[str, Any]]",
) -> None:
    from server import task_service  # noqa: PLC0415
    ctr = itertools.count(1)

    def sink(ev: dict[str, Any]) -> None:
        e = dict(ev)
        e["seq"] = next(ctr)
        q.put(e)

    try:
        result = _orchestrate_turn_sync(
            primary, message, auto_peer, task_service, primary_attachments, event_sink=sink, run_id=run_id,
        )
        try:
            task_service.monitor_record_orchestrate(wo_id, message, primary.id, result)
        except Exception:
            pass
        try:
            task_service.apply_game_events_from_orchestrate_result(result)
        except Exception:
            pass
        task_service.persist()
        sink({"type": "turn_done", "run_id": run_id})
    except ValueError as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        sink({"type": "error", "run_id": run_id, "message": str(e), "fatal": True})
        sink({"type": "turn_done", "run_id": run_id})
    except LookupError:
        task_service.monitor_abort_work_order(wo_id, "target_agent_not_found")
        sink({"type": "error", "run_id": run_id, "message": "target_agent_not_found", "fatal": True})
        sink({"type": "turn_done", "run_id": run_id})
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        sink({"type": "error", "run_id": run_id, "message": str(e), "fatal": True})
        sink({"type": "turn_done", "run_id": run_id})


async def post_agent_chat_orchestrated_run(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    message = str(body.get("message") or "").strip()
    auto_peer = bool(body.get("auto_peer", True))
    raw_atts = body.get("attachments")
    if isinstance(raw_atts, list):
        primary_attachments = [str(x).strip() for x in raw_atts if str(x).strip()]
    else:
        primary_attachments = None
    if not agent_id or not message:
        return JSONResponse({"ok": False, "error": "agent_id_and_message_required"}, status_code=400)
    primary = _resolve_game_agent_token(agent_id, task_service)
    if not primary:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    wo_id = task_service.monitor_start_work_order(message, primary.id)
    run_id = uuid.uuid4().hex
    q: queue.Queue[dict[str, Any]] = queue.Queue()
    with _ORCH_SSE_LOCK:
        _ORCH_SSE_QUEUES[run_id] = q
    threading.Thread(
        target=_orchestrate_sse_worker,
        args=(run_id, wo_id, primary, message, auto_peer, primary_attachments, q),
        daemon=True,
    ).start()
    return JSONResponse({"ok": True, "run_id": run_id, "work_order_id": wo_id})


async def get_agent_chat_orchestrated_stream(request: Request) -> StreamingResponse | JSONResponse:
    run_id = str(request.query_params.get("run_id") or "").strip()
    if not run_id:
        return JSONResponse({"ok": False, "error": "run_id_required"}, status_code=400)
    with _ORCH_SSE_LOCK:
        q = _ORCH_SSE_QUEUES.get(run_id)
    if q is None:
        return JSONResponse({"ok": False, "error": "run_not_found_or_finished"}, status_code=404)

    _KEEPALIVE_SEC = 5.0

    def _dequeue():
        try:
            return q.get(timeout=_KEEPALIVE_SEC)
        except queue.Empty:
            return None

    async def gen():
        try:
            while True:
                item = await asyncio.to_thread(_dequeue)
                if item is None:
                    yield ": heartbeat\n\n"
                    continue
                line = json.dumps(item, ensure_ascii=False)
                yield f"data: {line}\n\n"
                if item.get("type") == "turn_done":
                    with _ORCH_SSE_LOCK:
                        _ORCH_SSE_QUEUES.pop(run_id, None)
                    break
        finally:
            pass

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


async def post_agent_stream_cancel(request: Request) -> JSONResponse:
    from api.streaming import cancel_stream

    body = read_json_body(await request.body())
    stream_id = str(body.get("stream_id") or "").strip()
    if not stream_id:
        return JSONResponse({"ok": False, "error": "stream_id_required"}, status_code=400)
    cancelled = cancel_stream(stream_id)
    return JSONResponse({"ok": True, "cancelled": cancelled, "stream_id": stream_id})


# ── Multi-Round SSE Worker ───────────────────────────────────────────


def _multi_round_sse_worker(
    run_id: str,
    session_id: str,
    wo_id: str,
    primary: Any,
    message: str,
    q: "queue.Queue[dict[str, Any]]",
) -> None:
    from server import task_service  # noqa: PLC0415
    ctr = itertools.count(1)

    def sink(ev: dict[str, Any]) -> None:
        e = dict(ev)
        e["seq"] = next(ctr)
        q.put(e)

    try:
        result = bung_agent.orchestrated_peer_turns_sync(
            primary, message, auto_peer=True, task_service=task_service,
            event_sink=sink, run_id=run_id, inject_receipt=True,
        )
        try:
            task_service.monitor_record_orchestrate(wo_id, message, primary.id, result)
        except Exception:
            pass
        try:
            task_service.apply_game_events_from_orchestrate_result(result)
        except Exception:
            pass
        task_service.persist()

        result_dict = dict(result)
        result_dict["work_order_id"] = wo_id
        round_index = 0
        term = result.get("termination_reason")
        with _MULTI_ROUND_LOCK:
            mr = _MULTI_ROUND_SESSIONS.get(session_id)
            if mr and mr.get("status") == "active":
                mr["rounds"].append(result_dict)
                mr["created_at"] = time.time()
                if term and term != "completed":
                    # 出错则标记会话终止
                    mr["status"] = "error"
                elif term == "completed":
                    mr["status"] = "completed"
                round_index = len(mr["rounds"])

        sink({
            "type": "round_done", "run_id": run_id, "session_id": session_id,
            "round_index": round_index, "termination_reason": result.get("termination_reason"),
        })
    except ValueError as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        with _MULTI_ROUND_LOCK:
            mr = _MULTI_ROUND_SESSIONS.get(session_id)
            if mr: mr["status"] = "error"
        sink({"type": "error", "run_id": run_id, "message": str(e), "fatal": True})
        sink({"type": "round_done", "run_id": run_id, "session_id": session_id, "round_index": -1})
    except LookupError:
        task_service.monitor_abort_work_order(wo_id, "target_agent_not_found")
        with _MULTI_ROUND_LOCK:
            mr = _MULTI_ROUND_SESSIONS.get(session_id)
            if mr: mr["status"] = "error"
        sink({"type": "error", "run_id": run_id, "message": "target_agent_not_found", "fatal": True})
        sink({"type": "round_done", "run_id": run_id, "session_id": session_id, "round_index": -1})
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        with _MULTI_ROUND_LOCK:
            mr = _MULTI_ROUND_SESSIONS.get(session_id)
            if mr: mr["status"] = "error"
        sink({"type": "error", "run_id": run_id, "message": str(e), "fatal": True})
        sink({"type": "round_done", "run_id": run_id, "session_id": session_id, "round_index": -1})


# ── Multi-Round SSE Routes ───────────────────────────────────────────


async def post_multi_round_run(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    message = str(body.get("message") or "").strip()
    if not message:
        return JSONResponse({"ok": False, "error": "message_required"}, status_code=400)

    primary = _resolve_game_agent_from_body(body, task_service)
    if not primary:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)

    _cleanup_stale_multi_round_sessions()

    existing_sid = str(body.get("session_id") or "").strip()
    if existing_sid:
        with _MULTI_ROUND_LOCK:
            mr = _MULTI_ROUND_SESSIONS.get(existing_sid)
        if mr and mr.get("status") == "active":
            session_id = existing_sid
        else:
            # 已完结或过期会话 → 新建 session
            session_id = uuid.uuid4().hex
    else:
        session_id = uuid.uuid4().hex

    with _MULTI_ROUND_LOCK:
        if session_id not in _MULTI_ROUND_SESSIONS:
            _MULTI_ROUND_SESSIONS[session_id] = {
                "session_id": session_id,
                "primary_agent_id": primary.id,
                "rounds": [],
                "status": "active",
                "created_at": time.time(),
            }

    wo_id = task_service.monitor_start_work_order(message, primary.id)
    run_id = uuid.uuid4().hex
    q: queue.Queue[dict[str, Any]] = queue.Queue()
    with _ORCH_SSE_LOCK:
        _ORCH_SSE_QUEUES[run_id] = q

    threading.Thread(
        target=_multi_round_sse_worker,
        args=(run_id, session_id, wo_id, primary, message, q),
        daemon=True,
    ).start()

    return JSONResponse({"ok": True, "run_id": run_id, "session_id": session_id, "work_order_id": wo_id})


async def get_multi_round_stream(request: Request) -> StreamingResponse | JSONResponse:
    run_id = str(request.query_params.get("run_id") or "").strip()
    if not run_id:
        return JSONResponse({"ok": False, "error": "run_id_required"}, status_code=400)
    with _ORCH_SSE_LOCK:
        q = _ORCH_SSE_QUEUES.get(run_id)
    if q is None:
        return JSONResponse({"ok": False, "error": "run_not_found_or_finished"}, status_code=404)

    _KEEPALIVE_SEC = 5.0

    def _dequeue():
        try:
            return q.get(timeout=_KEEPALIVE_SEC)
        except queue.Empty:
            return None

    async def gen():
        try:
            while True:
                item = await asyncio.to_thread(_dequeue)
                if item is None:
                    yield ": heartbeat\n\n"
                    continue
                line = json.dumps(item, ensure_ascii=False)
                yield f"data: {line}\n\n"
                if item.get("type") in ("round_done", "turn_done"):
                    with _ORCH_SSE_LOCK:
                        _ORCH_SSE_QUEUES.pop(run_id, None)
                    break
        finally:
            pass

    headers = {"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"}
    return StreamingResponse(gen(), media_type="text/event-stream", headers=headers)


# ── Multi-Round Sync Endpoints ───────────────────────────────────────


async def post_multi_round_start(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    message = str(body.get("message") or "").strip()
    if not message:
        return JSONResponse({"ok": False, "error": "message_required"}, status_code=400)

    primary = _resolve_game_agent_from_body(body, task_service)
    if not primary:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)

    _cleanup_stale_multi_round_sessions()

    session_id = uuid.uuid4().hex
    wo_id = task_service.monitor_start_work_order(message, primary.id)

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            partial(bung_agent.main_agent_orchestrated_turn, message, task_service),
        )
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "lord_turn_failed", "detail": str(e)}, status_code=500)

    try:
        task_service.monitor_record_orchestrate(wo_id, message, "lord", result)
    except Exception:
        pass
    try:
        task_service.apply_game_events_from_orchestrate_result(result)
    except Exception:
        pass
    task_service.persist()

    result = dict(result)
    result["work_order_id"] = wo_id

    session_data: dict[str, Any] = {
        "session_id": session_id,
        "primary_agent_id": primary.id,
        "rounds": [result],
        "status": "active",
        "created_at": time.time(),
    }
    with _MULTI_ROUND_LOCK:
        _MULTI_ROUND_SESSIONS[session_id] = session_data

    return JSONResponse({"ok": True, "session_id": session_id, "rounds": [result], "status": "active"})


async def post_multi_round_continue(request: Request) -> JSONResponse:
    from server import task_service  # noqa: PLC0415
    body = read_json_body(await request.body())
    session_id = str(body.get("session_id") or "").strip()
    message = str(body.get("message") or "").strip()
    if not session_id or not message:
        return JSONResponse({"ok": False, "error": "session_id_and_message_required"}, status_code=400)

    with _MULTI_ROUND_LOCK:
        mr = _MULTI_ROUND_SESSIONS.get(session_id)
    if not mr:
        return JSONResponse({"ok": False, "error": "session_not_found"}, status_code=404)
    if mr.get("status") != "active":
        return JSONResponse({"ok": False, "error": "session_not_active", "status": mr.get("status")}, status_code=400)

    wo_id = task_service.monitor_start_work_order(message, mr["primary_agent_id"])

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            partial(bung_agent.main_agent_orchestrated_turn, message, task_service),
        )
    except Exception as e:
        task_service.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "lord_turn_failed", "detail": str(e)}, status_code=500)

    try:
        task_service.monitor_record_orchestrate(wo_id, message, "lord", result)
    except Exception:
        pass
    try:
        task_service.apply_game_events_from_orchestrate_result(result)
    except Exception:
        pass
    task_service.persist()

    result = dict(result)
    result["work_order_id"] = wo_id

    with _MULTI_ROUND_LOCK:
        mr["rounds"].append(result)
        mr["created_at"] = time.time()

    return JSONResponse({
        "ok": True, "session_id": session_id, "round_count": len(mr["rounds"]),
        "latest_round": result, "status": "active",
    })


async def post_multi_round_stop(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    session_id = str(body.get("session_id") or "").strip()
    if not session_id:
        return JSONResponse({"ok": False, "error": "session_id_required"}, status_code=400)

    with _MULTI_ROUND_LOCK:
        mr = _MULTI_ROUND_SESSIONS.get(session_id)
    if not mr:
        return JSONResponse({"ok": False, "error": "session_not_found"}, status_code=404)

    new_status = str(body.get("status") or "completed").strip()
    if new_status not in ("completed", "cancelled"):
        new_status = "completed"

    with _MULTI_ROUND_LOCK:
        mr["status"] = new_status

    return JSONResponse({"ok": True, "session_id": session_id, "status": new_status, "round_count": len(mr["rounds"])})


async def get_multi_round_session(request: Request) -> JSONResponse:
    session_id = str(request.path_params.get("session_id") or "").strip()
    if not session_id:
        return JSONResponse({"ok": False, "error": "session_id_required"}, status_code=400)

    with _MULTI_ROUND_LOCK:
        mr = _MULTI_ROUND_SESSIONS.get(session_id)
    if not mr:
        return JSONResponse({"ok": False, "error": "session_not_found"}, status_code=404)

    return JSONResponse({
        "ok": True, "session_id": session_id, "primary_agent_id": mr["primary_agent_id"],
        "round_count": len(mr["rounds"]), "rounds": mr["rounds"], "status": mr["status"],
    })


async def get_multi_round_list(request: Request) -> JSONResponse:  # noqa: ARG001
    _cleanup_stale_multi_round_sessions()
    with _MULTI_ROUND_LOCK:
        items = [
            {"session_id": sid, "primary_agent_id": s["primary_agent_id"],
             "round_count": len(s["rounds"]), "status": s["status"]}
            for sid, s in _MULTI_ROUND_SESSIONS.items()
        ]
    return JSONResponse({"ok": True, "sessions": items})
