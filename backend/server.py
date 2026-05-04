from __future__ import annotations

import os
import sys
from pathlib import Path


def _bootstrap_system_hermes_env() -> None:
    """Align with the user's installed Hermes home (~/.hermes: config, .env, agent).

    Python 3.14+ triggers Anthropic's bundled pydantic.v1 incompatibilities when
    the server runs on the system interpreter. If ~/.hermes/hermes-agent/venv
    exists, re-exec the process with that Python (same as Hermes WebUI).
    """
    if os.environ.get("HERMES_BUNGALOW_SKIP_HERMES_BOOTSTRAP"):
        return
    hermes = (Path.home() / ".hermes").resolve()
    if not hermes.is_dir():
        return
    os.environ.setdefault("HERMES_BASE_HOME", str(hermes))
    os.environ.setdefault("HERMES_HOME", str(hermes))
    agent = hermes / "hermes-agent"
    if agent.is_dir():
        os.environ.setdefault("HERMES_WEBUI_AGENT_DIR", str(agent))
        venv_py: Path | None = None
        for rel in ("venv/bin/python", ".venv/bin/python"):
            cand = agent / rel
            if cand.is_file():
                venv_py = cand
                break
        if venv_py is not None:
            os.environ.setdefault("HERMES_WEBUI_PYTHON", str(venv_py))
            try:
                if sys.version_info >= (3, 14) and Path(sys.executable).resolve() != venv_py.resolve():
                    os.execv(str(venv_py), [str(venv_py), *sys.argv])
            except OSError:
                pass


_bootstrap_system_hermes_env()

# Hermes POST routes enforce Origin vs Host; Vite proxy must preserve Host (see vite.config).
# If proxies still rewrite Host, these origins pass CSRF without opening wide public access.
os.environ.setdefault(
    "HERMES_WEBUI_ALLOWED_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000,http://[::1]:3000",
)

import asyncio
import copy
import io
import json
import logging
import random
import re
import queue
import threading
import time
import uuid
from contextlib import asynccontextmanager
from functools import partial
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import uvicorn
from uvicorn.config import LOGGING_CONFIG as UVICORN_LOGGING_CONFIG
from starlette.applications import Starlette
from starlette.datastructures import UploadFile
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from api.game.gateway_hub import GatewayHub, gateway_enabled
from api.multi_agent_gateway import start_all_agents, stop_all_agents
from api.game.handoff_parser import is_broadcast_all_handoff_token, parse_user_handoff_prefix
from api.config import MAX_UPLOAD_BYTES
from api.game.service import GameService, bungalow_session_tls_for_agent_id, read_json_body
from api.models import get_session
from api.upload import _sanitize_upload_name
from api.workspace import safe_resolve_ws
from api.routes import handle_get as hermes_handle_get
from api.routes import handle_post as hermes_handle_post

game = GameService()
hub = GatewayHub()

from api.streaming import register_bungalow_game_service

register_bungalow_game_service(game)
WS_INCOMING_MAX_BYTES = 65536

from api.game import agent as bung_agent


def _sync_session_turn(session_id: str, message: str, *, bungalow_agent_id: str | None = None) -> dict[str, Any]:
    """Run one Hermes turn on an existing session (keeps conversation history)."""
    return bung_agent.sync_session_turn(session_id, message, game, bungalow_agent_id=bungalow_agent_id)


def _orchestrated_peer_turns_sync(
    primary_agent: Any,
    user_message: str,
    auto_peer: bool,
    primary_attachments: list[str] | None = None,
) -> dict[str, Any]:
    return bung_agent.orchestrated_peer_turns_sync(
        primary_agent,
        user_message,
        auto_peer,
        game,
        primary_attachments=primary_attachments,
    )


def _run_recursive_peer_invokes(
    invoker_agent: Any,
    invoke_rows: list[tuple[str, str]],
    depth: int,
    invoker_full_reply: str,
    peer_hint: str,
    agents: list[Any],
) -> list[dict[str, Any]]:
    return bung_agent.run_recursive_peer_invokes(
        game, invoker_agent, invoke_rows, depth, invoker_full_reply, peer_hint, agents
    )


