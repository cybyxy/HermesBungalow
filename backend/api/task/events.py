from __future__ import annotations

import json
from typing import Any, Callable

from .models import Task

_WORKFLOW_STEP_KINDS = frozenset({"analyze", "design", "implement", "test", "review", "deliver", "other"})


def normalize_workflow_steps(raw_steps: Any, *, max_steps: int = 40) -> list[dict[str, Any]]:
    """Normalize LLM ``steps`` array for ``Task.workflow_steps`` (persisted in save JSON)."""
    if not isinstance(raw_steps, list):
        return []
    out: list[dict[str, Any]] = []
    for i, raw in enumerate(raw_steps[:max_steps]):
        if not isinstance(raw, dict):
            continue
        sid = str(raw.get("id") or "").strip() or f"step-{i + 1}"
        title = str(raw.get("title") or "").strip() or f"步骤 {i + 1}"
        kind = str(raw.get("kind") or "other").strip().lower()
        if kind not in _WORKFLOW_STEP_KINDS:
            kind = "other"
        try:
            oi = int(raw.get("order", i + 1))
        except (TypeError, ValueError):
            oi = i + 1
        row: dict[str, Any] = {"id": sid, "order": oi, "title": title, "kind": kind}
        det = str(raw.get("detail") or "").strip()
        if det:
            row["detail"] = det
        em = raw.get("estimated_minutes")
        if em is not None:
            try:
                emf = float(em)
                if emf >= 0:
                    row["estimated_minutes"] = emf
            except (TypeError, ValueError):
                pass
        dep = raw.get("depends_on")
        if isinstance(dep, list) and dep:
            deps = [str(x).strip() for x in dep if str(x).strip()]
            if deps:
                row["depends_on"] = deps
        assignee = str(raw.get("assignee") or "").strip()
        if assignee:
            row["assignee"] = assignee
        status = str(raw.get("status") or "").strip().lower()
        if status in ("pending", "in_progress", "completed"):
            row["status"] = status
        else:
            row["status"] = "pending"
        out.append(row)
    out.sort(key=lambda r: int(r.get("order", 0)))
    return out


def extract_game_event_tags(text: str) -> list[dict[str, Any]]:
    """Parse `[[GAME_EVENT:{...json...}]]` segments (may span lines)."""
    out: list[dict[str, Any]] = []
    key = "[[GAME_EVENT:"
    i = 0
    while True:
        start = text.find(key, i)
        if start < 0:
            break
        end = text.find("]]", start)
        if end < 0:
            break
        blob = text[start + len(key) : end].strip()
        try:
            out.append(json.loads(blob))
        except json.JSONDecodeError:
            # LLM 可能输出多余花括号或尾部字符，用 raw_decode 容错
            try:
                decoder = json.JSONDecoder()
                obj, _idx = decoder.raw_decode(blob)
                if isinstance(obj, dict):
                    out.append(obj)
            except json.JSONDecodeError:
                pass
        i = end + 2
    return out


