"""Main agent entry — simple single-turn dispatch.

The ``agent-peer-messaging`` skill handles orchestration logic
(task-chain context, team coordination, synthesis turns).
This module just runs the turn + forwards @handoffs.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import Any


def main_agent_orchestrated_turn(
    user_message: str,
    task_service: Any,
    *,
    event_sink: Callable[[dict[str, Any]], None] | None = None,
    run_id: str = "",
) -> dict[str, Any]:
    """Run a turn as the main agent (lord), forwarding any @handoffs to peers."""
    from api.task.orchestration import orchestrated_peer_turns_sync

    with task_service._lock:
        agents = list(task_service.world.agents)

    main_agent = next(
        (a for a in agents if str(getattr(a, "profile", "") or "").strip() in ("崽崽", "default")),
        None,
    )
    if not main_agent and agents:
        main_agent = agents[0]
    if not main_agent:
        return {"ok": False, "error": "no_agent_available"}

    return orchestrated_peer_turns_sync(
        main_agent,
        user_message,
        auto_peer=len(agents) > 1,
        task_service=task_service,
        event_sink=event_sink,
        run_id=run_id,
        inject_receipt=True,
    )
