"""
马斯特 Agent 推理引擎（从 server.py 拆分）

同一进程内纯模块——server.py 导入并直接调用。
不含 HTTP handler，所有 handler 留在 server.py。

导出函数：
- resolve_game_agent_token(token, game_service)
- sync_session_turn(session_id, message, game_service, *, bungalow_agent_id)
- orchestrated_peer_turns_sync(primary_agent, user_message, auto_peer, game_service)
"""
from __future__ import annotations

import queue
import re
import threading
import uuid
from pathlib import Path
from typing import Any

try:
    from api.streaming import STREAMS, STREAMS_LOCK, _run_agent_streaming
except ImportError:
    STREAMS = {}
    STREAMS_LOCK = threading.RLock()

# ── Handoff 解析（从 server.py 迁移） ─────────────────────────────────────

_AT_PIPE_LINE = re.compile(r"^\s*@([^\s|@]+)\s*[|\uff5c]\s*(.+)\s*$")
_AT_SPACE_LINE = re.compile(r"^\s*@([^\s|@]+)\s+(.+)\s*$")

HANDOFF_CONTEXT_MAX = 28000


def build_peer_hint_lines(agents: list[Any]) -> str:
    if len(agents) < 2:
        return ""
    parts: list[str] = []
    for a in agents:
        prof = str(getattr(a, "profile", None) or "") or getattr(a, "id", "")
        name = str(getattr(a, "name", None) or prof)
        parts.append(f"{name}（@{prof}）")
    list_str = "，".join(parts)
    return (
        "（多 Agent：同伴无主从，可互转。Hermes 内置委派工具已关，同伴转交请在全文**最后单独一行**写："
        "`@对方的 profile、游戏 id、姓名或显示名 | 交给对方的完整说明`（全角｜可代替|）。"
        "也可用无竖线：`@对方 完整说明`；群发除自己外全体：`@所有人 | 同一说明` 或 `@所有人 同一说明`（或 `@all …`）。"
        "勿向用户声称多 Agent 已禁用。同伴："
        + list_str
        + "。无需转交时不要写以 `@` 开头的该行。）\n\n"
    )


