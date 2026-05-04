# 后端 API 架构设计 · v2.0

> 版本：v2.0 | 状态：起草中 | 作者：马斯特 | 日期：2026-05-04

---

## 1. 模块定位

`competition.py` 是任务竞争模块的独立实现单元，职责：
- 抽签算法（密码学安全随机）
- 奖惩数值计算
- WebSocket 广播 payload 构建
- 连续失败计数状态管理

**不涉及**：HTTP 路由（routes.py）、持久化（persistence.py）、LLM 推理（agent.py）。

---

## 2. 核心数据流

```
assign_task (service.py)
    ↓ len(candidates) >= 2
resolve_task_competition (competition.py)
    ├─ run_lottery()       ← secrets.randbelow 选赢家
    ├─ resolve_competition() ← 奖惩数值计算
    ├─ record_win/loss()   ← 连续失败计数
    ├─ _broadcast("competition:start", ...)
    └─ _broadcast("competition:result", ...)
    ↓
service.py 更新 task.status / agent.status，写 event_log
```

---

## 3. 随机算法

### 3.1 生产环境

```python
import secrets
winner = candidates[secrets.randbelow(len(candidates))]
```

- `secrets` 模块使用系统 CSPRNG，密码学安全，不可预测
- 无需种子，结果不可复现

### 3.2 调试模式（可选）

```python
import random
r = random.Random(42)          # 固定种子
winner = candidates[r.randbelow(len(candidates))]
```

- 通过环境变量 `COMPETITION_DEBUG=true` 切换
- 42 为固定种子值，可配置

---

## 4. WebSocket 消息格式

### 4.1 competition:start（竞争开始）

```json
{
  "type": "competition:start",
  "task_id": 1,
  "task_name": "修复验证码失效问题",
  "participants": ["pymaster", "uiwizard"],
  "estimated_duration_ms": 3000
}
```

- 前端收到后显示竞争公示弹窗，启动 3 秒抽签动画
- `estimated_duration_ms` = 固定 3000，前端以此控制动画时长

### 4.2 competition:result（结果公示）

```json
{
  "type": "competition:result",
  "task_id": 1,
  "winner": "pymaster",
  "losers": ["uiwizard"],
  "rewards": {
    "pymaster": 12
  },
  "penalties": {
    "uiwizard": {
      "mood": -7,
      "relationship_delta": -4
    }
  },
  "double_penalty": false,
  "timestamp": 1746326400
}
```

- `rewards` / `penalties` 字段供前端展示数值来源
- `double_penalty: true` 时，penalties 里的 mood 为 -30 ~ -50

---

## 5. event_logs 表结构

### 5.1 表定义

```sql
CREATE TABLE IF NOT EXISTS event_logs (
    id          TEXT    PRIMARY KEY,
    event_type  TEXT    NOT NULL,          -- 'task_assign' | 'competition_result' | ...
    timestamp   INTEGER NOT NULL,          -- Unix time
    task_id     INTEGER,
    ext         TEXT,                      -- JSON 扩展字段
    agent_id    TEXT
);
```

### 5.2 competition_result 事件 ext 字段

```json
{
  "winner_id": "pymaster",
  "loser_ids": ["uiwizard"],
  "winner_reward": 12,
  "loser_moods": {"uiwizard": -7},
  "loser_relations": {"uiwizard": -4},
  "double_penalty": false,
  "task_name": "修复验证码失效问题"
}
```

---

## 6. 连续失败计数器

### 6.1 存储结构

进程内字典（重启清零，atexit 时持久化到 event_log）：

```python
# competition.py
_consecutive_losses: dict[str, int] = {}   # {agent_id: count}
```

### 6.2 状态转换

| 事件 | 动作 |
|------|------|
| 竞争中输 | `_consecutive_losses[agent_id] += 1` |
| 竞争中赢 | `_consecutive_losses[agent_id] = 0` |
| 加倍惩罚触发 | 条件：`count >= 3`，mood 惩罚改为 -30 ~ -50 |

- 计数跨任务累加，不清零（除非赢得竞争）

---

## 7. 奖惩数值表（引用自 PRD v2.0）

| 结果 | 类型 | 数值 |
|------|------|------|
| **中签** | 积分奖励 | `+8 ~ +15` |
| **未中签** | 积分扣除 | `-5 ~ -10` |
| **未中签** | 关系损伤 | `-3 ~ -5` |
| **加倍惩罚**（连续≥3次失败） | 积分扣除 | `-30 ~ -50` |

| 参数 | 值 |
|------|-----|
| 抽签方式 | 纯公平随机，无加权 |
| 动画时长 | 固定 3 秒，不可配置 |
| 城主干预 | 不可干预 |
| 连续失败计数 | 跨任务累加，不清零 |

---

## 8. 与 multi_agent_gateway 的集成方案

### 8.1 现状

`multi_agent_gateway.py` 与 `agent.py` 相互独立，无相互导入。

### 8.2 演进路线（v2.0+）

Gateway 纳管方案：

```
前端 WebSocket
    ↓
multi_agent_gateway.py   ← 统一接入层，消息路由
    ├─ 转发 Agent 消息到 agent.py
    ├─ 广播 competition:* 消息
    └─ 管理连接会话
agent.py                 ← LLM 推理，不处理连接
competition.py           ← 竞争逻辑，供 service.py 调用
service.py               ← 游戏状态管理
```

- v2.0：**暂不拆分进程**，service.py 直接调用 `competition.py`
- v2.x：gateway 作为 sidecar 独立进程，通过内部 HTTP/SSE 与 Agent 通信

### 8.3 当前集成点

`service.py` 在 `assign_task` 中调用 `resolve_task_competition`，由 `GameService._broadcast` 发送到所有 WebSocket 客户端（前端 + gateway）。

---

## 9. 已确认事项

| 事项 | 决策 | 理由 |
|------|------|------|
| 调试随机种子注入方式 | 环境变量 `COMPETITION_DEBUG=true` + `COMPETITION_DEBUG_SEED=42`，可配置 | 固定种子不灵活，需支持不同场景 |
| event_logs 持久化频率 | 每次竞争后同步写入 | 竞争非高频，数据完整性 > 性能；计数器存进程内存，异常退出记录不丢 |
| 连续失败计数器持久化 | 进程内存，暂不持久化 | 重启清零可接受，不影响核心逻辑 |