def _build_peer_hint_lines(agents: list[Any]) -> str:
    return bung_agent.build_peer_hint_lines(agents)


def _resolve_game_agent_token(token: str):
    t = token.strip()
    if not t:
        return None
    tl = t.lower()
    with game._lock:
        agents = list(game.world.agents)
    for a in agents:
        if a.id == t:
            return a
    for a in agents:
        prof = str(getattr(a, "profile", "") or "").strip()
        if prof and (prof == t or prof.lower() == tl):
            return a
    for a in agents:
        nm = str(getattr(a, "name", "") or "").strip()
        if nm and (nm == t or nm.lower() == tl):
            return a
    for a in agents:
        dn = str(getattr(a, "display_name", "") or "").strip()
        if dn and (dn == t or dn.lower() == tl):
            return a
    return None


class _BodySink:
    def __init__(self, owner: "_HermesAdapter") -> None:
        self._owner = owner

    def write(self, data: bytes) -> int:
        self._owner._write(data)
        return len(data)

    def flush(self) -> None:
        return None


class _HermesAdapter:
    """Adapt Starlette Request/Response to hermes_webui BaseHTTPRequestHandler style."""

    def __init__(self, request: Request, body_bytes: bytes) -> None:
        self.request = request
        self.command = request.method
        self.headers = request.headers
        self.client_address = (request.client.host if request.client else "127.0.0.1", 0)
        self.rfile = io.BytesIO(body_bytes)
        self.wfile = _BodySink(self)
        self.status_code = 200
        self.response_headers: list[tuple[str, str]] = []
        self._header_done = threading.Event()
        self._stream_q: "queue.Queue[bytes | None]" = queue.Queue()
        self._body = bytearray()

    def send_response(self, status: int) -> None:
        self.status_code = status

    def send_header(self, key: str, value: str) -> None:
        self.response_headers.append((key, value))

    def end_headers(self) -> None:
        self._header_done.set()

    def _write(self, data: bytes) -> None:
        if self.is_sse:
            self._stream_q.put(bytes(data))
        else:
            self._body.extend(data)

    @property
    def is_sse(self) -> bool:
        for k, v in self.response_headers:
            if k.lower() == "content-type" and "text/event-stream" in v.lower():
                return True
        return False

    @property
    def body_bytes(self) -> bytes:
        return bytes(self._body)


async def _dispatch_hermes_via_adapter(request: Request) -> Response:
    body = await request.body()
    parsed = urlparse(str(request.url))
    adapter = _HermesAdapter(request, body)
    loop = asyncio.get_event_loop()

    def _run_dispatch() -> None:
        handled = False
        try:
            if request.method == "GET":
                handled = bool(hermes_handle_get(adapter, parsed))
            elif request.method == "POST":
                handled = bool(hermes_handle_post(adapter, parsed))
            else:
                adapter.send_response(405)
                adapter.send_header("Content-Type", "application/json; charset=utf-8")
                adapter.end_headers()
                adapter.wfile.write(json.dumps({"error": "method_not_allowed"}).encode("utf-8"))
                handled = True
            if not handled and not adapter._header_done.is_set():
                adapter.send_response(404)
                adapter.send_header("Content-Type", "application/json; charset=utf-8")
                adapter.end_headers()
                adapter.wfile.write(json.dumps({"error": "not_found"}).encode("utf-8"))
        except Exception as e:
            if not adapter._header_done.is_set():
                adapter.send_response(500)
                adapter.send_header("Content-Type", "application/json; charset=utf-8")
                adapter.end_headers()
            adapter.wfile.write(json.dumps({"error": "hermes_route_error", "detail": str(e)}).encode("utf-8"))
        finally:
            adapter._stream_q.put(None)

    thr = threading.Thread(target=_run_dispatch, daemon=True)
    thr.start()
    await loop.run_in_executor(None, adapter._header_done.wait)

    headers = dict(adapter.response_headers)
    if adapter.is_sse:
        async def _gen():
            while True:
                chunk = await loop.run_in_executor(None, adapter._stream_q.get)
                if chunk is None:
                    break
                yield chunk

        return StreamingResponse(_gen(), status_code=adapter.status_code, headers=headers, media_type=headers.get("Content-Type"))

    await loop.run_in_executor(None, thr.join)
    return Response(content=adapter.body_bytes, status_code=adapter.status_code, headers=headers, media_type=headers.get("Content-Type"))