def parse_at_handoffs(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.replace("\uff5c", "|").strip()
        if not line.startswith("@"):
            continue
        mp = _AT_PIPE_LINE.match(line)
        if mp:
            t, msg = mp.group(1).strip(), mp.group(2).strip()
            if t and msg:
                out.append((t, msg))
            continue
        ms = _AT_SPACE_LINE.match(line)
        if ms:
            t, msg = ms.group(1).strip(), ms.group(2).strip()
            if t and msg:
                out.append((t, msg))
    return out


def parse_hermes_bungalow_invokes(text: str) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for t, msg in parse_at_handoffs(text):
        key = (t, msg)
        if key not in seen:
            seen.add(key)
            out.append((t, msg))
    return out


def expand_broadcast_invokes(primary_agent: Any, agents: list[Any], invokes: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """`@所有人 | msg` / `@all | msg` → 除 primary 外每名同伴一条 (profile_token, msg)。"""
    pid = getattr(primary_agent, "id", None)
    out: list[tuple[str, str]] = []
    for tt, msg in invokes:
        t = str(tt).strip()
        if t == "所有人" or t.lower() == "all":
            for a in agents:
                if getattr(a, "id", None) == pid:
                    continue
                prof = str(getattr(a, "profile", "") or "").strip() or str(getattr(a, "id", ""))
                out.append((prof, msg))
        else:
            out.append((t, msg))
    return out


def strip_bungalow_invokes(text: str) -> str:
    lines: list[str] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.replace("\uff5c", "|").strip()
        if line.startswith("@") and (_AT_PIPE_LINE.match(line) or _AT_SPACE_LINE.match(line)):
            continue
        lines.append(raw_line)
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def truncate_handoff_context(text: str, max_len: int = HANDOFF_CONTEXT_MAX) -> str:
    u = text.strip()
    if len(u) <= max_len:
        return u
    head = int(max_len * 0.35)
    tail = max_len - head - 80
    if tail < 500:
        return u[:max_len] + "\n…[truncated]"
    omitted = len(u) - head - tail
    return f"{u[:head]}\n\n…[省略 {omitted} 字]…\n\n{u[-tail:]}"


def compose_peer_handoff(peer_hint: str, invoker_full_reply: str, invoke_body: str) -> str:
    body = (invoke_body or "").strip()
    stripped = strip_bungalow_invokes(invoker_full_reply)
    if not stripped:
        return peer_hint + body
    ctx = (
        "\n\n──────── 同伴本轮对用户输出的正文（@ 转交行已剥离）────────\n"
        f"{truncate_handoff_context(stripped)}\n\n"
        "──────── 对方点名要你处理的任务 ────────\n"
        f"{body}"
    )
    return peer_hint + ctx


# ── 流式结果消费（从 server.py 迁移） ────────────────────────────────────

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
) -> tuple[str, str | None]:
    final = ""
    err: str | None = None
    try:
        while True:
            try:
                item = stream_queue.get(timeout=600)
            except queue.Empty:
                err = "relay_timeout"
                break
            ev, data = item
            if ev == "done":
                final = _extract_assistant_from_done_payload(data)
                break
            if ev == "apperror":
                err = str(data.get("message") or data.get("type") or "apperror") if isinstance(data, dict) else "apperror"
                break
            if ev == "error":
                err = str(data)
                break
            if ev == "cancel":
                err = "cancelled"
                break
    finally:
        stream_thread.join(timeout=180)
    sid_for_disk = session_id
    if session_ref is not None and getattr(session_ref, "session_id", None):
        sid_for_disk = str(session_ref.session_id)
    if not final and not err:
        final = _fallback_assistant_from_session_disk(sid_for_disk)
    if not final and not err:
        err = "empty_reply"
    return final, err


# ── 核心推理函数 ───────────────────────────────────────────────────────────

def resolve_game_agent_token(token: str, game_service: Any):
    """Resolve an agent by id, profile, name, or display_name（ASCII 不区分大小写）。"""
    t = token.strip()
    if not t:
        return None
    tl = t.lower()
    with game_service._lock:
        agents = list(game_service.world.agents)
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


def sync_session_turn(
    session_id: str,
    message: str,
    game_service: Any,
    *,
    bungalow_agent_id: str | None = None,
) -> dict[str, Any]:
    """Run one Hermes turn on an existing session (keeps conversation history)."""
    from api.config import _get_session_agent_lock, get_config

    s = game_service.get_session(session_id)
    profile = str(getattr(s, "profile", None) or "default")
    default_ws = str((Path.home() / "ai_projects" / "HermesBungalow").resolve())
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
        args=(s.session_id, message, model, workspace, stream_id, None),
        kwargs={"bungalow_agent_id": bungalow_agent_id},
        daemon=True,
    )
    thr.start()
    final, err = _drain_agent_stream(stream_id, s.session_id, thr, q, session_ref=s)
    ok = bool(final) and err is None
    return {
        "ok": ok,
        "reply": final,
        "error": err,
        "profile": profile,
        "internal_session_id": s.session_id,
    }


def orchestrated_peer_turns_sync(
    primary_agent: Any,
    user_message: str,
    auto_peer: bool,
    game_service: Any,
) -> dict[str, Any]:
    """Primary turn (+ auto peer hint), parse @ handoffs, run peer relay turns."""
    with game_service._lock:
        agents = list(game_service.world.agents)
    peer_hint = build_peer_hint_lines(agents) if auto_peer and len(agents) > 1 else ""
    full_message = peer_hint + user_message
    sid0 = game_service.ensure_hermes_session_for_agent(primary_agent.id)
    prim = sync_session_turn(sid0, full_message, game_service, bungalow_agent_id=primary_agent.id)
    primary_reply = str(prim.get("reply") or "")
    invokes = expand_broadcast_invokes(primary_agent, agents, parse_hermes_bungalow_invokes(primary_reply))
    primary_prof = str(getattr(primary_agent, "profile", "") or "default")
    self_tokens = {primary_agent.id, primary_prof, primary_agent.name}
    _dn0 = str(getattr(primary_agent, "display_name", "") or "").strip()
    if _dn0:
        self_tokens.add(_dn0)
    delegations: list[dict[str, Any]] = []
    for target_token, submsg in invokes:
        if target_token in self_tokens:
            delegations.append({"target": target_token, "ok": False, "error": "self_invoke_skipped"})
            continue
        peer = resolve_game_agent_token(target_token, game_service)
        if not peer:
            delegations.append({"target": target_token, "ok": False, "error": "target_not_found"})
            continue
        peer_prof = str(getattr(peer, "profile", "") or "default")
        peer_sid = game_service.ensure_hermes_session_for_agent(peer.id)
        peer_turn = sync_session_turn(
            peer_sid,
            compose_peer_handoff(peer_hint, primary_reply, submsg),
            game_service,
            bungalow_agent_id=peer.id,
        )
        delegations.append(
            {
                "target": target_token,
                "profile": peer_prof,
                "ok": peer_turn.get("ok"),
                "reply": peer_turn.get("reply"),
                "error": peer_turn.get("error"),
            }
        )
    return {"ok": bool(prim.get("ok")), "primary": prim, "delegations": delegations}


