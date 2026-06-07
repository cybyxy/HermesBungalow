from __future__ import annotations

import json
import re
from typing import Any

from .events import extract_game_event_tags, normalize_workflow_steps

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
                    "assignee": {"type": "string", "description": "建议负责此步骤的角色/成员名称"},
                    "status": {"type": "string", "enum": ["pending", "in_progress", "completed"], "description": "初始状态，默认 pending"},
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
    agents: list[dict[str, str]] | None = None,
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
    # 可用成员列表
    agents_block = ""
    if agents:
        lines = ["\n【可用团队成员 — assignee 必须从以下列表中选择】"]
        for a in agents:
            name = a.get("name", "")
            prof = a.get("profession", "")
            pid = a.get("id", "")
            lines.append(f"  - {name}（{prof}）")
        lines.append("  * assignee 字段请填写成员姓名（如「马斯特」），不要填职业泛称")
        agents_block = "\n".join(lines)
    task_json = json.dumps(task, ensure_ascii=False, indent=2)
    schema = _schema_block()
    tail = (
        "\n\n【你的任务：将单个任务拆解为可执行的时间轴步骤】\n"
        "\n"
        "你要把上列「当前任务」拆成 **3-8 个连贯的操作步骤**，按时间顺序排列，\n"
        "每个步骤对应一段真实的执行阶段。不要只返回 1 步就结束。\n"
        "\n"
        "**拆解原则**\n"
        "- 每步有独立可验证的产出（交付物）\n"
        "- 步骤间有先后依赖关系，前一步的输出是下一步的输入\n"
        "- 时间预估要合理（单步 10-240 分钟），不要拍脑袋给 0\n"
        "- 每步必须指定 `assignee`（从上方可用团队成员列表中选择一位，必须填具体姓名）\n"
        "- 每步必须指定 `status`（初始统一为 \"pending\"）\n"
        "- `kind` 取值要反映步骤性质：\n"
        "  * analyze  = 需求分析 / 调研 / 查资料\n"
        "  * design   = 方案设计 / 架构 / 原型\n"
        "  * implement = 编码 / 实现 / 写文件\n"
        "  * test     = 测试 / 调试 / 验证\n"
        "  * review   = 代码审查 / 方案评审\n"
        "  * deliver  = 发布 / 部署 / 提交产物\n"
        "  * other    = 上述都不覆盖的杂项\n"
        "\n"
        "**输出规则**\n"
        "1. 最终回复中必须包含一段可被程序解析的 JSON（对象或 [[GAME_EVENT:task_workflow_plan]]）。\n"
        "2. 整个回复可以是纯 JSON 对象（不含 Markdown 代码围栏）。\n"
        "3. 根对象须含 `steps` 数组（含 `summary` 可选）。\n"
        "4. 不要编造任务卡片中不存在的字段或约束。\n"
        "\n"
        "【JSON Schema】\n"
        f"{schema}\n"
        "\n【当前任务（只读）】\n"
        f"{task_json}\n"
    )
    return user_block + agents_block + tail


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


# ── 项目创建 & 任务链上下文 ─────────────────────────────────────────


def compose_project_creation_message(user_description: str) -> str:
    """引导城主 agent 将用户自然语言项目请求分解为多任务项目。

    城主应输出 ``[[GAME_EVENT:{"type":"task_chain_create",...}]]`` 标签。
    """
    desc = (user_description or "").strip()
    return (
        "【系统指令 — 项目创建模式】\n"
        "用户提出了一个项目需求。你需要作为城主，分析这个需求，将其拆解为可执行的子任务链。\n\n"
        "请按以下步骤思考：\n"
        "1. 理解项目目标，确定顶层项目名称和描述\n"
        "2. 识别需要的角色（前端开发、后端开发、设计师、测试员、需求分析、架构师、文档师等）\n"
        "3. 拆解为子任务，每个子任务指定：名称、描述、所需职业、难度(1-5)、依赖关系\n"
        "4. 考虑任务间的依赖：例如「设计API」→「实现API」→「测试API」\n\n"
        "最终输出格式（必须在回复中包含以下标签）：\n"
        '[[GAME_EVENT:{"type":"task_chain_create","name":"项目名","description":"项目描述","sub_tasks":['
        '{"name":"子任务1","description":"...","required_profession":"需求分析","difficulty":2,"depends_on_indices":[]},'
        '{"name":"子任务2","description":"...","required_profession":"后端开发","difficulty":3,"depends_on_indices":[0]}'
        ']}]]\n\n'
        "注意：depends_on_indices 是数组，值为前面子任务在数组中的索引（从0开始），无依赖则为空数组。\n"
        "确保依赖关系不产生循环。\n\n"
        "【用户的项目需求】\n"
        f"{desc}\n"
    )


def compose_task_chain_context(agent: Any, tasks: list[Any]) -> str:
    """生成任务链上下文块，注入到每次 LLM 调用前。

    让所有 agent 感知全局任务状态和团队情况。
    """
    if not tasks:
        return "【当前任务链状态】\n（无任务）\n"

    lines: list[str] = []
    lines.append("【当前任务链状态】")
    lines.append("| ID | 任务名 | 状态 | 负责人 | 进度% | 依赖 |")
    lines.append("|---|--------|------|--------|-------|------|")

    for t in tasks:
        tid = getattr(t, "id", 0)
        name = getattr(t, "name", "")
        status = getattr(t, "status", "pending")
        assignee = getattr(t, "assignee_id", "") or "未分配"
        progress = getattr(t, "progress", 0.0)
        deps = getattr(t, "depends_on", None)
        dep_str = ""
        if isinstance(deps, list) and deps:
            dep_names: list[str] = []
            for d in deps:
                dt = next((x for x in tasks if getattr(x, "id", None) == d), None)
                dep_names.append(f"#{d} {getattr(dt, 'name', '?')}" if dt else f"#{d}")
            dep_str = ", ".join(dep_names)
        elif isinstance(deps, list) and not deps:
            dep_str = "无"
        status_cn = {"pending": "待接取", "locked": "锁定", "in_progress": "进行中", "completed": "已完成"}.get(status, status)
        lines.append(f"| {tid} | {name} | {status_cn} | {assignee} | {progress:.0f}% | {dep_str} |")

    lines.append("")
    lines.append("【状态说明】locked=前置任务未完成 | pending=可接取 | in_progress=执行中 | completed=已完成")
    return "\n".join(lines)


def compose_team_status_context(agents: list[Any]) -> str:
    """生成团队状态摘要，用于每次 LLM 调用的上下文注入。"""
    if not agents:
        return "【团队状态】\n（无成员）\n"

    lines: list[str] = []
    lines.append("【团队状态】")
    for a in agents:
        name = getattr(a, "display_name", "") or getattr(a, "name", "")
        prof = getattr(a, "profession", "")
        task_id = getattr(a, "current_task_id", None)

        task_info = f" 任务#{task_id}" if task_id else ""
        lines.append(f"- {name}（{prof}）{task_info}")
    return "\n".join(lines)
