from __future__ import annotations

import json
import re
from typing import Any

from .llm_events import extract_game_event_tags, normalize_workflow_steps

# 发给 LLM 的 JSON Schema（与 ``normalize_workflow_steps`` / 存档 ``workflow_steps`` 一致）
TASK_WORKFLOW_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "required": ["steps"],
    "additionalProperties": True,
    "properties": {
        "summary": {"type": "string", "description": "对整段流程的一句中文概述"},
        "steps": {
            "type": "array",
            "minItems": 1,
            "maxItems": 20,
            "items": {
                "type": "object",
                "required": ["id", "order", "title", "kind"],
                "additionalProperties": True,
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "order": {"type": "integer", "minimum": 1},
                    "title": {"type": "string", "minLength": 1},
                    "detail": {"type": "string"},
                    "kind": {
                        "type": "string",
                        "enum": ["analyze", "design", "implement", "test", "review", "deliver", "other"],
                    },
                    "estimated_minutes": {"type": "number", "minimum": 0},
                    "depends_on": {"type": "array", "items": {"type": "string"}},
                },
            },
        },
    },
}


def _schema_block() -> str:
    return json.dumps(TASK_WORKFLOW_RESPONSE_SCHEMA, ensure_ascii=False, indent=2)


def compose_task_workflow_generation_message(
    task: dict[str, Any],
    *,
    user_skill_excerpt: str | None,
    max_excerpt_chars: int = 12000,
) -> str:
    """用户 SKILL 可空；Schema 与输出约束由后端强制拼接。"""
    excerpt = (user_skill_excerpt or "").strip()
    if len(excerpt) > max_excerpt_chars:
        excerpt = excerpt[:max_excerpt_chars] + "\n…（已截断）"
    user_block = (
        "【用户自定义任务分析 / SKILL 摘录（可为空）】\n"
        + (excerpt if excerpt else "（未提供：请仅根据下列任务卡片与 Schema 规划流程。）")
    )
    task_json = json.dumps(task, ensure_ascii=False, indent=2)
    schema = _schema_block()
    tail = (
        "\n\n【后端固定约束 — 必须遵守】\n"
        "1. 下面 JSON Schema 描述了你**必须返回的唯一顶层 JSON 对象**的结构（字段名与类型一致）。\n"
        "2. 你的**最终回复正文**中，必须包含**一段可直接被程序解析的 JSON**：\n"
        "   - 优先：整段回复就是一个 JSON 对象（不要 Markdown 代码围栏）。\n"
        "   - 或：使用一行 `[[GAME_EVENT:{...}]]`，其中 JSON 的 type 为 task_workflow_plan 且含 steps。\n"
        "3. 若使用纯 JSON，则根对象须含 `steps` 数组；`summary` 可选。不要编造任务中不存在的约束。\n"
        "4. `steps` 中每步 `kind` 只能取 Schema 中 enum 所列值。\n"
        "\n【JSON Schema】\n"
        f"{schema}\n"
        "\n【当前任务（只读）】\n"
        f"{task_json}\n"
    )
    return user_block + tail


def _extract_first_json_object(s: str) -> str | None:
    start = s.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    esc = False
    quote: str | None = None
    for i in range(start, len(s)):
        c = s[i]
        if in_str and quote:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == quote:
                in_str = False
                quote = None
        else:
            if c in ('"', "'"):
                in_str = True
                quote = c
            elif c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return s[start : i + 1]
    return None


def _parse_json_loose(blob: str) -> dict[str, Any] | None:
    blob = blob.strip()
    if not blob:
        return None
    try:
        v = json.loads(blob)
        return v if isinstance(v, dict) else None
    except json.JSONDecodeError:
        return None


def parse_task_workflow_llm_reply(text: str, task_id: int) -> dict[str, Any] | None:
    """
    从模型回复中提取 ``task_workflow_plan`` 事件 dict（供 ``apply_parsed_events``）。
    支持：GAME_EVENT 块、markdown ```json 围栏、首个 JSON 对象。
    """
    if not text or not str(text).strip():
        return None
    # 1) GAME_EVENT（task_id 以当前任务为准，避免模型抄错 id）
    for ev in extract_game_event_tags(text):
        if not isinstance(ev, dict) or ev.get("type") != "task_workflow_plan":
            continue
        steps = normalize_workflow_steps(ev.get("steps"))
        if steps:
            return {"type": "task_workflow_plan", "task_id": task_id, "summary": str(ev.get("summary") or ""), "steps": steps}

    # 2) ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, re.IGNORECASE)
    if m:
        raw = _parse_json_loose(m.group(1))
        ev = _coerce_plan_from_root_json(raw, task_id)
        if ev:
            return ev

    # 3) first balanced JSON object in text
    blob = _extract_first_json_object(text)
    if blob:
        raw = _parse_json_loose(blob)
        ev = _coerce_plan_from_root_json(raw, task_id)
        if ev:
            return ev

    return None


def _coerce_plan_from_root_json(raw: dict[str, Any] | None, task_id: int) -> dict[str, Any] | None:
    if not raw:
        return None
    # 允许根级即 plan，或嵌套在 workflow / plan 下
    if raw.get("type") == "task_workflow_plan" and isinstance(raw.get("steps"), list):
        steps = normalize_workflow_steps(raw.get("steps"))
        if not steps:
            return None
        return {
            "type": "task_workflow_plan",
            "task_id": task_id,
            "summary": str(raw.get("summary") or ""),
            "steps": steps,
        }
    for key in ("workflow", "plan", "data"):
        inner = raw.get(key)
        if isinstance(inner, dict) and isinstance(inner.get("steps"), list):
            steps = normalize_workflow_steps(inner.get("steps"))
            if steps:
                return {
                    "type": "task_workflow_plan",
                    "task_id": task_id,
                    "summary": str(inner.get("summary") or raw.get("summary") or ""),
                    "steps": steps,
                }
    if isinstance(raw.get("steps"), list):
        steps = normalize_workflow_steps(raw.get("steps"))
        if not steps:
            return None
        return {
            "type": "task_workflow_plan",
            "task_id": task_id,
            "summary": str(raw.get("summary") or ""),
            "steps": steps,
        }
    return None
