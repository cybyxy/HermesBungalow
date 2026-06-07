from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class Agent:
    id: str
    name: str
    display_name: str = ""   # 中文昵称，用于头像显示（如"马斯特"），空则取 name
    profession: str = ""
    profile: str = "default"
    gender: str = "male"
    catchphrase: str = ""
    personality: str = ""
    memes: list[str] = field(default_factory=list)
    avatar: str = ""          # 头像路径，从 SOUL.md 读取
    reasoning_model: str = "auto"
    channel: str = ""          # 外部渠道平台 key（feishu/discord/telegram/...），空=无
    current_task_id: int | None = None
    hermes_session_id: str | None = None
    skills: list[dict[str, Any]] = field(default_factory=list)  # [{name, level}]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Task:
    id: int
    name: str
    description: str = ""
    progress: float = 0.0
    status: str = "pending"
    assignee_id: str | None = None
    required_profession: str = "程序员"
    difficulty: int = 2
    reward: int = 100
    quality: int = 0
    estimated_hours: float = 2.0
    is_collaborative: bool = False
    collaboration_bonus: float = 0.3
    subtasks: list[dict[str, Any]] = field(default_factory=list)
    due_at: str = ""
    deliverables: str = ""
    acceptance_criteria: str = ""
    catalog: str = ""
    """LLM / SKILL 规划的可执行步骤（写入存档 JSON；见 ``task_workflow_plan`` GAME_EVENT）。"""
    workflow_steps: list[dict[str, Any]] = field(default_factory=list)
    """任务级前置依赖：这些任务 ID 全部完成前，本任务处于 locked 状态。"""
    depends_on: list[int] = field(default_factory=list)
    """父任务 ID（批量创建时自动设定），0 表示顶层任务。"""
    parent_task_id: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TaskWorld:
    agents: list[Agent] = field(default_factory=list)
    tasks: list[Task] = field(default_factory=list)
    event_log: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "agents": [a.to_dict() for a in self.agents],
            "tasks": [t.to_dict() for t in self.tasks],
            "event_log": list(self.event_log),
        }


