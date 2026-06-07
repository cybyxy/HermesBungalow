"""Multi-round orchestrated collaboration — auto receipt injection + synthesis turns."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any


def _collect_artifact_from_text(text: str, expected_kind: str | None) -> dict[str, Any] | None:
    """从 LLM 回复中提取 artifact_create 事件。"""
    from api.task.events import extract_game_event_tags

    for ev in extract_game_event_tags(text):
        if not isinstance(ev, dict):
            continue
        if ev.get("type") == "artifact_create":
            if expected_kind is None or ev.get("kind") == expected_kind:
                return ev
    return None


def multi_round_orchestrated_collaboration(
    primary_agent: Any,
    user_message: str,
    task_service: Any,
    *,
    max_rounds: int = 3,
    require_artifact_type: str | None = None,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
    user_continuation: str | None = None,
) -> dict[str, Any]:
    """多轮协作：自动回执注入 + synthesis turn，直到收敛或达上限。

    终止条件（满足任一）：
    1. 达到 max_rounds
    2. 检测到 artifact_create 事件（kind 匹配 require_artifact_type）
    3. 本轮未产生新 @handoff（协作收敛）
    4. orchestrated_peer_turns_sync 报告了终止原因（如 natural / max_back_depth）

    当 ``user_continuation`` 提供时，用用户消息替代硬编码续写提示，
    支持自然的多轮对话。
    """
    from api.task.orchestration import orchestrated_peer_turns_sync

    # 自然续写提示（当用户未提供 continuation 时使用）
    _DEFAULT_CONTINUATION = (
        "请根据上述回执综合你的结论。如讨论已充分，直接给出最终答案。"
        "如尚未完成，继续委派给合适的同伴。"
    )

    rounds: list[dict[str, Any]] = []
    final_artifact: dict[str, Any] | None = None

    with task_service._lock:
        agent_count = len(list(task_service.world.agents))

    for rnd in range(1, max_rounds + 1):
        inject = rnd < max_rounds  # 最后一轮不需要注入回执

        if event_sink and run_id:
            event_sink({"type": "synthesis_begin", "run_id": run_id, "round": rnd, "max_rounds": max_rounds})

        result = orchestrated_peer_turns_sync(
            primary_agent,
            user_message,
            auto_peer=agent_count > 1,
            task_service=task_service,
            event_sink=event_sink,
            run_id=run_id,
            inject_receipt=inject,
        )

        rounds.append(result)

        # 检查产出物
        primary_reply = ""
        prim = result.get("primary")
        if isinstance(prim, dict):
            primary_reply = str(prim.get("reply") or "")
        artifact = _collect_artifact_from_text(primary_reply, require_artifact_type)
        if artifact:
            final_artifact = artifact
            if event_sink and run_id:
                event_sink({"type": "artifact_produced", "run_id": run_id, "artifact": artifact})
            break

        # 检查是否收敛（无新 handoff 或 inner termination）
        delegations = result.get("delegations")
        if not isinstance(delegations, list) or len(delegations) == 0:
            break

        # inner termination（来自双向 @mention 的终止信号）
        term_reason = result.get("termination_reason")
        if term_reason and term_reason != "max_back_depth":
            break

        # 下一轮消息：优先用户续写，否则默认续写提示
        if user_continuation is not None and rnd == 1:
            user_message = user_continuation
            user_continuation = None  # 仅使用一次
        else:
            user_message = _DEFAULT_CONTINUATION

    return {
        "ok": True,
        "rounds": rounds,
        "round_count": len(rounds),
        "artifact": final_artifact,
    }
