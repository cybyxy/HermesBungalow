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
- maybe_append_peer_reply_queue_to_invoker_session(game_service, invoker, delegations)
"""
from __future__ import annotations

import json
import queue
import threading
import time
import uuid
from collections.abc import Callable
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


def _match_agent_token(t: str, tl: str, agents: list[Any]):
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


def resolve_world_agent_token(token: str, game_service: Any):
    """Resolve persisted world agents for ``agent-relay-from-peer``.

    **Id** 始终唯一命中。按 **profile / name / display_name** 匹配时，若有多名 Agent 同值则返回
    ``None``，避免 ``relay_agent_id="default"`` 等歧义误转发（Hermes 常见多 Agent 共 profile ``default``）。
    """
    t = token.strip()
    if not t:
        return None
    tl = t.lower()
    with game_service._lock:
        agents = list(game_service.world.agents)
    for a in agents:
        if a.id == t:
            return a
    prof_hits = [
        a
        for a in agents
        if (str(getattr(a, "profile", "") or "").strip() and str(getattr(a, "profile", "")).strip().lower() == tl)
    ]
    if len(prof_hits) == 1:
        return prof_hits[0]
    if len(prof_hits) > 1:
        return None
    nm_hits = [
        a
        for a in agents
        if (str(getattr(a, "name", "") or "").strip() and str(getattr(a, "name", "")).strip().lower() == tl)
    ]
    if len(nm_hits) == 1:
        return nm_hits[0]
    if len(nm_hits) > 1:
        return None
    dn_hits = [
        a
        for a in agents
        if (str(getattr(a, "display_name", "") or "").strip() and str(getattr(a, "display_name", "")).strip().lower() == tl)
    ]
    if len(dn_hits) == 1:
        return dn_hits[0]
    return None


def _cross_instance_visitor_agents(agents: list[Any]) -> list[Any]:
    """Rows with ``peer_relay_base_url`` + ``peer_relay_agent_id`` (串门访客 / 远端代跑)."""
    out: list[Any] = []
    for a in agents:
        if str(getattr(a, "peer_relay_base_url", "") or "").strip() and str(
            getattr(a, "peer_relay_agent_id", "") or ""
        ).strip():
            out.append(a)
    return out


def _is_peer_visitor_alias_token(t: str, tl: str) -> bool:
    """用户常发 ``@访客|…``，与 visitor 的 profile/id 不一定一致。"""
    s = (t or "").strip()
    if s in ("访客", "串门访客", "串門訪客"):
        return True
    if tl in ("visitor", "peer_visitor", "bungalow_visitor", "guest"):
        return True
    return False


def resolve_game_agent_token(token: str, game_service: Any):
    """Resolve an agent by id, profile, name, or display_name（ASCII 不区分大小写）; includes peer visitors."""
    t = token.strip()
    if not t:
        return None
    tl = t.lower()
    agents = list(game_service.iter_agents_for_token_resolve())
    hit = _match_agent_token(t, tl, agents)
    if hit:
        return hit
    if _is_peer_visitor_alias_token(t, tl):
        relay_rows = _cross_instance_visitor_agents(agents)
        if len(relay_rows) == 1:
            return relay_rows[0]
    return None


def sync_session_turn(
    session_id: str,
    message: str,
    game_service: Any,
    *,
    bungalow_agent_id: str | None = None,
    attachments: list[str] | None = None,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
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
        "勿向用户声称多 Agent 已禁用。"
        "各 Agent 的 Hermes 会话由数字工作室**后端**按人绑定，**勿**向用户索取 session_id、"
        "**勿**让用户代调浏览器独占的本地 WebUI 接口；同伴回合由服务器直接发起。"
        "若你在一轮里点名多名同伴且均产生回复，编排器会把各同伴正文**按顺序**写入你的 Hermes 会话（同伴回复队列），"
        "请逐条消化，勿当作同时到达合并处理。"
        "同伴："
        + list_str
        + "。无需转交时不要写以 `@` 开头的该行。）\n\n"
    )


def maybe_append_peer_reply_queue_to_invoker_session(
    game_service: Any,
    invoker: Any,
    delegations: list[dict[str, Any]] | None,
) -> None:
    """当同一轮有 ≥2 条顶层同伴回复时，按序写入源 Agent 会话（单锁、一次 save），避免并发向源会话落多条用户消息。

    仅处理 ``run_recursive_peer_invokes`` 返回的**顶层** ``delegations``；嵌套委派由同伴各自会话承担。
    """
    if not delegations:
        return
    invoker_id = getattr(invoker, "id", None)
    if not invoker_id:
        return

    rows: list[tuple[str, str]] = []
    for d in delegations:
        if not isinstance(d, dict):
            continue
        if not d.get("ok"):
            continue
        rep = str(d.get("reply") or "").strip()
        if not rep:
            continue
        tok = str(d.get("target") or "").strip()
        peer = resolve_game_agent_token(tok, game_service)
        label = (str(getattr(peer, "name", None) or "").strip() or tok) if peer else tok
        rows.append((label, rep))
    if len(rows) < 2:
        return

    from api.config import _get_session_agent_lock
    from api.game.service import bungalow_session_tls_for_agent_id
    from api.models import get_session

    sid = game_service.ensure_hermes_session_for_agent(str(invoker_id))
    n = len(rows)
    with bungalow_session_tls_for_agent_id(game_service, str(invoker_id)):
        with _get_session_agent_lock(sid):
            s = get_session(sid)
            for i, (label, rep) in enumerate(rows, start=1):
                body = (
                    f"【同伴回复队列 {i}/{n} · {label}】\n\n"
                    f"{rep}\n\n"
                    f"（本条由工作室编排器按序写入，共 {n} 条；请逐条消化后再处理下一条，勿将多条当作同时到达合并处理。）"
                )
                s.messages.append(
                    {
                        "role": "user",
                        "content": body,
                        "timestamp": int(time.time()),
                    }
                )
            s.save()


# 同伴 relay 专用：减轻模型误以为要用户中转带 session_id 调本地 API（全后端编排后常见误答）。
_BUNGALOW_PEER_DELEGATION_PREFIX = (
    "【同伴回合·后端已注入 Hermes 会话】本条由 Hermes 数字工作室服务器代你发起，"
    "当前对话已绑定你的游戏 Agent 会话；**不要**向用户索取 session_id，"
    "**不要**让用户替你调用本地 WebUI 的 `/api/chat/start` 等接口，直接处理下方任务即可。\n\n"
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
    pre = _BUNGALOW_PEER_DELEGATION_PREFIX
    if not stripped:
        return pre + peer_hint + body
    ctx = (
        "\n\n──────── 同伴本轮对用户输出的正文（@ 转交行已剥离）────────\n"
        f"{truncate_handoff_context(stripped)}\n\n"
        "──────── 对方点名要你处理的任务 ────────\n"
        f"{body}"
    )
    return pre + peer_hint + ctx


def _agent_self_invoke_tokens(agent: Any) -> set[str]:
    prof = str(getattr(agent, "profile", "") or "default")
    toks = {str(getattr(agent, "id", "")), prof, str(getattr(agent, "name", "") or "").strip()}
    dn = str(getattr(agent, "display_name", "") or "").strip()
    if dn:
        toks.add(dn)
    return {x for x in toks if x}


def _args_summary_for_replay(args_obj: Any) -> str:
    if not isinstance(args_obj, dict) or not args_obj:
        return ""
    try:
        s = json.dumps(args_obj, ensure_ascii=False)
    except (TypeError, ValueError):
        s = str(args_obj)
    return s[:800]


def _replay_trace_rows_to_event_sink(
    event_sink: Callable[[dict[str, Any]], None],
    *,
    run_id: str,
    agent_id: str | None,
    trace: list[dict[str, Any]],
    final_reply: str,
) -> None:
    """Replay a finished turn's ``trace`` as orchestration SSE events (cross-peer has no live stream)."""
    if not event_sink or not run_id or not agent_id:
        return
    rows_in = [x for x in (trace or []) if isinstance(x, dict)]
    fr = (final_reply or "").strip()
    rows = rows_in
    if not rows and fr:
        rows = [
            {
                "type": "reasoning",
                "text": (
                    "（对端未上报分步推理 trace；以下为模型完整回复，便于在访客侧查看本轮输出。）\n\n" + fr
                ),
            }
        ]
        final_reply = ""
    step_id = uuid.uuid4().hex
    event_sink(
        {
            "type": "step_begin",
            "run_id": run_id,
            "step_id": step_id,
            "agent_id": agent_id,
            "stream_id": "",
        }
    )
    for row in rows:
        if not isinstance(row, dict):
            continue
        rt = row.get("type")
        if rt == "reasoning":
            t = str(row.get("text") or "")
            if t.strip():
                event_sink(
                    {
                        "type": "reasoning_delta",
                        "run_id": run_id,
                        "step_id": step_id,
                        "agent_id": agent_id,
                        "text": t,
                    }
                )
        elif rt == "tool":
            event_sink(
                {
                    "type": "tool_start",
                    "run_id": run_id,
                    "step_id": step_id,
                    "agent_id": agent_id,
                    "name": str(row.get("name") or "工具"),
                    "args_summary": _args_summary_for_replay(row.get("args")),
                }
            )
        elif rt == "tool_complete":
            ok = not bool(row.get("is_error"))
            prev = str(row.get("preview") or "").strip()
            dur = row.get("duration")
            bits = [x for x in (prev, f"耗时: {dur}" if dur is not None else "") if x]
            event_sink(
                {
                    "type": "tool_end",
                    "run_id": run_id,
                    "step_id": step_id,
                    "agent_id": agent_id,
                    "name": str(row.get("name") or "工具"),
                    "ok": ok,
                    "result_summary": "\n".join(bits) if bits else ("完成" if ok else "失败"),
                    "error": None if ok else (prev or "失败"),
                }
            )
    fr = (final_reply or "").strip()
    if fr:
        event_sink(
            {
                "type": "assistant_message",
                "run_id": run_id,
                "step_id": step_id,
                "agent_id": agent_id,
                "markdown": fr,
            }
        )
    event_sink({"type": "step_done", "run_id": run_id, "step_id": step_id, "agent_id": agent_id})