import asyncio
import json
import queue
import re
import threading
import time
import uuid
from functools import partial
from pathlib import Path
from typing import Any
import os

import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, StreamingResponse
from starlette.routing import Route

# ── 全局游戏服务（与 server.py 共享同一个 GameService 实例） ──────────────
# server.py 初始化 game = GameService()，注册到模块级别，本模块通过 import 共享
try:
    from api.game.service import GameService
except ImportError:
    GameService = None

try:
    from api.game.gateway_hub import GatewayHub, gateway_enabled
except ImportError:
    GatewayHub = None
    gateway_enabled = lambda: False

try:
    from api.streaming import STREAMS, STREAMS_LOCK, _run_agent_streaming
except ImportError:
    STREAMS = {}
    STREAMS_LOCK = threading.RLock()

# ── 外部 HTTP 客户端（Sidecar 调用 Agent 用） ──────────────────────────────
# Agent 运行在 :8001，由外部注入或环境变量决定
AGENT_HOST = "127.0.0.1"
AGENT_PORT = 8001

# ── Handoff 解析（从 server.py 迁移） ─────────────────────────────────────

_AT_PIPE_LINE = re.compile(r"^\s*@([^\s|@]+)\s*[|\uff5c]\s*(.+)\s*$")
_AT_SPACE_LINE = re.compile(r"^\s*@([^\s|@]+)\s+(.+)\s*$")

HANDOFF_CONTEXT_MAX = 28000


def _build_peer_hint_lines(agents: list[Any]) -> str:
    if len(agents) < 2:
        return ""
    parts: list[str] = []
    for a in agents:
        prof = str(getattr(a, "profile", None) or "") or getattr(a, "id", "")
        name = str(getattr(a, "name", None) or prof)
        parts.append(f"{name}（@{prof}）")
    list_str = "，".join(parts)
    return (
        "（多 Agent：同伴无主从，可互转。Hermes 内置委派工具已关，同伴转交请在全文**最后单独一行**写："
        "`@对方的 profile、游戏 id、姓名或显示名 | 交给对方的完整说明`（全角｜可代替|）。"
        "也可用无竖线：`@对方 完整说明`；群发除自己外全体：`@所有人 | 同一说明` 或 `@所有人 同一说明`（或 `@all …`）。"
        "勿向用户声称多 Agent 已禁用。同伴："
        + list_str
        + "。无需转交时不要写以 `@` 开头的该行。）\n\n"
    )


def _parse_at_handoffs(text: str) -> list[tuple[str, str]]:
    out: list[tuple[str, str]] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.replace("\uff5c", "|").strip()
        if not line.startswith("@"):
            continue
        mp = _AT_PIPE_LINE.match(line)
        if mp:
            t, msg = mp.group(1).strip(), mp.group(2).strip()
            if t and msg:
                out.append((t, msg))
            continue
        ms = _AT_SPACE_LINE.match(line)
        if ms:
            t, msg = ms.group(1).strip(), ms.group(2).strip()
            if t and msg:
                out.append((t, msg))
    return out


def _parse_hermes_bungalow_invokes(text: str) -> list[tuple[str, str]]:
    seen: set[tuple[str, str]] = set()
    out: list[tuple[str, str]] = []
    for t, msg in _parse_at_handoffs(text):
        key = (t, msg)
        if key not in seen:
            seen.add(key)
            out.append((t, msg))
    return out


