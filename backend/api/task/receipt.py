"""Delegation receipt injection — compile peer replies and inject them into agent sessions."""
from __future__ import annotations

from typing import Any


def _flatten_delegation_replies(delegations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """递归展开 delegation 树，提取所有带 reply 的条目。"""
    out: list[dict[str, Any]] = []
    for d in delegations:
        reply = d.get("reply")
        if isinstance(reply, str) and reply.strip():
            out.append({"target": d.get("target", "?"), "profile": d.get("profile", ""), "reply": reply})
        nested = d.get("nested")
        if isinstance(nested, list):
            out.extend(_flatten_delegation_replies(nested))
    return out


def _build_delegation_receipt(
    invoker_agent: Any,
    invokes: list[tuple[str, str]],
    delegations: list[dict[str, Any]],
) -> str:
    """编译 peer 回执为结构化消息，注入到发起者 session。"""
    replies = _flatten_delegation_replies(delegations)
    if not replies:
        return ""

    invoker_name = getattr(invoker_agent, "display_name", "") or getattr(invoker_agent, "name", "")
    lines: list[str] = []
    lines.append(f"【委派回执 — {invoker_name} 请过目】")
    lines.append("以下是你委派出去的任务回复摘要：\n")
    for i, r in enumerate(replies, 1):
        target_display = r["profile"] or r["target"]
        lines.append(f"[{i}] 来自 {target_display}（@{r['target']}）的回复：")
        lines.append(r["reply"])
        lines.append("")
    lines.append("（请根据以上回执，决定下一步行动。如需进一步委派，继续使用 @agent | 消息 格式。如已完成，请产出最终结果。）")
    return "\n".join(lines)


def _inject_session_message(
    session_id: str,
    role: str,
    content: str,
    task_service: Any,
    bungalow_agent_id: str | None = None,
) -> None:
    """向 Hermes session 追加一条消息（不走流式引擎）。"""
    from api.task.service import bungalow_session_tls_for_agent_id
    from api.models import get_session

    with bungalow_session_tls_for_agent_id(task_service, bungalow_agent_id):
        s = get_session(session_id)
        msgs = getattr(s, "messages", None)
        if not isinstance(msgs, list):
            return
        msgs.append({"role": role, "content": content})
        # 截断：保留最近 60 条消息
        if len(msgs) > 60:
            s.messages = msgs[-60:]
        s.save()


def _inject_bidirectional_receipt(
    invoker_agent: Any,
    invokes: list[tuple[str, str]],
    delegations: list[dict[str, Any]],
    task_service: Any,
) -> None:
    """将协作摘要双向注入所有参与 agent 的 session，形成共享记忆。

    - invoker session: 收到所有 peer 回复的完整摘要（已有 _build_delegation_receipt）
    - peer sessions: 收到简短通知"你的回复已被审阅，协作继续"
    """
    invoker_name = getattr(invoker_agent, "display_name", "") or getattr(invoker_agent, "name", "") or "发起者"

    # 收集所有参与 peer 的 (agent_id, session_id, profile)
    participants: dict[str, dict[str, str]] = {}  # agent_id -> {profile, session_id}
    for d in delegations:
        agent_id = d.get("agent_id", "")
        if not agent_id:
            continue
        if agent_id in participants:
            continue
        participants[agent_id] = {
            "profile": d.get("profile", ""),
            "session_id": task_service.ensure_hermes_session_for_agent(agent_id),
        }

    for agent_id, info in participants.items():
        sid = info["session_id"]
        if not sid:
            continue
        agent_name = info["profile"] or agent_id
        summary = (
            f"【协作通知】{invoker_name} 审阅了你的回复。"
            f"本次协作已完成。"
            f"请在后续对话中记住本次协作的上下文。"
        )
        _inject_session_message(sid, "user", summary, task_service, agent_id)
