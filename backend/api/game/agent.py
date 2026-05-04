"""
马斯特 Agent 推理引擎（从 server.py 拆分）

同一进程内纯模块——server.py 导入并直接调用。
不含 HTTP handler，所有 handler 留在 server.py。

导出函数：
- resolve_game_agent_token(token, game_service)
- sync_session_turn(session_id, message, game_service, *, bungalow_agent_id)
- orchestrated_peer_turns_sync(primary_agent, user_message, auto_peer, game_service)
- run_recursive_peer_invokes(...)
- build_peer_hint_lines(agents)
"""
from __future__ import annotations

import queue
import threading
import uuid
from pathlib import Path
from typing import Any

from api.game.handoff_parser import (
    expand_broadcast_invokes_for_sender as expand_broadcast_invokes,
    parse_hermes_bungalow_invokes,
    strip_handoff_lines as strip_bungalow_invokes,
)

try:
    from api.streaming import STREAMS, STREAMS_LOCK, _run_agent_streaming
except ImportError:
    STREAMS = {}
    STREAMS_LOCK = threading.RLock()

HANDOFF_CONTEXT_MAX = 28000
MAX_INVOKE_DEPTH = 8


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
    attachments: list[str] | None = None,
) -> dict[str, Any]:
    """Run one Hermes turn on an existing session (keeps conversation history)."""
    from api.config import _get_session_agent_lock, get_config
    from api.game.service import bungalow_session_tls_for_agent_id
    from api.models import get_session

    with bungalow_session_tls_for_agent_id(game_service, bungalow_agent_id):
        s = get_session(session_id)
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
            args=(s.session_id, message, model, workspace, stream_id, attachments),
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


def _agent_self_invoke_tokens(agent: Any) -> set[str]:
    prof = str(getattr(agent, "profile", "") or "default")
    toks = {str(getattr(agent, "id", "")), prof, str(getattr(agent, "name", "") or "").strip()}
    dn = str(getattr(agent, "display_name", "") or "").strip()
    if dn:
        toks.add(dn)
    return {x for x in toks if x}


def run_recursive_peer_invokes(
    game_service: Any,
    invoker_agent: Any,
    invoke_rows: list[tuple[str, str]],
    depth: int,
    invoker_full_reply: str,
    peer_hint: str,
    agents: list[Any],
) -> list[dict[str, Any]]:
    if depth > MAX_INVOKE_DEPTH:
        return []
    expanded = expand_broadcast_invokes(invoker_agent, agents, invoke_rows)
    out: list[dict[str, Any]] = []
    self_t = _agent_self_invoke_tokens(invoker_agent)
    for target_token, submsg in expanded:
        tt = str(target_token).strip()
        if tt in self_t:
            out.append({"target": tt, "ok": False, "error": "self_invoke_skipped", "nested": []})
            continue
        peer = resolve_game_agent_token(tt, game_service)
        if not peer:
            out.append({"target": tt, "ok": False, "error": "target_not_found", "nested": []})
            continue
        peer_prof = str(getattr(peer, "profile", "") or "default")
        peer_sid = game_service.ensure_hermes_session_for_agent(peer.id)
        peer_turn = sync_session_turn(
            peer_sid,
            compose_peer_handoff(peer_hint, invoker_full_reply, submsg),
            game_service,
            bungalow_agent_id=peer.id,
        )
        nested_text = str(peer_turn.get("reply") or "")
        nested_invokes = parse_hermes_bungalow_invokes(nested_text)
        nested_list: list[dict[str, Any]] = []
        if nested_invokes:
            nested_list = run_recursive_peer_invokes(
                game_service, peer, nested_invokes, depth + 1, nested_text, peer_hint, agents
            )
        out.append(
            {
                "target": tt,
                "profile": peer_prof,
                "ok": peer_turn.get("ok"),
                "reply": peer_turn.get("reply"),
                "error": peer_turn.get("error"),
                "nested": nested_list,
            }
        )
    return out


def orchestrated_peer_turns_sync(
    primary_agent: Any,
    user_message: str,
    auto_peer: bool,
    game_service: Any,
    *,
    primary_attachments: list[str] | None = None,
) -> dict[str, Any]:
    """Primary turn (+ auto peer hint), parse @ handoffs, run peer relay turns (recursive)."""
    with game_service._lock:
        agents = list(game_service.world.agents)
    peer_hint = build_peer_hint_lines(agents) if auto_peer and len(agents) > 1 else ""
    full_message = peer_hint + user_message
    sid0 = game_service.ensure_hermes_session_for_agent(primary_agent.id)
    prim = sync_session_turn(
        sid0,
        full_message,
        game_service,
        bungalow_agent_id=primary_agent.id,
        attachments=primary_attachments,
    )
    primary_reply = str(prim.get("reply") or "")
    invokes = parse_hermes_bungalow_invokes(primary_reply)
    delegations = run_recursive_peer_invokes(
        game_service, primary_agent, invokes, 0, primary_reply, peer_hint, agents
    )
    return {"ok": bool(prim.get("ok")), "primary": prim, "delegations": delegations}
