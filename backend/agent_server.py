"""
Minimal per-Agent HTTP server.

Each instance runs under a specific HERMES_HOME (profile directory), so the
AIAgent inside gets isolated state: its own SOUL.md, memory.md, sessions, skills.

Usage:
  python agent_server.py --profile default --port 8001 --hermes-home ~/.hermes
  python agent_server.py --profile PyMaster --port 8002 \
      --hermes-home ~/.hermes/profiles/PyMaster

Endpoints:
  GET  /health                     — readiness probe
  POST /api/chat/start             — start streaming turn, returns {stream_id, session_id}
  GET  /api/chat/stream?stream_id  — SSE stream of turn events
  GET  /api/sessions/:sid         — fetch session with messages
  POST /api/sessions               — create a new session
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import sys
import threading
import uuid
from pathlib import Path
from urllib.parse import parse_qs

# ── Parse args ────────────────────────────────────────────────────────────────

parser = argparse.ArgumentParser()
parser.add_argument("--profile", required=True)
parser.add_argument("--port", required=True, type=int)
parser.add_argument("--hermes-home", required=True)
args, _ = parser.parse_known_args()

# Set HERMES_HOME BEFORE any hermes-agent imports
os.environ["HERMES_HOME"] = args.hermes_home
os.environ["HERMES_PROFILE"] = args.profile
os.environ["SINGLE_PROFILE"] = args.profile

# Suppress noisy library loggers
logging.basicConfig(level=logging.WARNING, format="%(message)s")
logger = logging.getLogger("agent_server")
logger.setLevel(logging.INFO)

# ── Import hermes-agent components ────────────────────────────────────────────
# These must come AFTER HERMES_HOME is set so they pick up the right profile.

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

# Session + streaming infrastructure
from api.models import get_session, new_session
from api.streaming import (
    _run_agent_streaming,
    STREAMS,
    STREAMS_LOCK,
    CANCEL_FLAGS,
)
from api.config import get_config

# Profile switching (must be called after all modules that cache HERMES_HOME)
try:
    from api.profiles import switch_profile
    switch_profile(args.profile, process_wide=True)
    logger.info("[agent_server:%s] Profile switched to '%s' (HERMES_HOME=%s)",
                args.profile, args.profile, args.hermes_home)
except Exception as e:
    logger.warning("[agent_server:%s] Profile switch failed: %s", args.profile, e)


# ── SSE helpers ───────────────────────────────────────────────────────────────

def sse_event(event: str, data) -> bytes:
    payload = json.dumps({"event": event, "data": data}, ensure_ascii=False)
    return f"data: {payload}\n\n".encode("utf-8")


# ── Routes ───────────────────────────────────────────────────────────────────

async def health(request: Request) -> JSONResponse:
    return JSONResponse({
        "ok": True,
        "profile": args.profile,
        "port": args.port,
        "hermes_home": args.hermes_home,
    })


async def chat_start(request: Request) -> JSONResponse:
    """POST /api/chat/start — start a streaming turn."""
    try:
        body = json.loads(await request.body())
    except json.JSONDecodeError:
        return JSONResponse({"error": "invalid JSON"}, status_code=400)

    session_id = str(body.get("session_id") or "").strip()
    message = str(body.get("message", "")).strip()
    if not message:
        return JSONResponse({"error": "message required"}, status_code=400)

    workspace = str(body.get("workspace") or str(Path.home() / "ai_projects" / "HermesBungalow"))
    model = body.get("model")

    # Get or create session
    try:
        s = get_session(session_id)
    except KeyError:
        s = new_session(session_id=session_id, workspace=workspace, model=model, profile=args.profile)

    # Resolve model: explicit request > config default > session cached > fallback
    if model:
        resolved_model = model
    else:
        try:
            _cfg = get_config()
            cfg_model = (_cfg.get("model", {}) or {}).get("default") if isinstance(_cfg.get("model"), dict) else None
        except Exception:
            cfg_model = None
        resolved_model = cfg_model or s.model or "mini-max-4-official"

    # Set up streaming infrastructure
    stream_id = uuid.uuid4().hex
    q: queue.Queue = queue.Queue()
    with STREAMS_LOCK:
        STREAMS[stream_id] = q
        CANCEL_FLAGS[stream_id] = threading.Event()

    # Update session
    s.workspace = workspace
    s.model = resolved_model
    s.active_stream_id = stream_id
    s.pending_user_message = message
    s.save()

    # Launch streaming thread
    thr = threading.Thread(
        target=_run_agent_streaming,
        args=(session_id, message, resolved_model, workspace, stream_id, None),
        daemon=True,
    )
    thr.start()

    return JSONResponse({"stream_id": stream_id, "session_id": session_id})


async def chat_stream(request: Request) -> StreamingResponse:
    """GET /api/chat/stream?stream_id=xxx — SSE proxy for turn events."""
    stream_id = request.query_params.get("stream_id", "")
    q = STREAMS.get(stream_id)
    if q is None:
        return StreamingResponse(
            iter([sse_event("error", {"message": "stream not found"})]),
            status_code=404,
            media_type="text/event-stream",
        )

    async def event_stream():
        while True:
            try:
                event, data = q.get(timeout=120)
            except queue.Empty:
                yield b": keepalive\n\n"
                continue

            if event == "token":
                # 'token' from _run_agent_streaming carries {'text': '...'}
                token_text = data.get("text", "") if isinstance(data, dict) else str(data)
                yield sse_event("delta", {"content": token_text})
            elif event == "reasoning":
                # Skip reasoning tokens — they stream separately in the UI
                pass
            elif event == "done":
                yield sse_event("done", data)
                yield b"data: [DONE]\n\n"
                break
            elif event in ("error", "cancel", "stream_end"):
                yield sse_event(event, data)
                break

    return StreamingResponse(
        event_stream(),
        status_code=200,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


async def session_detail(request: Request) -> JSONResponse:
    """GET /api/sessions/:session_id — session with messages."""
    session_id = request.path_params.get("session_id", "")
    try:
        s = get_session(session_id)
    except KeyError:
        return JSONResponse({"error": "not found"}, status_code=404)
    return JSONResponse({
        "session_id": s.session_id,
        "title": s.title,
        "messages": s.messages,
        "model": s.model,
        "workspace": s.workspace,
    })


async def session_create(request: Request) -> JSONResponse:
    """POST /api/sessions — create a new session."""
    try:
        body = json.loads(await request.body())
    except json.JSONDecodeError:
        body = {}
    workspace = str(body.get("workspace") or str(Path.home() / "ai_projects" / "HermesBungalow"))
    model = body.get("model")
    s = new_session(workspace=workspace, model=model, profile=args.profile)
    return JSONResponse({
        "session_id": s.session_id,
        "title": s.title,
        "workspace": s.workspace,
        "model": s.model,
    })


# ── App ───────────────────────────────────────────────────────────────────────

routes = [
    Route("/health", health, methods=["GET"]),
    Route("/api/chat/start", chat_start, methods=["POST"]),
    Route("/api/chat/stream", chat_stream, methods=["GET"]),
    Route("/api/sessions/{session_id}", session_detail, methods=["GET"]),
    Route("/api/sessions", session_create, methods=["POST"]),
]

app = Starlette(routes=routes)


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    logger.info("[agent_server] Starting profile='%s' on 127.0.0.1:%d, HERMES_HOME=%s",
                args.profile, args.port, args.hermes_home)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="warning",
        access_log=False,
    )