def apply_parsed_events(
    world: Any,
    events: list[dict[str, Any]],
    emit: Callable[[str, dict[str, Any]], None] | None = None,
) -> list[dict[str, Any]]:
    """Mutate world (TaskWorld) in place. Returns applied event log."""
    applied: list[dict[str, Any]] = []
    for ev in events:
        t = ev.get("type")
        if t == "task_progress":
            tid = int(ev.get("task_id", 0))
            prog = float(ev.get("progress", 0))
            for task in world.tasks:
                if task.id == tid:
                    task.progress = max(0, min(100, prog))
                    if emit:
                        emit("task", {"task_id": tid, "progress": task.progress, "status": task.status})
                    applied.append(ev)
                    break
        elif t == "task_workflow_plan":
            tid = int(ev.get("task_id", 0))
            steps = normalize_workflow_steps(ev.get("steps"))
            if not tid or not steps:
                continue
            for task in world.tasks:
                if task.id == tid:
                    task.workflow_steps = steps
                    if emit:
                        emit("task", {"action": "update", "task": task.to_dict()})
                    applied.append(ev)
                    break
        elif t == "task_chain_create":
            name = str(ev.get("name", "")).strip()
            desc = str(ev.get("description", "")).strip()
            sub_tasks = ev.get("sub_tasks")
            if not name or not isinstance(sub_tasks, list) or len(sub_tasks) == 0:
                continue
            max_id = max((t.id for t in world.tasks), default=0)
            # 先创建父任务（项目总任务）
            max_id += 1
            parent = Task(
                id=max_id,
                name=name,
                description=desc,
                status="in_progress",
                required_profession="项目经理",
                difficulty=max(1, len(sub_tasks)),
            )
            world.tasks.append(parent)
            # 批量创建子任务
            idx_to_tid: dict[int, int] = {}
            for i, st in enumerate(sub_tasks):
                max_id += 1
                st_name = str(st.get("name", f"子任务 {i+1}")).strip()
                st_desc = str(st.get("description", "")).strip()
                st_prof = str(st.get("required_profession", "程序员")).strip() or "程序员"
                st_diff = int(st.get("difficulty", 2))
                deps = st.get("depends_on_indices")
                child_deps: list[int] = []
                if isinstance(deps, list):
                    for di in deps:
                        try:
                            did = idx_to_tid.get(int(di))
                            if did:
                                child_deps.append(did)
                        except (TypeError, ValueError):
                            pass
                child = Task(
                    id=max_id,
                    name=st_name,
                    description=st_desc,
                    required_profession=st_prof,
                    difficulty=st_diff,
                    depends_on=child_deps,
                    parent_task_id=parent.id,
                    status="locked" if child_deps else "pending",
                )
                world.tasks.append(child)
                idx_to_tid[i] = max_id
            if emit:
                emit("task", {"action": "batch_create", "task": parent.to_dict()})
            applied.append(ev)
        elif t == "task_status":
            tid = int(ev.get("task_id", 0))
            new_status = str(ev.get("status") or "").strip()
            if not tid or new_status not in ("pending", "in_progress", "completed", "failed"):
                continue
            for task in world.tasks:
                if task.id == tid:
                    task.status = new_status
                    assignee = str(ev.get("assignee_id") or "").strip()
                    if assignee:
                        task.assignee_id = assignee
                    # 状态联动进度
                    if new_status == "completed":
                        task.progress = 100.0
                    elif new_status == "in_progress":
                        task.progress = max(task.progress, 10.0)
                    world.event_log.insert(
                        0,
                        {
                            "at": __import__("time").time(),
                            "kind": "task_status",
                            "task_id": tid,
                            "status": new_status,
                            "assignee_id": assignee,
                        },
                    )
                    if emit:
                        emit("task", {"action": "update", "task": task.to_dict()})
                    applied.append(ev)
                    break
        elif t == "task_report":
            tid = int(ev.get("task_id", 0))
            summary = str(ev.get("summary", "")).strip()
            deliverables = ev.get("deliverables")
            if not tid:
                continue
            for task in world.tasks:
                if task.id == tid:
                    task.status = "completed"
                    task.progress = 100.0
                    if summary:
                        existing = str(getattr(task, "deliverables", "") or "")
                        task.deliverables = (existing + "\n" + summary).strip()
                    if isinstance(deliverables, list):
                        for d in deliverables:
                            if isinstance(d, dict):
                                d_kind = str(d.get("kind", "file")).strip()
                                d_title = str(d.get("title", "")).strip()
                                d_url = str(d.get("url", d.get("path", ""))).strip()
                                if d_title or d_url:
                                    world.event_log.insert(
                                        0,
                                        {
                                            "at": __import__("time").time(),
                                            "kind": "artifact",
                                            "artifact_kind": d_kind,
                                            "title": d_title,
                                            "content": d_url,
                                            "task_id": tid,
                                        },
                                    )
                    world.event_log.insert(
                        0,
                        {
                            "at": __import__("time").time(),
                            "kind": "task_status",
                            "task_id": tid,
                            "status": "completed",
                            "assignee_id": task.assignee_id,
                        },
                    )
                    if emit:
                        emit("task", {"action": "update", "task": task.to_dict()})
                    applied.append(ev)
                    break
        elif t == "artifact_create":
            kind = str(ev.get("kind", "")).strip()
            title = str(ev.get("title", "")).strip()
            content = str(ev.get("content", "")).strip()
            task_id = int(ev.get("task_id", 0))
            if kind and title and content:
                world.event_log.insert(
                    0,
                    {
                        "at": __import__("time").time(),
                        "kind": "artifact",
                        "artifact_kind": kind,
                        "title": title,
                        "content": content,
                        "task_id": task_id,
                    },
                )
                if emit:
                    emit("task", {"action": "artifact", "kind": kind, "title": title, "task_id": task_id})
                applied.append(ev)
    return applied
