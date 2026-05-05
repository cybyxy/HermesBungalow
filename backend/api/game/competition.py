"""
任务竞争模块（Task Competition）

触发条件：任务仅需1人 + 同职业空闲Agent≥2人举手
抽签方式：纯随机（secrets.randbelow，密码学安全）
奖惩规则：见 PRD v2.0 §3

WebSocket 广播类型：
- competition:start  — 竞争开始
- competition:result — 结果公示
"""
from __future__ import annotations

import os
import secrets
import time
from dataclasses import dataclass
from typing import Any

# ── 常量 ────────────────────────────────────────────────────────────────────

LOTTERY_ANIMATION_MS = 3000
MIN_CANDIDATES = 2
WIN_REWARD_RANGE = (8, 15)
LOSS_MOOD_RANGE = (-10, -5)
LOSS_RELATION_RANGE = (-5, -3)
DOUBLE_PENALTY_MOOD_RANGE = (-50, -30)
DOUBLE_PENALTY_THRESHOLD = 3  # 连续失败 ≥ 3 次触发加倍惩罚

# ── 随机来源 ────────────────────────────────────────────────────────────────
# 生产：secrets（密码学安全）；调试：random.Random（种子可配置）
_DEBUG = os.getenv("COMPETITION_DEBUG", "false").lower() == "true"
_DEBUG_SEED = int(os.getenv("COMPETITION_DEBUG_SEED", "42"))

if _DEBUG:
    _rng = __import__("random").Random(_DEBUG_SEED)
    _secure_randbelow = _rng.randbelow
else:
    _secure_randbelow = secrets.randbelow


# ── 数据结构 ────────────────────────────────────────────────────────────────

@dataclass
class CompetitionResult:
    task_id: int
    task_name: str
    winner_id: str
    loser_ids: list[str]
    winner_reward: int
    loser_moods: dict[str, int]
    loser_relations: dict[str, int]
    double_penalty: bool
    animation_ms: int
    timestamp: int


# ── 核心逻辑 ────────────────────────────────────────────────────────────────

def trigger_competition(task: Any, world_agents: list[Any]) -> list[str]:
    """检测是否满足竞争触发条件。

    条件：任务仅需1人 + 同职业空闲Agent≥2人举手
    返回举手Agent id列表，不满足返回空列表。
    """
    if not task.is_collaborative and getattr(task, "required_count", 1) == 1:
        idle = [a for a in world_agents if getattr(a, "status", None) == "idle"]
        if len(idle) >= MIN_CANDIDATES:
            return [a.id for a in idle]
    return []


def run_lottery(candidate_ids: list[str]) -> str:
    """从候选列表中用密码学安全随机选中赢家。"""
    return candidate_ids[_secure_randbelow(len(candidate_ids))]


def _rand_in_range(lo: int, hi: int) -> int:
    """返回 [lo, hi] 范围内的随机整数（闭区间）。"""
    if lo >= hi:
        return lo
    return lo + _secure_randbelow(hi - lo + 1)


def resolve_competition(
    task_id: int,
    task_name: str,
    winner_id: str,
    loser_ids: list[str],
    consecutive_losses: dict[str, int],
) -> CompetitionResult:
    """计算奖惩数值，返回完整竞争结果。"""
    winner_reward = _rand_in_range(*WIN_REWARD_RANGE)
    loser_moods: dict[str, int] = {}
    loser_relations: dict[str, int] = {}
    double_penalty = False

    for lid in loser_ids:
        losses = consecutive_losses.get(lid, 0)
        if losses >= DOUBLE_PENALTY_THRESHOLD:
            # 加倍惩罚
            mood_delta = _rand_in_range(*DOUBLE_PENALTY_MOOD_RANGE)
            double_penalty = True
        else:
            mood_delta = _rand_in_range(*LOSS_MOOD_RANGE)
        relation_delta = _rand_in_range(*LOSS_RELATION_RANGE)
        loser_moods[lid] = mood_delta
        loser_relations[lid] = relation_delta

    return CompetitionResult(
        task_id=task_id,
        task_name=task_name,
        winner_id=winner_id,
        loser_ids=loser_ids,
        winner_reward=winner_reward,
        loser_moods=loser_moods,
        loser_relations=loser_relations,
        double_penalty=double_penalty,
        animation_ms=LOTTERY_ANIMATION_MS,
        timestamp=int(time.time()),
    )


# ── WebSocket 广播 ─────────────────────────────────────────────────────────

def build_ws_payload_start(result: CompetitionResult) -> dict[str, Any]:
    return {
        "type": "competition:start",
        "task_id": result.task_id,
        "task_name": result.task_name,
        "participants": [result.winner_id] + result.loser_ids,
        "estimated_duration_ms": result.animation_ms,
    }


def build_ws_payload_result(result: CompetitionResult) -> dict[str, Any]:
    rewards = {result.winner_id: result.winner_reward}
    penalties: dict[str, dict[str, int]] = {}
    for lid in result.loser_ids:
        p = {"mood": result.loser_moods[lid]}
        if result.double_penalty:
            p["double_penalty"] = True
        penalties[lid] = p
        if result.loser_relations.get(lid):
            penalties[lid]["relationship_delta"] = result.loser_relations[lid]

    return {
        "type": "competition:result",
        "task_id": result.task_id,
        "winner": result.winner_id,
        "losers": result.loser_ids,
        "rewards": rewards,
        "penalties": penalties,
        "double_penalty": result.double_penalty,
        "timestamp": result.timestamp,
    }


# ── 状态管理 ────────────────────────────────────────────────────────────────

# {agent_id: consecutive_loss_count}
_consecutive_losses: dict[str, int] = {}


def record_loss(agent_id: str) -> None:
    _consecutive_losses[agent_id] = _consecutive_losses.get(agent_id, 0) + 1


def record_win(agent_id: str) -> None:
    """赢家计数归零"""
    _consecutive_losses[agent_id] = 0


def get_consecutive_losses(agent_id: str) -> int:
    return _consecutive_losses.get(agent_id, 0)


# ── 一站式竞务处理（供 service.py 调用）──────────────────────────────────────

def resolve_task_competition(
    task: Any,
    world_agents: list[Any],
    broadcast_fn: Any,
) -> CompetitionResult | None:
    """竞争抽签 → 结算奖惩 → 广播。

    Args:
        task: Task 对象
        world_agents: 游戏世界所有 Agent 列表
        broadcast_fn: 广播函数，签名为 (event_type: str, payload: dict) -> None

    Returns:
        CompetitionResult（service.py 已在 len(candidates)>=2 时调用本函数）
    """
    # service.py assign_task 已保证：candidates = 空闲 Agent 列表（不限职业）
    candidates = [a for a in world_agents if getattr(a, "status", None) == "idle"]
    if len(candidates) < MIN_CANDIDATES:
        return None

    loser_ids = [c for c in candidates]
    winner_id = run_lottery(candidates)
    loser_ids.remove(winner_id)

    # 结算奖惩
    result = resolve_competition(task.id, task.name, winner_id, loser_ids, _consecutive_losses)

    # 更新连续失败计数
    record_win(winner_id)
    for lid in loser_ids:
        record_loss(lid)

    # 广播 competition:start
    try:
        broadcast_fn("competition:start", build_ws_payload_start(result))
    except Exception:
        pass

    # 广播 competition:result（动画结束后，由调用方控制延迟）
    try:
        broadcast_fn("competition:result", build_ws_payload_result(result))
    except Exception:
        pass

    return result