def _wire_emit() -> None:
    game.set_emit(lambda ch, data: hub.enqueue_event(ch, data))


_wire_emit()


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True, "service": "hermes-bungalow-game"})


async def get_state(_: Request) -> JSONResponse:
    return JSONResponse(game.snapshot())


async def get_agents(_: Request) -> JSONResponse:
    rows: list[dict[str, Any]] = []
    for a in game.world.agents:
        d = dict(a.to_dict())
        sid = game.get_hermes_session_id(a.id)
        if not sid:
            try:
                sid = game.ensure_hermes_session_for_agent(a.id)
            except Exception:
                sid = ""
        d["hermes_session_id"] = sid or ""
        rows.append(d)
    return JSONResponse({"agents": rows})


async def get_tasks(_: Request) -> JSONResponse:
    return JSONResponse({"tasks": [t.to_dict() for t in game.world.tasks]})


async def get_rooms(_: Request) -> JSONResponse:
    return JSONResponse({"rooms": [r.to_dict() for r in game.world.rooms]})


async def post_agent(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    agent = game.add_agent(body)
    game.persist()
    return JSONResponse({"ok": True, "agent": agent.to_dict()})


async def post_agent_update(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    agent = game.update_agent(body)
    game.persist()
    if not agent:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True, "agent": agent.to_dict()})


async def post_agent_move(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    ok = game.move_agent(str(body.get("agent_id", "")), str(body.get("room_id", "")))
    game.persist()
    if not ok:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True})