def run_recursive_peer_invokes(
    game_service: Any,
    invoker_agent: Any,
    invoke_rows: list[tuple[str, str]],
    depth: int,
    invoker_full_reply: str,
    peer_hint: str,
    agents: list[Any],
    *,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
) -> list[dict[str, Any]]:
    from api.game.peers import cross_peer_agent_relay_sync

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
        relay_b = str(getattr(peer, "peer_relay_base_url", "") or "").strip()
        relay_id = str(getattr(peer, "peer_relay_agent_id", "") or "").strip()
        if event_sink and run_id:
            event_sink(
                {
                    "type": "delegation_start",
                    "run_id": run_id,
                    "from_agent_id": getattr(invoker_agent, "id", None),
                    "to_agent_id": getattr(peer, "id", None),
                    "reason": tt,
                }
            )
        handoff_body = compose_peer_handoff(peer_hint, invoker_full_reply, submsg)
        if relay_b and relay_id:
            try:
                peer_turn = cross_peer_agent_relay_sync(
                    relay_b, relay_id, handoff_body, allow=game_service.allowed_peer_bases()
                )
            except Exception as ex:
                peer_turn = {
                    "ok": False,
                    "reply": "",
                    "error": str(ex),
                    "trace": [],
                    "profile": peer_prof,
                }
            if event_sink and run_id:
                pid = getattr(peer, "id", None)
                if not peer_turn.get("ok") and peer_turn.get("error"):
                    event_sink(
                        {
                            "type": "error",
                            "run_id": run_id,
                            "agent_id": pid,
                            "message": str(peer_turn.get("error") or "relay_failed"),
                            "fatal": False,
                        }
                    )
                _replay_trace_rows_to_event_sink(
                    event_sink,
                    run_id=run_id,
                    agent_id=pid,
                    trace=list(peer_turn.get("trace") or []),
                    final_reply=str(peer_turn.get("reply") or ""),
                )
        else:
            peer_sid = game_service.ensure_hermes_session_for_agent(peer.id)
            peer_turn = sync_session_turn(
                peer_sid,
                handoff_body,
                game_service,
                bungalow_agent_id=peer.id,
                event_sink=event_sink,
                run_id=run_id,
            )
        nested_text = str(peer_turn.get("reply") or "")
        nested_invokes = parse_hermes_bungalow_invokes(nested_text)
        nested_list: list[dict[str, Any]] = []
        if nested_invokes:
            nested_list = run_recursive_peer_invokes(
                game_service,
                peer,
                nested_invokes,
                depth + 1,
                nested_text,
                peer_hint,
                agents,
                event_sink=event_sink,
                run_id=run_id,
            )
        out.append(
            {
                "target": tt,
                "profile": peer_prof,
                "ok": peer_turn.get("ok"),
                "reply": peer_turn.get("reply"),
                "error": peer_turn.get("error"),
                "trace": peer_turn.get("trace") or [],
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
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
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
        event_sink=event_sink,
        run_id=run_id,
    )
    primary_reply = str(prim.get("reply") or "")
    invokes = parse_hermes_bungalow_invokes(primary_reply)
    delegations = run_recursive_peer_invokes(
        game_service,
        primary_agent,
        invokes,
        0,
        primary_reply,
        peer_hint,
        agents,
        event_sink=event_sink,
        run_id=run_id,
    )
    maybe_append_peer_reply_queue_to_invoker_session(game_service, primary_agent, delegations)
    return {"ok": bool(prim.get("ok")), "primary": prim, "delegations": delegations}
