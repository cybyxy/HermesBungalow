"""Agent peer dispatch — parse @handoffs, forward to target agents, inject receipts.

The communication protocol (@agent | message format) is defined in the
``agent-peer-messaging`` skill loaded by each profile — this module only
provides the relay plumbing.

Public API:
- resolve_game_agent_token(token, task_service)
- sync_session_turn(...)                                    ← re-export
- orchestrated_peer_turns_sync(primary_agent, user_message, ...)
- dispatch_peer_invokes(...)                                 ← flat loop, simple depth guard
- build_peer_hint_lines                                     ← DEPRECATED (no-op, kept for compat)
- run_recursive_peer_invokes                                 ← DEPRECATED (→ dispatch_peer_invokes)
- main_agent_orchestrated_turn                              ← re-export (simplified)
- multi_round_orchestrated_collaboration                    ← re-export
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

from api.task.handoff_parser import (
    expand_broadcast_invokes_for_sender as expand_broadcast_invokes,
    parse_hermes_bungalow_invokes,
    strip_handoff_lines as strip_bungalow_invokes,
)
from api.task.receipt import (
    _build_delegation_receipt,
    _inject_bidirectional_receipt,
    _inject_session_message,
)
from api.task.session_turn import sync_session_turn

# ── Re-exports ──────────────────────────────────────────────────────
from api.task.main_agent_entry import main_agent_orchestrated_turn  # noqa: F401
from api.task.multi_round import multi_round_orchestrated_collaboration  # noqa: F401

__all__ = [
    "resolve_game_agent_token",
    "sync_session_turn",
    "orchestrated_peer_turns_sync",
    "build_peer_hint_lines",
    "dispatch_peer_invokes",
    "run_recursive_peer_invokes",
    "multi_round_orchestrated_collaboration",
    "main_agent_orchestrated_turn",
]

# ── Constants ───────────────────────────────────────────────────────

MAX_DISPATCH_DEPTH = 5  # safety cap: max agent-to-agent hops

_HANDOFF_PREFIX = (
    "【同伴委派】本条由 Hermes 数字工作室服务器代你发起，"
    "当前对话已绑定你的 Agent 会话。直接处理下方任务，"
    "**不要**向用户索取 session_id 或让用户代调接口。\n\n"
)


# ── Agent resolution ────────────────────────────────────────────────

def resolve_game_agent_token(token: str, task_service: Any):
    """Resolve an agent by id, profile, name, or display_name (case-insensitive)."""
    t = token.strip()
    if not t:
        return None
    tl = t.lower()
    with task_service._lock:
        agents = list(task_service.world.agents)
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


# ── Deprecated compat shims ─────────────────────────────────────────

def build_peer_hint_lines(agents: list[Any]) -> str:
    """DEPRECATED — protocol now lives in ``agent-peer-messaging`` skill.
    Returns empty string; caller should load the skill instead."""
    return ""


def run_recursive_peer_invokes(
    task_service: Any,
    invoker_agent: Any,
    invoke_rows: list[tuple[str, str]],
    depth: int,
    invoker_full_reply: str,
    peer_hint: str,
    agents: list[Any],
    **kwargs: Any,
) -> list[dict[str, Any]]:
    """DEPRECATED — use ``dispatch_peer_invokes`` instead.
    Kept for backward compatibility, delegates to the new function."""
    return dispatch_peer_invokes(
        task_service,
        invoker_agent,
        invoke_rows,
        depth,
        invoker_full_reply,
        agents,
        **{k: v for k, v in kwargs.items()
           if k in ("event_sink", "run_id", "invoker_session_id",
                      "back_depth", "original_invoker_agent",
                      "_seen_handoffs", "_termination")},
    )


# ── Handoff message builder ─────────────────────────────────────────

def _format_handoff(invoker_agent: Any, invoker_full_reply: str, submsg: str) -> str:
    """Build the handoff message forwarded to a peer agent's session."""
    body = (submsg or "").strip()
    stripped = strip_bungalow_invokes(invoker_full_reply)
    invoker_name = (
        getattr(invoker_agent, "display_name", "") or
        getattr(invoker_agent, "name", "") or "同伴"
    )
    parts = [_HANDOFF_PREFIX]
    if stripped:
        parts.append(
            f"──────── {invoker_name} 本轮对用户的输出 ────────\n"
            f"{stripped[:20000]}\n"
        )
    parts.append(f"──────── {invoker_name} 点名要你处理的任务 ────────\n{body}")
    return "\n".join(parts)


# ── Peer dispatch (flat loop, simple depth guard) ───────────────────