async def post_task(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    task = game.create_task(body)
    game.persist()
    return JSONResponse({"ok": True, "task": task.to_dict()})


async def post_task_assign(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    res = game.assign_task(int(body.get("task_id", 0)), body.get("agent_id"))
    game.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_task_complete(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    res = game.complete_task(int(body.get("task_id", 0)), int(body.get("quality", 0)))
    game.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_greeting(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    res = game.greeting(str(body.get("agent_id_a", "")), str(body.get("agent_id_b", "")))
    game.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=400)
    return JSONResponse(res)


async def post_collaboration(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    res = game.collaboration(int(body.get("task_id", 0)))
    game.persist()
    if not res.get("ok"):
        return JSONResponse(res, status_code=404)
    return JSONResponse(res)


async def get_competition_history(_: Request) -> JSONResponse:
    return JSONResponse({"history": game.world.competition_history})


async def post_announcement(request: Request) -> JSONResponse:
    """Broadcast a system announcement to all WebSocket clients via the gateway hub."""
    body = read_json_body(await request.body())
    message = str(body.get("message", ""))
    if not message:
        return JSONResponse({"ok": False, "error": "message is required"}, status_code=400)
    # Publish as a special "announce" channel; all WS clients subscribed to "*" receive it
    await hub.publish("announce", {"message": message})
    return JSONResponse({"ok": True})


async def get_save(_: Request) -> JSONResponse:
    from api.game.persistence import get_save_meta

    meta = get_save_meta(game._conn, "default")
    return JSONResponse({"slot": "default", "meta": meta, "snapshot": game.snapshot()})


async def put_save(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    slot = str(body.get("slot", "default"))
    if "snapshot" in body:
        from api.game.persistence import world_from_dict

        with game._lock:
            game._world = world_from_dict(body["snapshot"])
        game.sync_room_occupancy()
    game.persist(slot)
    return JSONResponse({"ok": True, "slot": slot})


async def post_llm_apply_tags(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    text = str(body.get("text", ""))
    result = game.apply_llm_tags(text)
    game.persist()
    return JSONResponse({"ok": True, **result})


async def post_game_tick(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    minutes = body.get("minutes")
    snap = game.tick_time(int(minutes) if minutes is not None else None)
    game.persist()
    return JSONResponse({"ok": True, **snap})


async def post_sync_hermes_agents(_: Request) -> JSONResponse:
    synced = game.sync_agents_from_hermes()
    return JSONResponse({"ok": True, "synced": synced, "agent_count": len(game.world.agents)})


def _slug_profile_name(raw: str) -> str:
    s = re.sub(r"[^a-z0-9_-]+", "-", raw.strip().lower()).strip("-_")
    if not s:
        s = f"agent-{int(time.time())}"
    if not re.match(r"^[a-z0-9]", s):
        s = f"a-{s}"
    return s[:64]


async def post_create_hermes_profile_agent(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    display_name = str(body.get("name") or "").strip()
    profile_name = str(body.get("profile_name") or "").strip().lower()
    if not display_name:
        return JSONResponse({"ok": False, "error": "name_required"}, status_code=400)
    if not profile_name:
        profile_name = _slug_profile_name(display_name)
    soul = str(body.get("soul") or "").strip()
    memory = str(body.get("memory") or "").strip()
    gender_raw = str(body.get("gender") or "random").strip().lower()
    if gender_raw == "random":
        gender_resolved = random.choice(("male", "female"))
    elif gender_raw in ("male", "female"):
        gender_resolved = gender_raw
    else:
        gender_resolved = "male"

    try:
        from api.profiles import create_profile_api, switch_profile, get_hermes_home_for_profile, _validate_profile_name

        _validate_profile_name(profile_name)
        prof = create_profile_api(profile_name, clone_from="default", clone_config=True)
        home = get_hermes_home_for_profile(profile_name)
        home.mkdir(parents=True, exist_ok=True)
        soul_file = home / "SOUL.md"
        soul_text = soul or f"你叫**{display_name}**，是 Hermes 数字工作室的成员。"
        soul_file.write_text(soul_text, encoding="utf-8")
        if memory:
            (home / "memory.md").write_text(memory, encoding="utf-8")

        # Switch process-wide so game sync reads this new profile immediately.
        switch_profile(profile_name, process_wide=True)
        game.sync_agents_from_hermes()
        # sync 重建「无旧档」的 Agent 时未带 gender，dataclass 默认 male；此处写回创建向导里选的性别。
        for a in game.world.agents:
            if str(getattr(a, "profile", "") or "").strip() == profile_name:
                game.update_agent({"id": a.id, "gender": gender_resolved})
                break
        game.persist()
        return JSONResponse(
            {
                "ok": True,
                "profile": prof,
                "profile_name": profile_name,
                "display_name": display_name,
                "agent_count": len(game.world.agents),
            }
        )
    except FileExistsError:
        return JSONResponse({"ok": False, "error": "profile_exists", "profile_name": profile_name}, status_code=409)
    except Exception as e:
        return JSONResponse({"ok": False, "error": "create_profile_failed", "detail": str(e)}, status_code=500)


async def get_agent_profile_files(request: Request) -> JSONResponse:
    agent_id = str(request.query_params.get("agent_id") or "").strip()
    if not agent_id:
        return JSONResponse({"ok": False, "error": "agent_id_required"}, status_code=400)
    agent = next((a for a in game.world.agents if a.id == agent_id), None)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    profile = str(getattr(agent, "profile", "default") or "default")
    try:
        from api.profiles import get_hermes_home_for_profile

        home = get_hermes_home_for_profile(profile)
        soul_path = home / "SOUL.md"
        memory_path = home / "memory.md"
        soul = soul_path.read_text(encoding="utf-8") if soul_path.exists() else ""
        memory = memory_path.read_text(encoding="utf-8") if memory_path.exists() else ""
        return JSONResponse({"ok": True, "profile": profile, "soul": soul, "memory": memory})
    except Exception as e:
        return JSONResponse({"ok": False, "error": "read_profile_files_failed", "detail": str(e)}, status_code=500)


async def post_agent_profile_files_save(request: Request) -> JSONResponse:
    body = read_json_body(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    if not agent_id:
        return JSONResponse({"ok": False, "error": "agent_id_required"}, status_code=400)
    agent = next((a for a in game.world.agents if a.id == agent_id), None)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    profile = str(getattr(agent, "profile", "default") or "default")
    has_soul = "soul" in body
    has_memory = "memory" in body
    soul = str(body.get("soul") or "")
    memory = str(body.get("memory") or "")
    reset_soul = bool(body.get("reset_soul"))
    try:
        from api.profiles import get_hermes_home_for_profile

        home = get_hermes_home_for_profile(profile)
        home.mkdir(parents=True, exist_ok=True)
        soul_path = home / "SOUL.md"
        memory_path = home / "memory.md"
        if reset_soul:
            soul = f"你叫**{agent.name}**，是 Hermes 数字工作室的成员。"
            soul_path.write_text(soul, encoding="utf-8")
        elif has_soul:
            soul_path.write_text(soul, encoding="utf-8")
        if has_memory:
            memory_path.write_text(memory, encoding="utf-8")
        # Sync game-side projection from profile files so UI reflects latest identity.
        if has_soul or reset_soul:
            game.sync_agents_from_hermes()
            game.persist()
        return JSONResponse({"ok": True, "profile": profile})
    except Exception as e:
        return JSONResponse({"ok": False, "error": "save_profile_files_failed", "detail": str(e)}, status_code=500)


async def post_agent_relay_chat(request: Request) -> JSONResponse:
    """Run one LLM turn as another game agent (by id, profile, or display name).

    This is explicit cross-agent inference; the normal chat UI only talks to the
    selected agent's session — models do not automatically call each other.
    """
    body = read_json_body(await request.body())
    token = str(body.get("to_agent_id") or body.get("target") or "").strip()
    message = str(body.get("message") or "").strip()
    if not token or not message:
        return JSONResponse({"ok": False, "error": "to_agent_id_and_message_required"}, status_code=400)
    agent = _resolve_game_agent_token(token)
    if not agent:
        return JSONResponse({"ok": False, "error": "target_agent_not_found", "token": token}, status_code=404)
    wo_id = game.monitor_start_work_order(f"relay → {token}: {message}", agent.id)
    loop = asyncio.get_event_loop()
    try:
        sid = game.ensure_hermes_session_for_agent(agent.id)
        result = await loop.run_in_executor(
            None,
            partial(_sync_session_turn, sid, message, bungalow_agent_id=agent.id),
        )
    except Exception as e:
        game.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "relay_failed", "detail": str(e)}, status_code=500)
    try:
        game.monitor_record_relay(wo_id, agent.id, message, result)
    except Exception:
        pass
    result = dict(result)
    result["work_order_id"] = wo_id
    return JSONResponse(result)


async def post_agent_chat_orchestrated(request: Request) -> JSONResponse:
    """One request: peer hint → primary Hermes turn → parse @ handoffs → peer relay turns.

    Uses the server-side Hermes session pool (``ensure_hermes_session_for_agent``) for
    the primary and each peer so conversations accumulate. Body: ``agent_id``,
    ``message``, optional ``auto_peer`` (default True).

    If ``message`` starts with a user handoff prefix (``@对方|…`` / ``@所有人 …``),
    skips the primary model turn and relays directly (with nested @ handling).
    """
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
    primary = _resolve_game_agent_token(agent_id)
    if not primary:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    wo_id = game.monitor_start_work_order(message, primary.id)
    loop = asyncio.get_event_loop()
    try:
        uh = parse_user_handoff_prefix(message)
        if uh:
            with game._lock:
                agents = list(game.world.agents)
            peer_hint = _build_peer_hint_lines(agents) if auto_peer and len(agents) > 1 else ""
            token = str(uh.get("token") or "").strip()
            sub = str(uh.get("message") or "").strip()
            if not sub:
                game.monitor_abort_work_order(wo_id, "empty_handoff_body")
                return JSONResponse({"ok": False, "error": "empty_handoff_body"}, status_code=400)
            if is_broadcast_all_handoff_token(token):
                if len(agents) < 2:
                    game.monitor_abort_work_order(wo_id, "need_two_agents_for_broadcast")
                    return JSONResponse({"ok": False, "error": "need_two_agents_for_broadcast"}, status_code=400)
                delegations = _run_recursive_peer_invokes(
                    primary, [(token, sub)], 0, "", peer_hint, agents
                )
                result = {
                    "ok": True,
                    "primary": {"ok": True, "reply": "", "error": None, "user_handoff": "broadcast"},
                    "delegations": delegations,
                }
            else:
                peer = _resolve_game_agent_token(token)
                if not peer:
                    game.monitor_abort_work_order(wo_id, "target_agent_not_found")
                    return JSONResponse(
                        {"ok": False, "error": "target_agent_not_found", "token": token},
                        status_code=404,
                    )
                delegations = _run_recursive_peer_invokes(
                    primary, [(token, sub)], 0, "", peer_hint, agents
                )
                result = {
                    "ok": True,
                    "primary": {"ok": True, "reply": "", "error": None, "user_handoff": "relay"},
                    "delegations": delegations,
                }
        else:
            result = await loop.run_in_executor(
                None,
                partial(
                    _orchestrated_peer_turns_sync,
                    primary,
                    message,
                    auto_peer,
                    primary_attachments,
                ),
            )
    except Exception as e:
        game.monitor_abort_work_order(wo_id, str(e))
        return JSONResponse({"ok": False, "error": "orchestrate_failed", "detail": str(e)}, status_code=500)
    try:
        game.monitor_record_orchestrate(wo_id, message, primary.id, result)
    except Exception:
        pass
    result = dict(result)
    result["work_order_id"] = wo_id
    return JSONResponse(result)


async def get_monitor_work_orders(_: Request) -> JSONResponse:
    return JSONResponse({"ok": True, "work_orders": game.monitor_list_work_orders(80)})


async def get_monitor_work_order_detail(request: Request) -> JSONResponse:
    wo_id = str(request.path_params.get("wo_id") or "").strip()
    if not wo_id:
        return JSONResponse({"ok": False, "error": "missing_id"}, status_code=400)
    d = game.monitor_get_work_order_detail(wo_id)
    if not d:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True, "work_order": d})


async def get_monitor_artifact_body(request: Request) -> JSONResponse:
    aid = str(request.path_params.get("artifact_id") or "").strip()
    if not aid:
        return JSONResponse({"ok": False, "error": "missing_id"}, status_code=400)
    row = game.monitor_get_artifact_body(aid)
    if not row:
        return JSONResponse({"ok": False, "error": "not_found"}, status_code=404)
    return JSONResponse({"ok": True, "artifact": row})


async def post_game_hermes_session(request: Request) -> JSONResponse:
    """BFF: ensure Hermes chat session for a game agent (browser must not call /api/session/new)."""
    body = read_json_body(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    if not agent_id:
        return JSONResponse({"ok": False, "error": "agent_id_required"}, status_code=400)
    agent = _resolve_game_agent_token(agent_id)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    loop = asyncio.get_event_loop()
    try:
        sid = await loop.run_in_executor(None, game.ensure_hermes_session_for_agent, agent.id)
    except KeyError:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    return JSONResponse({"ok": True, "session_id": sid})


async def post_game_agent_upload_attachment(request: Request) -> JSONResponse:
    """BFF: multipart agent_id + file → same on-disk layout as Hermes /api/upload (browser must not call that)."""
    ct = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in ct:
        return JSONResponse({"ok": False, "error": "multipart_required"}, status_code=400)
    form = await request.form()
    agent_id = str(form.get("agent_id") or "").strip()
    up = form.get("file")
    if not agent_id or up is None:
        return JSONResponse({"ok": False, "error": "agent_id_and_file_required"}, status_code=400)
    if not isinstance(up, UploadFile):
        return JSONResponse({"ok": False, "error": "invalid_file_field"}, status_code=400)
    agent = _resolve_game_agent_token(agent_id)
    if not agent:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)
    raw = await up.read()
    if len(raw) > MAX_UPLOAD_BYTES:
        return JSONResponse({"ok": False, "error": "file_too_large"}, status_code=413)
    filename = (up.filename or "upload").strip() or "upload"
    aid = agent.id
    raw_bytes = raw

    def _save() -> dict[str, Any]:
        sid = game.ensure_hermes_session_for_agent(aid)
        s = get_session(sid)
        workspace = Path(s.workspace)
        safe_name = _sanitize_upload_name(filename)
        dest = safe_resolve_ws(workspace, safe_name)
        dest.write_bytes(raw_bytes)
        return {"filename": safe_name, "path": str(dest), "size": dest.stat().st_size}

    loop = asyncio.get_event_loop()
    try:
        out = await loop.run_in_executor(None, _save)
    except KeyError as e:
        return JSONResponse({"ok": False, "error": "session_not_found", "detail": str(e)}, status_code=500)
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    except Exception as e:
        return JSONResponse({"ok": False, "error": "upload_failed", "detail": str(e)}, status_code=500)
    return JSONResponse({"ok": True, **out})


async def hermes_api_get(request: Request) -> Response:
    return await _dispatch_hermes_via_adapter(request)


async def hermes_api_post(request: Request) -> Response:
    return await _dispatch_hermes_via_adapter(request)


async def gateway_ws(ws: WebSocket) -> None:
    if not gateway_enabled():
        await ws.close(code=4403)
        return
    await ws.accept()
    channels: set[str] = {"*"}
    hub.register(ws, channels)
    try:
        await ws.send_text(json.dumps({"type": "system", "message": "gateway_ready"}, ensure_ascii=False))
        while True:
            raw = await ws.receive_text()
            if len(raw.encode("utf-8")) > WS_INCOMING_MAX_BYTES:
                await ws.send_text(
                    json.dumps({"type": "error", "message": "payload_too_large"}, ensure_ascii=False)
                )
                continue
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                await ws.send_text(json.dumps({"type": "error", "message": "invalid_json"}, ensure_ascii=False))
                continue
            mtype = msg.get("type")
            if mtype == "ping":
                await ws.send_text(json.dumps({"type": "pong"}, ensure_ascii=False))
            elif mtype == "game_event_sub":
                chans = msg.get("channels") or []
                channels = set(str(c) for c in chans) if chans else {"*"}
                hub.unregister(ws)
                hub.register(ws, channels)
            elif mtype == "chat":
                text = str(msg.get("message", ""))
                for i, ch in enumerate(text):
                    await ws.send_text(
                        json.dumps({"type": "chat_stream", "content": ch, "done": False}, ensure_ascii=False)
                    )
                result = game.apply_llm_tags(text)
                game.persist()
                await ws.send_text(
                    json.dumps(
                        {"type": "chat_done", "content": text, "game_events": result},
                        ensure_ascii=False,
                    )
                )
            else:
                await ws.send_text(
                    json.dumps({"type": "error", "message": f"unknown_type:{mtype}"}, ensure_ascii=False)
                )
    except WebSocketDisconnect:
        pass
    finally:
        hub.unregister(ws)


@asynccontextmanager
async def lifespan(_: Starlette):
    # Startup: begin hub pump before yielding so it's ready when connections arrive
    if gateway_enabled():
        ensure_multi_agent_gateway_logging()
        await hub.start_pump()
        # Start all discovered agent processes in a thread pool (they are blocking/sync)
        # This avoids holding up the async event loop while agents spawn and /health polls
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, start_all_agents)
    yield
    # Shutdown: stop all agents, then shut down hub pump
    if gateway_enabled():
        stop_all_agents()
    await hub.shutdown()


routes: list[Route | WebSocketRoute] = [
    Route("/health", health, methods=["GET"]),
    Route("/api/game/state", get_state, methods=["GET"]),
    Route("/api/game/agents", get_agents, methods=["GET"]),
    Route("/api/game/tasks", get_tasks, methods=["GET"]),
    Route("/api/game/rooms", get_rooms, methods=["GET"]),
    Route("/api/game/agent", post_agent, methods=["POST"]),
    Route("/api/game/agent/update", post_agent_update, methods=["POST"]),
    Route("/api/game/agent/move", post_agent_move, methods=["POST"]),
    Route("/api/game/task", post_task, methods=["POST"]),
    Route("/api/game/task/assign", post_task_assign, methods=["POST"]),
    Route("/api/game/task/complete", post_task_complete, methods=["POST"]),
    Route("/api/game/greeting", post_greeting, methods=["POST"]),
    Route("/api/game/collaboration", post_collaboration, methods=["POST"]),
    Route("/api/game/competition/history", get_competition_history, methods=["GET"]),
    Route("/api/game/announcement", post_announcement, methods=["POST"]),
    Route("/api/game/save", get_save, methods=["GET"]),
    Route("/api/game/save", put_save, methods=["PUT"]),
    Route("/api/game/llm/apply-tags", post_llm_apply_tags, methods=["POST"]),
    Route("/api/game/tick", post_game_tick, methods=["POST"]),
    Route("/api/game/agents/sync-hermes", post_sync_hermes_agents, methods=["POST"]),
    Route("/api/game/agent/create-from-hermes-profile", post_create_hermes_profile_agent, methods=["POST"]),
    Route("/api/game/agent/profile-files", get_agent_profile_files, methods=["GET"]),
    Route("/api/game/agent/profile-files/save", post_agent_profile_files_save, methods=["POST"]),
    Route("/api/game/agent-relay", post_agent_relay_chat, methods=["POST"]),
    Route("/api/game/agent-chat-orchestrated", post_agent_chat_orchestrated, methods=["POST"]),
    Route("/api/game/monitor/work-orders", get_monitor_work_orders, methods=["GET"]),
    Route("/api/game/monitor/work-orders/{wo_id}", get_monitor_work_order_detail, methods=["GET"]),
    Route("/api/game/monitor/artifacts/{artifact_id}", get_monitor_artifact_body, methods=["GET"]),
    Route("/api/game/hermes/session", post_game_hermes_session, methods=["POST"]),
    Route("/api/game/agent/upload-attachment", post_game_agent_upload_attachment, methods=["POST"]),
    Route("/api/session/new", hermes_api_post, methods=["POST"]),
    Route("/api/chat/start", hermes_api_post, methods=["POST"]),
    Route("/api/chat/stream", hermes_api_get, methods=["GET"]),
    Route("/api/providers", hermes_api_get, methods=["GET"]),
    Route("/api/providers", hermes_api_post, methods=["POST"]),
    Route("/api/models", hermes_api_get, methods=["GET"]),
    Route("/api/{rest:path}", hermes_api_get, methods=["GET"]),
    Route("/api/{rest:path}", hermes_api_post, methods=["POST"]),
    WebSocketRoute("/ws/gateway", gateway_ws),
]

app = Starlette(debug=False, routes=routes, lifespan=lifespan)


def ensure_multi_agent_gateway_logging() -> None:
    """`uvicorn server:app` 不会走 server.main()，需在此处保证 gateway 的 INFO 能输出到 stderr（含 start-dev.sh 重定向的日志文件）。"""
    if getattr(ensure_multi_agent_gateway_logging, "_done", False):
        return
    log = logging.getLogger("api.multi_agent_gateway")
    if log.handlers:
        setattr(ensure_multi_agent_gateway_logging, "_done", True)
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(levelname)s [%(name)s] %(message)s"))
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    log.propagate = False
    setattr(ensure_multi_agent_gateway_logging, "_done", True)


def _uvicorn_log_config() -> dict[str, Any]:
    """Include app loggers that default logging would otherwise drop (root stays quiet)."""
    cfg = copy.deepcopy(UVICORN_LOGGING_CONFIG)
    gw_handler = {"handlers": ["default"], "level": "INFO", "propagate": False}
    cfg["loggers"]["api.multi_agent_gateway"] = gw_handler
    return cfg


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run(
        app,
        host=host,
        port=port,
        log_level="info",
        log_config=_uvicorn_log_config(),
    )


if __name__ == "__main__":
    main()
