"""Auto-extracted from service.py."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any, Callable

from .events import apply_parsed_events, extract_game_event_tags
from .models import Task
from .persistence import delete_task_from_db, save_tasks_to_db


class TaskOpsMixin:
    """Mixin providing task_ops operations for TaskService."""

    def create_task(self, payload: dict[str, Any]) -> Task:
        with self._lock:
            tid = max((t.id for t in self._world.tasks), default=0) + 1
            try:
                est = float(payload.get("estimated_hours", 2.0))
            except (TypeError, ValueError):
                est = 2.0
            try:
                diff = max(1, min(5, int(payload.get("difficulty", 2))))
            except (TypeError, ValueError):
                diff = 2
            try:
                rew = max(0, int(payload.get("reward", 100)))
            except (TypeError, ValueError):
                rew = 100
            rp = str(payload.get("required_profession") or "程序员").strip() or "程序员"
            task = Task(
                id=tid,
                name=str(payload.get("name") or "新任务"),
                description=str(payload.get("description") or ""),
                required_profession=rp,
                difficulty=diff,
                reward=rew,
                is_collaborative=bool(payload.get("is_collaborative") or False),
                estimated_hours=max(0.0, est),
                due_at=str(payload.get("due_at") or "").strip()[:32],
                deliverables=str(payload.get("deliverables") or ""),
                acceptance_criteria=str(payload.get("acceptance_criteria") or ""),
                catalog=str(payload.get("catalog") or "").strip()[:256],
            )
            self._world.tasks.append(task)
            self._append_event_log(
                "task_create",
                {"task_id": tid, "name": task.name, "catalog": str(getattr(task, "catalog", "") or "").strip()},
            )
            self._broadcast("task", {"action": "create", "task": task.to_dict()})
            return task

    def _lord_dispatch_tasks(self, lord: Any, applied_events: list[dict[str, Any]]) -> dict[str, Any]:
        """任务链创建后，城主通知各 agent 领取任务并更新状态。"""
        from api.task.orchestration import orchestrated_peer_turns_sync

        # 找出刚创建的子任务
        sub_tasks: list[Any] = []
        with self._lock:
            for ev in applied_events:
                if ev.get("type") == "task_chain_create":
                    for t in self._world.tasks:
                        pid = getattr(t, "parent_task_id", 0)
                        if pid and pid > 0:
                            sub_tasks.append(t)
                    break

        if not sub_tasks:
            return {"ok": False, "reason": "no_new_tasks"}

        task_ids = [t.id for t in sub_tasks]
        with self._lock:
            agents = list(self._world.agents)

        # 匹配每个子任务到合适的 agent（基于 required_profession）
        task_lines: list[str] = []
        for t in sub_tasks:
            prof = str(getattr(t, "required_profession", "") or "").strip()
            suggested = "待分配"
            for a in agents:
                ap = str(getattr(a, "profession", "") or "").strip()
                if ap and prof and (ap in prof or prof in ap):
                    suggested = f"{a.name}（ID: {a.id}）"
                    break
            if suggested == "待分配" and agents:
                suggested = f"{agents[0].name}（ID: {agents[0].id}）"
            task_lines.append(f"  - 任务 #{t.id}「{t.name}」（{prof}）→ {suggested}")

        lines: list[str] = [
            "【任务分发 —— 通知成员并更新状态（必须严格遵守）】",
            "",
            "以下任务链刚创建完毕，你需要立即通知成员：",
            "",
        ]
        lines.extend(task_lines)
        lines.append("")
        lines.append("**【成员列表】**")
        for a in agents:
            lines.append(f"  - {a.name}（ID: {a.id}，{a.profession}）")
        lines.append("")
        lines.append("**【你必须按顺序执行，不可跳过任何步骤】**")
        lines.append("")
        lines.append("第 1 步：用 `@成员名 | 消息` 逐一通知每个任务的负责人，内容包含任务名称+交付物+验收标准。")
        lines.append("第 2 步：等成员回复确认后，**立即**在回复末尾输出以下标签（一行一个任务，必须全部输出，不可遗漏）：")
        lines.append('')
        ids_str = ', '.join(str(i) for i in task_ids)
        lines.append(f'   需要更新的任务 ID：{ids_str}')
        lines.append('')
        lines.append('   [[GAME_EVENT:{"type":"task_status","task_id":替换为任务ID,"status":"in_progress","assignee_id":"替换为成员ID"}]]')
        lines.append('')
        lines.append("**重要：你的最终回复末尾必须包含所有任务的 task_status 标签！每通知一个成员并收到确认，就输出一个标签。不要讨论、不要总结、直接输出标签。**")
        lines.append("")
        lines.append("**【告知成员：完成工作后必须用 task_report 汇报】**")
        lines.append("- 通知每个成员：完成所分配的任务后，在回复末尾输出 task_report 标签汇报交付物")
        lines.append("- 格式示例：")
        lines.append('  [[GAME_EVENT:{"type":"task_report","task_id":子任务ID,"summary":"完成了XX功能的开发","deliverables":[{"kind":"file","title":"index.html","url":"http://localhost:4000/项目名/index.html"}]}]]')
        lines.append("- deliverable 中 kind 可选：file/document/code/image/video/other")
        lines.append("- **member 必须汇报交付物**，否则无法推进任务链")
        lines.append("")
        lines.append("**【项目输出目录 —— 通知成员时必须说明】**")
        lines.append("- 所有代码和产物写入 agent_workspace/<项目名>/ 目录")
        lines.append("- 前端文件（HTML/CSS/JS）直接放在 agent_workspace/<项目名>/ 下")
        lines.append("- 预览地址：http://localhost:4000/<项目名>/")
        lines.append("- **绝对不要**写到 frontend/ 或 backend/，那是平台源码目录")

        dispatch_message = "\n".join(lines)

        try:
            result = orchestrated_peer_turns_sync(
                lord,
                dispatch_message,
                auto_peer=True,
                task_service=self,
                event_sink=None,
                run_id="",
                inject_receipt=True,
            )
        except Exception:
            return {"ok": False, "reason": "dispatch_failed"}

        return result

    def lord_create_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        """通过城主（崽崽）创建任务：由城主分析需求、与团队沟通、拆解任务链。"""
        from api.task.orchestration import main_agent_orchestrated_turn

        # 清除城主旧 session，确保新任务不受历史对话上下文干扰
        with self._lock:
            lord = next(
                (a for a in self._world.agents if str(getattr(a, "profile", "") or "").strip() in ("崽崽", "default")),
                None,
            )
        if lord:
            self.clear_agent_session(lord.id)

        name = str(payload.get("name") or "新任务").strip()
        desc = str(payload.get("description") or "").strip()
        rp = str(payload.get("required_profession") or "").strip()
        diff = int(payload.get("difficulty", 2))
        rew = int(payload.get("reward", 100))
        est = float(payload.get("estimated_hours", 2.0))
        excerpt = str(payload.get("user_skill_excerpt") or "").strip()
        due = str(payload.get("due_at") or "").strip()[:32]

        parts: list[str] = [
            "【新建任务 —— 用户提交了以下任务创建请求，请你以城主身份统筹】",
            "",
            f"**任务名称：** {name}",
            f"**任务描述：** {desc or '（无详细描述）'}",
            f"**建议职业：** {rp or '待定'}",
            f"**难度：** {diff}/5",
            f"**奖励：** {rew}",
            f"**预计工时：** {est}h",
        ]
        if due:
            parts.append(f"**截止时间：** {due}")
        if excerpt:
            excerpt_short = excerpt[:12000]
            parts.append(f"\n**用户补充资料：**\n{excerpt_short}")

        parts.append(
            "\n---\n"
            "**【你的角色】**\n"
            "你是项目管理员（任务统筹者），**不是执行者，也不是需求分析者**。你的唯一职责是：找合适的团队成员分析需求 → 综合各方意见 → 拆解为可执行的任务链 → 分配工作。你**不亲自分析**需求细节，**不亲自执行**任何开发/设计/编码任务。\n"
            "\n"
            "**【操作流程 — 必须按顺序完整执行】**\n"
            "\n"
            "**第 1 步：找合适的人分析需求（必须执行，不可跳过）**\n"
            "- 你不需要亲自分析需求细节，你的任务是**找到对的人**来做这件事\n"
            "- 根据任务主题，判断需要哪些技能角色\n"
            "- 用 `@成员 | 消息内容` 格式联系相关成员，让他们来分析需求：\n"
            "  1) 把任务描述和补充资料转发给合适的成员\n"
            "  2) 让他们各自从专业角度分析这个任务需要做什么\n"
            "  3) 让他们给出拆解建议和预估\n"
            "- **你只是传话和协调的人**，不是分析者\n"
            "\n"
            "**第 2 步：综合成员意见，形成方案（必须执行，不可跳过）**\n"
            "- 等待至少 1 名成员的回复后，综合各方分析结果\n"
            "- 确认以下问题已经讨论清楚：\n"
            "  1) 这个任务怎样拆解最合理？（由成员给出，你来汇总）\n"
            "  2) 每个环节需要什么技能、预估多久？\n"
            "  3) 每一步的**交付物**是什么？（必须有可验收的产出）\n"
            "- 形成最终任务链方案\n"
            "- **不要在沟通前就创建任务**——先讨论，再决定\n"
            "\n"
            "**第 3 步：创建任务链（沟通完成后立即执行）**\n"
            "- **子任务数量：2~5 个**（根据项目复杂度合理拆解，严禁超过 5 个）\n"
            "- 在你的回复末尾输出 [[GAME_EVENT:task_chain_create]] 标签\n"
            "- 格式：\n"
            '  [[GAME_EVENT:{"type":"task_chain_create","name":"项目名","description":"项目概述","sub_tasks":[\n'
            '    {"name":"子任务1","description":"详细描述 + 交付物清单","required_profession":"职业","difficulty":2,"depends_on_indices":[]},\n'
            '    {"name":"子任务2","description":"详细描述 + 交付物清单","required_profession":"职业","difficulty":2,"depends_on_indices":[0]},\n'
            '    {"name":"子任务3","description":"详细描述 + 交付物清单 + 最终产物链接","required_profession":"职业","difficulty":2,"depends_on_indices":[1]}\n'
            '  ]}]]\n'
            "- **依赖规则**：子任务必须串行依赖（下标 1 依赖 0，下标 2 依赖 1...），确保每个节点**完成后经负责人确认**才能启动下一步\n"
            "- 每个子任务的 description 中必须写明：\n"
            "  * **交付物**：本步骤的具体产出（文件/代码/文档/设计稿等）\n"
            "  * **验收标准**：怎样判断本步骤已完成\n"
            "  * 最后一个子任务的交付物必须包含**可打开的文件链接或路径**\n"
            "\n"
            "**第 3.5 步：输出任务流程规划（必须执行）**\n"
            "- 在 task_chain_create 标签后，**紧接着**输出 [[GAME_EVENT:task_workflow_plan]] 标签\n"
            "- 注意：task_id 填写**父任务**的 ID（即 task_chain_create 中创建的第一个任务的 ID，它的 parent_task_id=0）\n"
            "- 格式：\n"
            '  [[GAME_EVENT:{"type":"task_workflow_plan","task_id":父任务ID,"steps":[\n'
            '    {"id":"step-1","order":1,"title":"步骤标题","kind":"implement","assignee":"成员名","status":"pending","depends_on":[]},\n'
            '    {"id":"step-2","order":2,"title":"步骤标题","kind":"test","assignee":"成员名","status":"pending","depends_on":["step-1"]}\n'
            '  ]}]]\n'
            "- steps 中每个子任务对应一个或多个步骤，kind 可选：analyze/design/implement/test/review/deliver/other\n"
            "- 这是任务在「任务流程」tab 中展示的时间轴，必须与 task_chain_create 的子任务一一对应\n"
            "\n"
            "**第 4 步：总结分工方案**\n"
            "- 用简洁的语言总结：谁做什么 → 产出什么 → 依赖关系 → 最终产物在哪\n"
            "\n"
            "**【项目输出目录 —— 必须遵守】**\n"
            "- 所有代码文件、文档、产物必须写入 **agent_workspace/<项目名>/** 目录\n"
            "- 前端项目（HTML/CSS/JS）写入 agent_workspace/<项目名>/\n"
            "- 后端代码写入 agent_workspace/<项目名>/backend/\n"
            "- 预览地址：http://localhost:4000/<项目名>/\n"
            "- **绝对不要**写到 frontend/ 或 backend/ 目录，那是平台源码"
        )
        message = "\n".join(parts)

        result = main_agent_orchestrated_turn(message, self)
        try:
            applied_info = self.apply_game_events_from_orchestrate_result(result)
        except Exception:
            applied_info = {"applied": []}
        self.persist()

        # ── 第 5 步：任务分发 —— 通知各 agent 开始执行分配到的任务 ──
        applied_events: list[dict[str, Any]] = applied_info.get("applied", []) if isinstance(applied_info, dict) else []
        has_new_chain = any(e.get("type") == "task_chain_create" for e in applied_events)
        if has_new_chain and lord:
            try:
                dispatch_result = self._lord_dispatch_tasks(lord, applied_events)
                result["dispatch"] = dispatch_result
                # 只提取 task_status 事件，避免重复创建任务链
                dispatch_texts = _collect_orchestrate_reply_texts(dispatch_result)
                dispatch_events: list[dict[str, Any]] = []
                for t in dispatch_texts:
                    dispatch_events.extend(extract_game_event_tags(t))
                status_only = [e for e in dispatch_events if e.get("type") == "task_status"]
                if status_only:
                    with self._lock:
                        apply_parsed_events(self._world, status_only, emit=self._broadcast)
                        self.sync_room_occupancy()
                self.persist()
            except Exception:
                pass

        return result

    def update_task(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Partial update: 名称、描述、截止、产物、验收、预计工时、协作标记、依赖。"""
        with self._lock:
            tid = int(payload.get("task_id", 0))
            task = next((t for t in self._world.tasks if t.id == tid), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            if "name" in payload:
                n = str(payload.get("name") or "").strip()
                if n:
                    task.name = n
            if "description" in payload:
                task.description = str(payload.get("description") or "")
            if "due_at" in payload:
                task.due_at = str(payload.get("due_at") or "").strip()[:32]
            if "deliverables" in payload:
                task.deliverables = str(payload.get("deliverables") or "")
            if "acceptance_criteria" in payload:
                task.acceptance_criteria = str(payload.get("acceptance_criteria") or "")
            if "catalog" in payload:
                task.catalog = str(payload.get("catalog") or "").strip()[:256]
            if "estimated_hours" in payload:
                try:
                    task.estimated_hours = max(0.0, float(payload.get("estimated_hours")))
                except (TypeError, ValueError):
                    pass
            if "is_collaborative" in payload:
                task.is_collaborative = bool(payload.get("is_collaborative"))
            deps_updated = False
            if "depends_on" in payload:
                raw_deps = payload.get("depends_on")
                if isinstance(raw_deps, list):
                    dep_ids = sorted(set(int(d) for d in raw_deps if int(d) != tid))
                    all_ids = {t.id for t in self._world.tasks}
                    for d in dep_ids:
                        if d not in all_ids:
                            return {"ok": False, "error": f"dependency_task_not_found: {d}"}
                    task.depends_on = dep_ids
                    deps_updated = True
            if deps_updated:
                self._recompute_locked_tasks()
            self._append_event_log("task_update", {"task_id": tid})
            self._broadcast("task", {"action": "update", "task": task.to_dict()})
            return {"ok": True, "task": task.to_dict()}

    def delete_task(self, task_id: int) -> dict[str, Any]:
        """Remove task; clear assignees' current_task_id and idle working agents."""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            tid = task.id
            for a in self._world.agents:
                if a.current_task_id == tid:
                    a.current_task_id = None
                    if getattr(a, "status", None) == "working":
                        a.status = "idle"
            tname = str(task.name or "")
            # 同时删除子任务
            child_ids = [t.id for t in self._world.tasks if getattr(t, "parent_task_id", 0) == tid]
            self._world.tasks = [t for t in self._world.tasks if t.id != tid and getattr(t, "parent_task_id", 0) != tid]
            # 清理其他任务对该任务的依赖引用，然后重新计算 locked 状态
            for t in self._world.tasks:
                if tid in (getattr(t, "depends_on", None) or []):
                    t.depends_on = [d for d in t.depends_on if d != tid]
                for cid in child_ids:
                    if cid in (getattr(t, "depends_on", None) or []):
                        t.depends_on = [d for d in t.depends_on if d != cid]
            self._recompute_locked_tasks()
            self._append_event_log("task_delete", {"task_id": tid, "name": tname})
            self._broadcast("task", {"action": "delete", "task_id": tid})
            # 从 DB 表清理
            from .persistence import delete_task_from_db
            delete_task_from_db(self._conn, tid)
            return {"ok": True, "task_id": tid}

    # ── 任务链 DAG 方法 ───────────────────────────────────────────────

    def sync_room_occupancy(self) -> None:
        """根据 agent 的 current_task_id 同步房间占用状态（当前为 no-op，占位）。"""

    def _lord_advance_chain(self, parent_task_id: int) -> dict[str, Any]:
        """子任务完成后：解锁下一个 → 通知 agent → 父任务进度更新。"""
        from api.task.orchestration import orchestrated_peer_turns_sync

        with self._lock:
            children = [t for t in self._world.tasks if getattr(t, "parent_task_id", 0) == parent_task_id]
            if not children:
                return {"ok": False, "reason": "no_children"}
            parent = next((t for t in self._world.tasks if t.id == parent_task_id), None)
            agents = list(self._world.agents)

        # 1. 重新计算锁定状态
        self._recompute_locked_tasks()

        # 2. 重新读取子任务（recompute 可能改了状态）
        with self._lock:
            children = [t for t in self._world.tasks if getattr(t, "parent_task_id", 0) == parent_task_id]
            completed = sum(1 for t in children if t.status == "completed")
            total = len(children)
            newly_unlocked = [
                t for t in children
                if t.status == "pending" and not getattr(t, "assignee_id", None)
            ]

        # 3. 更新父任务进度
        if parent:
            with self._lock:
                parent.progress = (completed / total) * 100 if total > 0 else 0
                if completed >= total:
                    parent.status = "completed"
                    parent.progress = 100.0
                self._broadcast("task", {"action": "update", "task": parent.to_dict()})

        # 4. 全部完成 → 结束
        if completed >= total:
            self.persist()
            return {"ok": True, "all_done": True, "progress": 100.0}

        # 5. 有可解锁的任务 → Lord 通知对应 agent
        if newly_unlocked:
            lord = next(
                (a for a in agents if str(getattr(a, "profile", "") or "").strip() in ("崽崽", "default")),
                None,
            )
            if not lord and agents:
                lord = agents[0]
            if lord:
                task_list = "\n".join(
                    f"  - #{t.id}「{t.name}」→ {t.required_profession}" for t in newly_unlocked
                )
                msg = (
                    "【任务链推进】以下子任务已解锁，请通知对应成员开始工作：\n"
                    f"{task_list}\n\n"
                    "用 @成员名 | 消息 通知他们，并在确认后输出 task_status 标签更新状态。"
                )
                try:
                    orchestrated_peer_turns_sync(
                        lord, msg, auto_peer=True, task_service=self, inject_receipt=True,
                    )
                except Exception:
                    pass

        self.persist()
        return {
            "ok": True,
            "unlocked": [t.id for t in newly_unlocked],
            "progress": (completed / total) * 100 if total > 0 else 0,
        }

    def _recompute_locked_tasks(self) -> None:
        """根据 depends_on 重新计算所有任务的 locked/pending 状态。调用者必须持有 _lock。"""
        completed_ids = {t.id for t in self._world.tasks if t.status == "completed"}
        for t in self._world.tasks:
            deps = getattr(t, "depends_on", None)
            if isinstance(deps, list) and deps:
                unsatisfied = [d for d in deps if d not in completed_ids]
                if unsatisfied and t.status not in ("completed", "in_progress"):
                    if t.status != "locked":
                        t.status = "locked"
                elif not unsatisfied and t.status == "locked":
                    t.status = "pending"
            # 如果依赖列表为空但当前是 locked（被手动清除依赖后），恢复为 pending
            elif t.status == "locked":
                t.status = "pending"

    def set_task_dependency(self, task_id: int, depends_on: list[int]) -> dict[str, Any]:
        """设置任务依赖并重新计算锁定状态。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            dep_ids = [int(d) for d in depends_on]
            # 去重并排除自引用
            dep_ids = sorted(set(d for d in dep_ids if d != task_id))
            # 验证所有依赖任务存在
            all_ids = {t.id for t in self._world.tasks}
            for d in dep_ids:
                if d not in all_ids:
                    return {"ok": False, "error": f"dependency_task_not_found: {d}"}
            task.depends_on = dep_ids
            self._recompute_locked_tasks()
            self._append_event_log("task_dependency", {"task_id": task_id, "depends_on": dep_ids})
            self._broadcast("task", {"action": "update", "task": task.to_dict()})
            return {"ok": True, "task": task.to_dict()}

    def batch_create_tasks(self, tasks_data: list[dict[str, Any]]) -> dict[str, Any]:
        """批量创建任务，支持批内依赖索引解析。

        tasks_data 每项可含 ``depends_on_indices``（批内索引列表，0-based），
        自动解析为任务 ID。创建后执行 _recompute_locked_tasks。
        """
        if not isinstance(tasks_data, list) or not tasks_data:
            return {"ok": False, "error": "empty_tasks_data"}
        with self._lock:
            max_id = max((t.id for t in self._world.tasks), default=0)
            created: list[Task] = []
            idx_to_tid: dict[int, int] = {}
            # 第一遍：创建所有任务获取 ID
            for i, td in enumerate(tasks_data):
                if not isinstance(td, dict):
                    continue
                max_id += 1
                idx_to_tid[i] = max_id
            # 第二遍：构造 Task 对象（此时所有 ID 已知）
            next_id = max((t.id for t in self._world.tasks), default=0)
            for i, td in enumerate(tasks_data):
                if not isinstance(td, dict):
                    continue
                next_id += 1
                dep_indices = td.get("depends_on_indices")
                child_deps: list[int] = []
                if isinstance(dep_indices, list):
                    for di in dep_indices:
                        try:
                            did = idx_to_tid.get(int(di))
                            if did:
                                child_deps.append(did)
                        except (TypeError, ValueError):
                            pass
                t = Task(
                    id=next_id,
                    name=str(td.get("name", f"任务 {next_id}")),
                    description=str(td.get("description", "")),
                    required_profession=str(td.get("required_profession", "程序员")).strip() or "程序员",
                    difficulty=max(1, min(5, int(td.get("difficulty", 2)))),
                    depends_on=child_deps,
                )
                self._world.tasks.append(t)
                created.append(t)
            self._recompute_locked_tasks()
            self._append_event_log("task_batch_create", {"count": len(created)})
            self._broadcast("task", {"action": "batch_create", "tasks": [t.to_dict() for t in created]})
            return {"ok": True, "tasks": [t.to_dict() for t in created], "count": len(created)}

    def claim_task(self, task_id: int, agent_id: str) -> dict[str, Any]:
        """轻量级认领：仅 unlocked + pending 任务可被认领。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            if task.status == "locked":
                return {"ok": False, "error": "task_locked"}
            if task.status in ("completed", "in_progress"):
                return {"ok": False, "error": "task_not_available"}
            agent = next((a for a in self._world.agents if a.id == agent_id), None)
            if not agent:
                return {"ok": False, "error": "agent_not_found"}
            task.assignee_id = agent_id
            task.status = "in_progress"
            agent.status = "working"
            agent.current_task_id = task_id
            self._append_event_log("task_claim", {"task_id": task_id, "agent_id": agent_id})
            self._broadcast("task", {"action": "assign", "task": task.to_dict()})
            return {"ok": True, "task": task.to_dict()}

    def get_task_chain(self) -> dict[str, Any]:
        """返回任务 DAG 可视化数据：节点列表 + 边列表。"""
        with self._lock:
            nodes = [
                {
                    "id": t.id,
                    "name": t.name,
                    "status": t.status,
                    "assignee_id": t.assignee_id,
                    "progress": t.progress,
                    "depends_on": getattr(t, "depends_on", []),
                    "parent_task_id": getattr(t, "parent_task_id", 0),
                }
                for t in self._world.tasks
            ]
            edges: list[dict[str, Any]] = []
            for t in self._world.tasks:
                deps = getattr(t, "depends_on", None)
                if isinstance(deps, list):
                    for d in deps:
                        edges.append({"from": d, "to": t.id})
            return {"nodes": nodes, "edges": edges}

    def assign_task(self, task_id: int, agent_id: str | None) -> dict[str, Any]:
        """分配任务给指定 Agent。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}

            if agent_id:
                target = next((a for a in self._world.agents if a.id == agent_id), None)
                if not target:
                    return {"ok": False, "error": "agent_not_found"}
                task.assignee_id = agent_id
                task.status = "in_progress"
                target.current_task_id = task_id
                self._append_event_log("task_assign", {"task_id": task_id, "assignee_id": agent_id})
                self._broadcast("task", {"action": "assign", "task": task.to_dict()})
                return {"ok": True, "task_id": task_id}

            # 未指定 agent_id：选择第一个 agent
            if self._world.agents:
                a = self._world.agents[0]
                task.assignee_id = a.id
                task.status = "in_progress"
                a.current_task_id = task_id
            else:
                task.assignee_id = None
                task.status = "pending"
                return {"ok": False, "error": "no_agents"}

            self._append_event_log(
                "task_assign",
                {"task_id": task_id, "assignee_id": task.assignee_id},
            )
            self._broadcast("task", {"action": "assign", "task": task.to_dict()})
            return {"ok": True, "task_id": task_id}


    def complete_task(self, task_id: int, quality: int = 0) -> dict[str, Any]:
        """完成任务，解锁依赖任务。"""
        with self._lock:
            task = next((t for t in self._world.tasks if t.id == task_id), None)
            if not task:
                return {"ok": False, "error": "task_not_found"}
            if task.status == "completed":
                return {"ok": False, "error": "already_completed"}
            task.status = "completed"
            task.progress = 100.0
            task.quality = max(0, min(100, quality))
            if task.assignee_id:
                for a in self._world.agents:
                    if a.id == task.assignee_id:
                        a.current_task_id = None
                        self._append_event_log(
                            "task_complete",
                            {"task_id": task_id, "assignee_id": task.assignee_id, "quality": task.quality},
                        )
                        self._broadcast("task", {"action": "complete", "task": task.to_dict()})
                        self._recompute_locked_tasks()
                        return {"ok": True, "task_id": task_id, "quality": task.quality}
            self._recompute_locked_tasks()
            self._append_event_log("task_complete", {"task_id": task_id})
            self._broadcast("task", {"action": "complete", "task": task.to_dict()})
            return {"ok": True, "task_id": task_id, "quality": task.quality}

    def _record_applied_game_event_side_effects(self, applied: list[dict[str, Any]]) -> None:
        """Append ``event_log`` rows for selected applied GAME_EVENT types (caller must hold ``_lock``)."""
        for ev in applied:
            if not isinstance(ev, dict):
                continue
            et = ev.get("type")
            if et == "task_progress":
                try:
                    tid = int(ev.get("task_id", 0))
                    prog = float(ev.get("progress", 0))
                except (TypeError, ValueError):
                    tid, prog = 0, 0.0
                if tid:
                    self._append_event_log("task_progress", {"task_id": tid, "progress": prog})
            elif et == "task_workflow_plan":
                try:
                    tid = int(ev.get("task_id", 0))
                except (TypeError, ValueError):
                    tid = 0
                steps = ev.get("steps")
                n = len(steps) if isinstance(steps, list) else 0
                if tid and n > 0:
                    self._append_event_log(
                        "task_workflow_defined",
                        {
                            "task_id": tid,
                            "step_count": n,
                            "summary": str(ev.get("summary") or "")[:500],
                        },
                    )
            elif et == "task_chain_create":
                name = str(ev.get("name") or "")
                sub_count = len(ev.get("sub_tasks") or [])
                if name:
                    self._append_event_log(
                        "task_chain_created",
                        {"project": name, "sub_tasks": sub_count},
                    )
            elif et == "artifact_create":
                self._append_event_log(
                    "artifact",
                    {
                        "kind": str(ev.get("kind") or ""),
                        "title": str(ev.get("title") or "")[:200],
                        "task_id": int(ev.get("task_id", 0)),
                    },
                )

    def apply_llm_tags(self, text: str) -> dict[str, Any]:
        events = extract_game_event_tags(text)
        with self._lock:
            applied = apply_parsed_events(self._world, events, emit=self._broadcast)
            self._record_applied_game_event_side_effects(applied)
            self._append_event_log("llm_tags", {"count": len(applied)})
            return {"extracted": events, "applied": applied}

    def apply_game_events_from_orchestrate_result(self, result: dict[str, Any]) -> dict[str, Any]:
        """Parse ``[[GAME_EVENT:…]]`` from all orchestration reply texts and mutate world + event_log."""
        texts = _collect_orchestrate_reply_texts(result)
        all_ev: list[dict[str, Any]] = []
        for t in texts:
            all_ev.extend(extract_game_event_tags(t))
        # 收集需要推进的父任务 ID（子任务被标记为 completed 时）
        chain_parent_ids: set[int] = set()
        with self._lock:
            applied = apply_parsed_events(self._world, all_ev, emit=self._broadcast)
            self.sync_room_occupancy()
            self._record_applied_game_event_side_effects(applied)
            # 检查是否有子任务刚完成，收集其父任务 ID
            for ev in applied:
                et = ev.get("type", "")
                if et in ("task_status", "task_report"):
                    tid = int(ev.get("task_id", 0))
                    if et == "task_status" and str(ev.get("status", "")) != "completed":
                        continue
                    for t in self._world.tasks:
                        if t.id == tid:
                            pid = getattr(t, "parent_task_id", 0)
                            if pid and pid > 0:
                                chain_parent_ids.add(pid)
                            break
        # 在锁外推进任务链
        for pid in sorted(chain_parent_ids):
            try:
                self._lord_advance_chain(pid)
            except Exception:
                pass
        return {"from_replies": len(texts), "extracted": all_ev, "applied": applied}

    def generate_task_workflow_with_llm(
        self,
        agent_id: str,
        task_id: int,
        user_skill_excerpt: str | None = None,
    ) -> dict[str, Any]:
        """编排单轮：用户 SKILL 摘录可选；提示词由后端拼接 JSON Schema；回复经解析写入 ``workflow_steps``。"""
        from api.task.orchestration import orchestrated_peer_turns_sync

        from .context import compose_task_workflow_generation_message, parse_task_workflow_llm_reply

        aid = str(agent_id or "").strip()
        tid = int(task_id)
        with self._lock:
            primary = next((a for a in self._world.agents if a.id == aid), None)
            task = next((t for t in self._world.tasks if t.id == tid), None)
            world_agents = [{"name": a.name, "profession": a.profession, "id": a.id} for a in self._world.agents]
        if not primary:
            return {"ok": False, "error": "agent_not_found"}
        if not task:
            return {"ok": False, "error": "task_not_found"}
        message = compose_task_workflow_generation_message(
            task.to_dict(),
            user_skill_excerpt=user_skill_excerpt,
            agents=world_agents,
        )
        result = orchestrated_peer_turns_sync(
            primary,
            message,
            False,
            self,
            primary_attachments=None,
            event_sink=None,
            run_id="",
        )
        try:
            self.apply_game_events_from_orchestrate_result(result)
        except Exception:
            pass
        texts = _collect_orchestrate_reply_texts(result)
        combined = "\n".join(texts)
        with self._lock:
            t2 = next((x for x in self._world.tasks if x.id == tid), None)
            had_steps = bool(t2 and getattr(t2, "workflow_steps", None))
        if not had_steps:
            ev = parse_task_workflow_llm_reply(combined, tid)
            if ev:
                with self._lock:
                    applied2 = apply_parsed_events(self._world, [ev], emit=self._broadcast)
                    self.sync_room_occupancy()
                    self._record_applied_game_event_side_effects(applied2)
        self.persist()
        with self._lock:
            t3 = next((x for x in self._world.tasks if x.id == tid), None)
            out_task = t3.to_dict() if t3 else None
            ok_steps = bool(t3 and t3.workflow_steps)
        return {"ok": True, "workflow_applied": ok_steps, "task": out_task, "orchestrate": result}