def dispatch_peer_invokes(
    task_service: Any,
    invoker_agent: Any,
    invoke_rows: list[tuple[str, str]],
    depth: int,
    invoker_full_reply: str,
    agents: list[Any],
    *,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
    invoker_session_id: str | None = None,
    **__: Any,
) -> list[dict[str, Any]]:
    """Parse @agent | message lines and forward each to the target agent.

    If a peer's reply also contains @ lines, recurse (simple depth guard).
    No peer_hint injection, no @back complexity, no convergence detection —
    those are the skill's responsibility.
    """
    if depth > MAX_DISPATCH_DEPTH:
        return []

    expanded = expand_broadcast_invokes(invoker_agent, agents, invoke_rows)
    if not expanded:
        return []

    out: list[dict[str, Any]] = []
    invoker_id = str(getattr(invoker_agent, "id", ""))

    for target_token, submsg in expanded:
        tt = str(target_token).strip()

        peer = resolve_game_agent_token(tt, task_service)
        if not peer:
            out.append({"target": tt, "ok": False, "error": "target_not_found", "nested": []})
            continue
        # Skip self-target
        if str(getattr(peer, "id", "")) == invoker_id:
            out.append({"target": tt, "ok": False, "error": "self_target_skipped", "nested": []})
            continue

        peer_prof = str(getattr(peer, "profile", "") or "default")
        peer_sid = task_service.ensure_hermes_session_for_agent(peer.id)

        if event_sink and run_id:
            event_sink({
                "type": "delegation_start",
                "run_id": run_id,
                "from_agent_id": invoker_id,
                "to_agent_id": peer.id,
                "reason": tt,
            })

        handoff_msg = _format_handoff(invoker_agent, invoker_full_reply, submsg)
        peer_turn = sync_session_turn(
            peer_sid,
            handoff_msg,
            task_service,
            bungalow_agent_id=peer.id,
            event_sink=event_sink,
            run_id=run_id,
        )

        peer_reply = str(peer_turn.get("reply") or "")
        nested_invokes = parse_hermes_bungalow_invokes(peer_reply)
        nested_list: list[dict[str, Any]] = []
        if nested_invokes:
            nested_list = dispatch_peer_invokes(
                task_service,
                peer,
                nested_invokes,
                depth + 1,
                peer_reply,
                agents,
                event_sink=event_sink,
                run_id=run_id,
                invoker_session_id=invoker_session_id,
            )

        out.append({
            "target": tt,
            "agent_id": getattr(peer, "id", ""),
            "profile": peer_prof,
            "ok": peer_turn.get("ok"),
            "reply": peer_reply,
            "error": peer_turn.get("error"),
            "trace": peer_turn.get("trace") or [],
            "nested": nested_list,
        })

    return out


# ── Main entry point ────────────────────────────────────────────────

def orchestrated_peer_turns_sync(
    primary_agent: Any,
    user_message: str,
    auto_peer: bool,
    task_service: Any,
    *,
    primary_attachments: list[str] | None = None,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
    inject_receipt: bool = False,
) -> dict[str, Any]:
    """Run primary agent turn, parse @handoffs, dispatch to peers, inject receipts.

    No peer_hint is injected — the ``agent-peer-messaging`` skill loaded by
    each profile teaches the agent when and how to use @handoffs.
    """
    with task_service._lock:
        agents = list(task_service.world.agents)

    sid0 = task_service.ensure_hermes_session_for_agent(primary_agent.id)
    prim = sync_session_turn(
        sid0,
        user_message,
        task_service,
        bungalow_agent_id=primary_agent.id,
        attachments=primary_attachments,
        event_sink=event_sink,
        run_id=run_id,
    )
    primary_reply = str(prim.get("reply") or "")
    invokes = parse_hermes_bungalow_invokes(primary_reply)

    delegations = dispatch_peer_invokes(
        task_service,
        primary_agent,
        invokes,
        0,
        primary_reply,
        agents,
        event_sink=event_sink,
        run_id=run_id,
        invoker_session_id=sid0,
    )

    if not prim.get("ok"):
        termination = "primary_agent_error"
    elif delegations:
        termination = None  # 有待处理委派，会话继续
    else:
        termination = "completed"  # 无委派，本轮自然结束

    result = {
        "ok": bool(prim.get("ok")),
        "primary": prim,
        "delegations": delegations,
        "termination_reason": termination,
    }

    if inject_receipt and delegations:
        receipt = _build_delegation_receipt(primary_agent, invokes, delegations)
        if receipt:
            _inject_session_message(sid0, "user", receipt, task_service, primary_agent.id)
        _inject_bidirectional_receipt(primary_agent, invokes, delegations, task_service)

    return result
