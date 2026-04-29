#!/usr/bin/env python3
import json
import logging
import os
import sys
import traceback
import warnings
from typing import Any, Dict

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.CRITICAL)

# Hermes agent source tree (installed locally by Hermes CLI)
HERMES_AGENT_ROOT = os.path.expanduser("~/.hermes/hermes-agent")
if HERMES_AGENT_ROOT not in sys.path:
    sys.path.insert(0, HERMES_AGENT_ROOT)

from run_agent import AIAgent  # type: ignore  # noqa: E402


def _emit(event: Dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(event, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _extract_reply(messages: list[dict]) -> str:
    def _content_to_text(content: Any) -> str:
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: list[str] = []
            for item in content:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    # Common shapes: {"type":"text","text":"..."} or {"content":"..."}
                    txt = item.get("text") or item.get("content") or ""
                    if isinstance(txt, str) and txt.strip():
                        parts.append(txt)
            return "".join(parts).strip()
        if isinstance(content, dict):
            txt = content.get("text") or content.get("content") or ""
            return txt if isinstance(txt, str) else ""
        return ""

    for msg in reversed(messages or []):
        if isinstance(msg, dict) and msg.get("role") == "assistant":
            text = _content_to_text(msg.get("content", ""))
            if text:
                return text
    return ""


def main() -> None:
    sessions: dict[str, dict[str, Any]] = {}

    for raw in sys.stdin:
        raw = (raw or "").strip()
        if not raw:
            continue
        try:
            req = json.loads(raw)
        except Exception:
            continue

        if req.get("op") != "chat":
            continue

        req_id = str(req.get("request_id", ""))
        session_id = str(req.get("session_id", "")).strip() or "default"
        message = str(req.get("message", ""))
        max_turns = int(req.get("max_turns", 1))
        need_tools = bool(req.get("need_tools", False))
        ignore_rules = bool(req.get("ignore_rules", False))
        model = str(req.get("model", "") or "").strip()
        provider = str(req.get("provider", "") or "").strip()

        try:
            holder = sessions.get(session_id)
            if holder is None:
                holder = {"agent": None, "messages": [], "model": "", "provider": ""}
                sessions[session_id] = holder

            def on_token(text: str) -> None:
                if text:
                    _emit({"request_id": req_id, "type": "token", "text": str(text)})

            def on_reasoning(text: str) -> None:
                if text:
                    _emit({"request_id": req_id, "type": "thinking", "text": str(text)})

            agent = holder.get("agent")
            current_model = str(holder.get("model", "") or "")
            current_provider = str(holder.get("provider", "") or "")
            if agent is None or current_model != model or current_provider != provider:
                # Worker 进程默认保持工具可用，避免链式会话在会话中途被“禁工具”卡住。
                enabled_toolsets = None
                agent = AIAgent(
                    session_id=session_id,
                    model=model or "",
                    provider=provider or None,
                    quiet_mode=True,
                    max_iterations=max(1, max_turns),
                    enabled_toolsets=enabled_toolsets,
                    skip_context_files=ignore_rules,
                    stream_delta_callback=on_token,
                    reasoning_callback=on_reasoning,
                    platform="cli",
                )
                holder["agent"] = agent
                holder["model"] = model
                holder["provider"] = provider
            else:
                agent.max_iterations = max(1, max_turns)
                agent.stream_delta_callback = on_token
                if hasattr(agent, "reasoning_callback"):
                    agent.reasoning_callback = on_reasoning
                if hasattr(agent, "_interrupted"):
                    agent._interrupted = False
                if hasattr(agent, "_interrupt_message"):
                    agent._interrupt_message = None

            result = agent.run_conversation(
                user_message=message,
                conversation_history=list(holder.get("messages") or []),
                task_id=session_id,
                persist_user_message=message,
            )
            messages = result.get("messages") or holder.get("messages") or []
            holder["messages"] = messages
            reply = _extract_reply(messages)
            if not reply:
                # 兼容 run_conversation 直接返回最终文本字段
                maybe_final = result.get("final_response") or result.get("response") or ""
                if isinstance(maybe_final, str):
                    reply = maybe_final.strip()
            _emit(
                {
                    "request_id": req_id,
                    "type": "done",
                    "session_id": session_id,
                    "reply": reply,
                }
            )
        except Exception as e:
            _emit(
                {
                    "request_id": req_id,
                    "type": "error",
                    "message": f"{type(e).__name__}: {e}",
                    "traceback": traceback.format_exc(limit=2),
                }
            )


if __name__ == "__main__":
    main()
