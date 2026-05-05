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
    status: str = "idle"  # idle | working | resting | social | walking
    location: str = "休息室"
    energy: int = 80
    mood: int = 70
    affection: int = 60
    relation: int = 40
    focus: int = 80
    sleepiness: int = 10
    satiety: int = 80
    speed: float = 1.0
    catchphrase: str = ""
    personality: str = ""
    memes: list[str] = field(default_factory=list)
    avatar: str = ""          # 头像路径，从 SOUL.md 读取
    reasoning_model: str = "auto"
    current_task_id: int | None = None
    hermes_session_id: str | None = None
    skills: list[dict[str, Any]] = field(default_factory=list)  # [{name, level}]

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        # 综合健康值 = energy * 0.4 + satiety * 0.6
        d["health"] = int(self.energy * 0.4 + self.satiety * 0.6)
        # 短板值（触发警告用）
        d["health_critical"] = min(self.energy, self.satiety)
        return d


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

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Room:
    id: str
    name: str
    type: str = "fixed"  # fixed | office
    agent_ids: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GameWorld:
    day: int = 1
    time: str = "08:30"
    money: int = 1250
    lord_level: int = 1
    lord_xp: int = 0
    agents: list[Agent] = field(default_factory=list)
    tasks: list[Task] = field(default_factory=list)
    rooms: list[Room] = field(default_factory=list)
    competition_history: list[dict[str, Any]] = field(default_factory=list)
    event_log: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "time": self.time,
            "money": self.money,
            "lord_level": self.lord_level,
            "lord_xp": self.lord_xp,
            "agents": [a.to_dict() for a in self.agents],
            "tasks": [t.to_dict() for t in self.tasks],
            "rooms": [r.to_dict() for r in self.rooms],
            "competition_history": list(self.competition_history),
            "event_log": list(self.event_log),
            # 健康警告阈值（江定策方案）
            "alert_thresholds": {
                "health_critical": 60,   # 短板值低于此值 → red alert
                "health_warning": 85,    # 综合健康值低于此值 → yellow warning
            },
        }


def default_world() -> GameWorld:
    agents = [
        Agent(
            id="A",
            name="阿猿",
            profession="程序员",
            status="working",
            location="办公室1",
            energy=75,
            mood=80,
            affection=85,
            relation=45,
            catchphrase="代码即艺术",
            personality="逻辑严谨",
        ),
        Agent(
            id="B",
            name="小美",
            profession="设计师",
            status="idle",
            location="休息室",
            energy=90,
            mood=75,
            relation=40,
            catchphrase="设计改变世界",
            personality="活泼开朗",
        ),
        Agent(
            id="C",
            name="点点",
            profession="测试员",
            status="resting",
            location="休息室",
            energy=60,
            mood=85,
            relation=50,
            catchphrase="bug无处藏身",
            personality="细心严谨",
        ),
        Agent(
            id="D",
            name="数据帝",
            profession="分析师",
            status="working",
            location="资料室",
            energy=55,
            mood=70,
            relation=48,
            catchphrase="数据不会骗人",
            personality="理性冷静",
        ),
    ]
    tasks = [
        Task(
            id=1,
            name="设计登录页面",
            progress=65,
            status="in_progress",
            assignee_id="A",
            required_profession="程序员",
            difficulty=2,
            reward=100,
            quality=85,
            is_collaborative=True,
        ),
        Task(
            id=2,
            name="编写API接口",
            progress=30,
            status="pending",
            assignee_id=None,
            required_profession="程序员",
            difficulty=3,
            reward=150,
        ),
        Task(
            id=3,
            name="测试支付模块",
            progress=80,
            status="in_progress",
            assignee_id="C",
            required_profession="测试员",
            difficulty=2,
            reward=80,
            quality=90,
        ),
    ]
    rooms = [
        Room(id="king", name="城主办公室", type="fixed"),
        Room(id="rest", name="休息室", type="fixed", agent_ids=[]),
        Room(id="archive", name="资料室", type="fixed"),
        Room(id="meet", name="会议室", type="fixed"),
        Room(id="server", name="机房", type="fixed"),
    ]
    for i in range(1, 9):
        rooms.append(Room(id=f"office{i}", name=f"办公室{i}", type="office"))
    return GameWorld(agents=agents, tasks=tasks, rooms=rooms)