def _strip_bungalow_invokes(text: str) -> str:
    lines: list[str] = []
    for raw_line in (text or "").splitlines():
        line = raw_line.replace("\uff5c", "|").strip()
        if line.startswith("@") and (_AT_PIPE_LINE.match(line) or _AT_SPACE_LINE.match(line)):
            continue
        lines.append(raw_line)
    out = "\n".join(lines)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def _truncate_handoff_context(text: str, max_len: int = HANDOFF_CONTEXT_MAX) -> str:
    u = text.strip()
    if len(u) <= max_len:
        return u
    head = int(max_len * 0.35)
    tail = max_len - head - 80
    if tail < 500:
        return u[:max_len] + "\n…[truncated]"
    omitted = len(u) - head - tail
    return f"{u[:head]}\n\n…[省略 {omitted} 字]…\n\n{u[-tail:]}"


def _compose_peer_handoff(peer_hint: str, invoker_full_reply: str, invoke_body: str) -> str:
    body = (invoke_body or "").strip()
    stripped = _strip_bungalow_invokes(invoker_full_reply)
    if not stripped:
        return peer_hint + body
    ctx = (
        "\n\n──────── 同伴本轮对用户输出的正文（@ 转交行已剥离）────────\n"
        f"{_truncate_handoff_context(stripped)}\n\n"
        "──────── 对方点名要你处理的任务 ────────\n"
        f"{body}"
    )
    return peer_hint + ctx


# ── 流式结果消费（从 server.py 迁移） ────────────────────────────────────

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
) -> tuple[str, str | None]:
    final = ""
    err: str | None = None
    try:
        while True:
            try:
                item = stream_queue.get(timeout=600)
            except queue.Empty:
                err = "relay_timeout"
                break
            ev, data = item
            if ev == "done":
                final = _extract_assistant_from_done_payload(data)
                break
            if ev == "apperror":
                if isinstance(data, dict):
                    err = str(data.get("message") or data.get("type") or "apperror")
                else:
                    err = "apperror"
                break
            if ev == "error":
                err = str(data)
                break
            if ev == "cancel":
                err = "cancelled"
                break
    finally:
        stream_thread.join(timeout=180)
    sid_for_disk = session_id
    if session_ref is not None and getattr(session_ref, "session_id", None):
        sid_for_disk = str(session_ref.session_id)
    if not final and not err:
        final = _fallback_assistant_from_session_disk(sid_for_disk)
    if not final and not err:
        err = "empty_reply"
    return final, err


# ── 核心推理函数（从 server.py 迁移） ────────────────────────────────────

def _resolve_game_agent_token(token: str, game_service: Any):
    return resolve_game_agent_token(token, game_service)


def _sync_session_turn(
    session_id: str,
    message: str,
    *,
    game_service: Any,
    bungalow_agent_id: str | None = None,
) -> dict[str, Any]:
    """Run one Hermes turn on an existing session (keeps conversation history)."""
    from api.config import _get_session_agent_lock, get_config

    s = game_service.get_session(session_id)
    profile = str(getattr(s, "profile", None) or "default")
    default_ws = str((Path.home() / "ai_projects" / "HermesBungalow").resolve())
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
        args=(s.session_id, message, model, workspace, stream_id, None),
        kwargs={"bungalow_agent_id": bungalow_agent_id},
        daemon=True,
    )
    thr.start()
    final, err = _drain_agent_stream(stream_id, s.session_id, thr, q, session_ref=s)
    ok = bool(final) and err is None
    return {
        "ok": ok,
        "reply": final,
        "error": err,
        "profile": profile,
        "internal_session_id": s.session_id,
    }


