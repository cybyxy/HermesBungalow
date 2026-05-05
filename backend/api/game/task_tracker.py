"""
解析 docs/task-tracker.md 生成台账时间线 API 数据。
"""
from __future__ import annotations
import re
from pathlib import Path
from typing import Any


TRACKER_PATH = Path(__file__).parent.parent.parent.parent / "docs" / "task-tracker.md"


def parse_timeline(task_id: str | None = None) -> dict[str, Any]:
    """
    返回所有任务的时间线，或单个任务的时间线。
    如果 task_id 指定，只返回该任务。
    """
    if not TRACKER_PATH.exists():
        return {"ok": False, "error": "台账文件不存在", "tasks": []}

    content = TRACKER_PATH.read_text(encoding="utf-8")
    tasks = _parse_all_tasks(content)

    if task_id:
        tasks = [t for t in tasks if t["id"] == task_id]
        if not tasks:
            return {"ok": False, "error": f"未找到任务 {task_id}", "tasks": []}

    return {"ok": True, "tasks": tasks}


def _parse_all_tasks(content: str) -> list[dict[str, Any]]:
    """解析整个台账文件，返回所有任务列表。"""
    # 找到所有任务段落
    # 格式：### T-XXX · title ...下一个 ### 或文件末尾
    task_pattern = re.compile(r'### (T-\d+) · (.+?)\n(.*?)(?=\n### |\Z)', re.DOTALL)
    tasks = []

    for m in task_pattern.finditer(content):
        tid = m.group(1).strip()
        title = m.group(2).strip()
        body = m.group(3)

        task = _parse_task_body(tid, title, body)
        tasks.append(task)

    return tasks


def _parse_task_body(tid: str, title: str, body: str) -> dict[str, Any]:
    """解析单个任务段落。"""
    # 提取任务描述
    desc_match = re.search(r'\*\*任务描述\*\*[：:]?\s*(.+)', body)
    description = desc_match.group(1).strip() if desc_match else ""

    # 提取预计工时
    hours_match = re.search(r'\*\*预计工时\*\*[：:]?\s*(\S+)', body)
    estimated_hours = hours_match.group(1).strip() if hours_match else ""

    # 提取完成日期
    date_match = re.search(r'\*\*完成日期\*\*[：:]?\s*(\S+)', body)
    due_date = date_match.group(1).strip() if date_match else ""

    # 提取优先级
    priority_match = re.search(r'\*\*优先级\*\*[：:]?\s*(\S+)', body)
    priority = priority_match.group(1).strip() if priority_match else "P2"

    # 解析时间线表格
    timeline = _parse_timeline_table(body)

    # 解析执行步骤
    steps = _parse_steps_table(body)

    # 提取状态
    status_match = re.search(r'\|\s*' + re.escape(tid) + r'\s*\|.*?\|\s*([^\s|]+)\s*\|', body)
    status = status_match.group(1).strip() if status_match else "⏳ pending"

    # 提取执行人
    assignee_match = re.search(r'\|\s*' + re.escape(tid) + r'\s*\|.*?\|\s*[^\|]+\|\s*([^\|]+)\s*\|', body)
    assignee = assignee_match.group(1).strip() if assignee_match else ""

    return {
        "id": tid,
        "title": title,
        "description": description,
        "estimated_hours": estimated_hours,
        "due_date": due_date,
        "priority": priority,
        "status": status,
        "assignee": assignee,
        "timeline": timeline,
        "steps": steps,
    }


def _parse_timeline_table(body: str) -> list[dict[str, str]]:
    """从任务正文中解析时间线表格。"""
    # 找时间线表格
    tl_match = re.search(
        r'\*\*时间线（规划）：\*\*(?:\s*\n){1,3}\|.*?\n\|[-| ]+\n(.*?)(?=\n\*\*|\n##|\Z)',
        body, re.DOTALL
    )
    if not tl_match:
        return []

    rows: list[dict[str, str]] = []
    for line in tl_match.group(1).strip().split('\n'):
        line = line.strip()
        if not line or not line.startswith('|'):
            continue
        parts = [p.strip() for p in line.split('|')[1:-1]]
        if len(parts) >= 6 and parts[0].isdigit():
            rows.append({
                "step": parts[0],
                "name": parts[1],
                "plan_start": parts[2],
                "plan_end": parts[3],
                "hours": parts[4],
                "status": parts[5],
            })
    return rows


def _parse_steps_table(body: str) -> list[dict[str, str]]:
    """从任务正文中解析执行步骤表格。"""
    steps_match = re.search(
        r'\*\*执行步骤：\*\*(?:\s*\n){1,3}\|.*?\n\|[-| ]+\n(.*?)(?=\n\*\*|\n##|\Z)',
        body, re.DOTALL
    )
    if not steps_match:
        return []

    rows: list[dict[str, str]] = []
    for line in steps_match.group(1).strip().split('\n'):
        line = line.strip()
        if not line or not line.startswith('|'):
            continue
        parts = [p.strip() for p in line.split('|')[1:-1]]
        if len(parts) >= 4 and parts[0].isdigit():
            rows.append({
                "step": parts[0],
                "name": parts[1],
                "status": parts[2],
                "assignee": parts[3],
                "blocker": parts[4] if len(parts) > 4 else "",
            })
    return rows