def _orchestrated_peer_turns_sync(
    primary_agent: Any,
    user_message: str,
    auto_peer: bool,
    game_service: Any,
) -> dict[str, Any]:
    """Primary turn (+ auto peer hint), parse @ handoffs, run peer relay turns."""
    with game_service._lock:
        agents = list(game_service.world.agents)
    peer_hint = _build_peer_hint_lines(agents) if auto_peer and len(agents) > 1 else ""
    full_message = peer_hint + user_message
    sid0 = game_service.ensure_hermes_session_for_agent(primary_agent.id)
    prim = _sync_session_turn(sid0, full_message, game_service=game_service, bungalow_agent_id=primary_agent.id)
    primary_reply = str(prim.get("reply") or "")
    invokes = expand_broadcast_invokes(primary_agent, agents, _parse_hermes_bungalow_invokes(primary_reply))
    primary_prof = str(getattr(primary_agent, "profile", "") or "default")
    self_tokens = {primary_agent.id, primary_prof, primary_agent.name}
    _dn1 = str(getattr(primary_agent, "display_name", "") or "").strip()
    if _dn1:
        self_tokens.add(_dn1)
    delegations: list[dict[str, Any]] = []
    for target_token, submsg in invokes:
        if target_token in self_tokens:
            delegations.append({"target": target_token, "ok": False, "error": "self_invoke_skipped"})
            continue
        peer = _resolve_game_agent_token(target_token, game_service)
        if not peer:
            delegations.append({"target": target_token, "ok": False, "error": "target_not_found"})
            continue
        peer_prof = str(getattr(peer, "profile", "") or "default")
        peer_sid = game_service.ensure_hermes_session_for_agent(peer.id)
        peer_turn = _sync_session_turn(
            peer_sid,
            _compose_peer_handoff(peer_hint, primary_reply, submsg),
            game_service=game_service,
            bungalow_agent_id=peer.id,
        )
        delegations.append(
            {
                "target": target_token,
                "profile": peer_prof,
                "ok": peer_turn.get("ok"),
                "reply": peer_turn.get("reply"),
                "error": peer_turn.get("error"),
            }
        )
    return {"ok": bool(prim.get("ok")), "primary": prim, "delegations": delegations}


# ── 跨 Agent 聊天（从 server.py 迁移） ──────────────────────────────────

async def post_agent_relay_chat(request: Request) -> JSONResponse:
    """Run one LLM turn as another game agent (by id, profile, or display name)."""
    from api.game.service import GameService as GS

    body = json.loads(await request.body())
    token = str(body.get("to_agent_id") or body.get("target") or "").strip()
    message = str(body.get("message") or "").strip()
    if not token or not message:
        return JSONResponse({"ok": False, "error": "to_agent_id_and_message_required"}, status_code=400)

    game = GS()
    agent = _resolve_game_agent_token(token, game)
    if not agent:
        return JSONResponse({"ok": False, "error": "target_agent_not_found", "token": token}, status_code=404)

    loop = asyncio.get_event_loop()
    try:
        sid = game.ensure_hermes_session_for_agent(agent.id)
        result = await loop.run_in_executor(
            None,
            partial(
                _sync_session_turn,
                sid,
                message,
                game_service=game,
                bungalow_agent_id=agent.id,
            ),
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": "relay_failed", "detail": str(e)}, status_code=500)
    return JSONResponse(result)


async def post_agent_chat_orchestrated(request: Request) -> JSONResponse:
    """One request: peer hint → primary Hermes turn → parse @ handoffs → peer relay turns."""
    from api.game.service import GameService as GS

    body = json.loads(await request.body())
    agent_id = str(body.get("agent_id") or "").strip()
    message = str(body.get("message") or "").strip()
    auto_peer = bool(body.get("auto_peer", True))
    if not agent_id or not message:
        return JSONResponse({"ok": False, "error": "agent_id_and_message_required"}, status_code=400)

    game = GS()
    primary = _resolve_game_agent_token(agent_id, game)
    if not primary:
        return JSONResponse({"ok": False, "error": "agent_not_found"}, status_code=404)

    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            None,
            partial(
                _orchestrated_peer_turns_sync,
                primary,
                message,
                auto_peer,
                game_service=game,
            ),
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": "orchestrate_failed", "detail": str(e)}, status_code=500)
    return JSONResponse(result)


# ── 健康检查 + SSE 回推（新增协议端点） ─────────────────────────────────

async def get_agent_health(_: Request) -> JSONResponse:
    return JSONResponse({
        "status": "alive",
        "last_seen": int(time.time()),
    })


# ── 路由注册 ─────────────────────────────────────────────────────────────

agent_routes: list[Route] = [
    Route("/api/agent/health", get_agent_health, methods=["GET"]),
    Route("/api/agent/relay-chat", post_agent_relay_chat, methods=["POST"]),
    Route("/api/agent/chat-orchestrated", post_agent_chat_orchestrated, methods=["POST"]),
]

agent_app = Starlette(debug=False, routes=agent_routes)


def main() -> None:
    host = os.getenv("AGENT_HOST", "127.0.0.1")
    port = int(os.getenv("AGENT_PORT", "8001"))
    uvicorn.run(agent_app, host=host, port=port)


if __name__ == "__main__":
    main()
