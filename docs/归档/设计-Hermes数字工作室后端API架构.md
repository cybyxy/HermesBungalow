# Hermes 数字工作室 — 后端 API 架构设计

> 归档时间：2026-05-01
> 状态：已确认，暂不实现

---

## 定位

Python 服务端 = **游戏逻辑 API + hermes-webui 全量 API**（无静态文件、无前端托管）

前端为独立的 Next.js 项目，**只连接后端一个端口**，所有实时通信（WebSocket + SSE）由 Gateway 统一汇聚。

---

## 整体架构

```
                         ┌─────────────────────────────────────┐
                         │          前端 Next.js               │
                         │   (只连 ws://host:port/gateway)     │
                         └──────────────┬──────────────────────┘
                                        │ WebSocket + SSE 统一接入
                         ┌──────────────▼──────────────────────┐
                         │           Gateway 统一入口            │
                         │         (单端口，ws + SSE)            │
                         │                                     │
                         │  ┌─────────┐  ┌─────────┐            │
                         │  │ 聊天流  │  │ 游戏事件 │            │
                         │  │ 路由    │  │ 路由    │            │
                         │  └────┬────┘  └────┬────┘            │
                         └───────┼────────────┼─────────────────┘
                    ┌────────────┼────────────┼────────────────┐
                    │            ▼            ▼                │
                    │  ┌──────────────┐  ┌──────────────┐      │
                    │  │ hermes API  │  │  Game API    │      │
                    │  │ (原api/*)   │  │  (game/*)   │      │
                    │  └──────────────┘  └──────────────┘      │
                    │       Python 后端                        │
                    └──────────────────────────────────────────┘
```

---

## Gateway 设计

### 核心职责

Gateway 是后端唯一的对外实时通信入口，合并了原来 hermes-webui 的 `/ws/caicai`（WebSocket）和 `/api/task/events`（SSE）两条通道。

### 统一消息格式

前端与 Gateway 之间所有通信统一使用 JSON 消息帧：

```json
// 客户端 → 服务端
{ "type": "chat", "message": "你好" }
{ "type": "game_event_sub", "channels": ["competition", "social"] }
{ "type": "ping" }

// 服务端 → 客户端
{ "type": "chat_stream", "content": "你好", "done": false }
{ "type": "chat_done", "content": "完整回复" }
{ "type": "game_event", "channel": "competition", "data": { ... } }
{ "type": "pong" }
```

### type 类型定义

| type | 方向 | 说明 |
|------|------|------|
| `chat` | C→S | 发送聊天消息 |
| `chat_stream` | S→C | 聊天流式响应 |
| `chat_done` | S→C | 聊天完成 |
| `game_event_sub` | C→S | 订阅游戏事件频道 |
| `game_event` | S→C | 游戏事件推送 |
| `ping` | C→S | 心跳保活 |
| `pong` | S→C | 心跳响应 |
| `error` | S→C | 错误信息 |

### 游戏事件频道

| 频道 | 说明 |
|------|------|
| `competition` | 任务竞争结果 |
| `social` | 打招呼/协作事件 |
| `task` | 任务状态变更 |
| `agent_status` | Agent 状态变更 |

---

## hermes-webui API 模块（全量搬迁）

来源路径：`/Users/bobo/ai_projects/hermes-webui/api/`

| 文件 | 说明 |
|------|------|
| `__init__.py` | 模块初始化 |
| `agent_sessions.py` | Agent 会话管理 |
| `auth.py` | 认证/登录 |
| `background.py` | 后台任务 |
| `clarify.py` | 澄清提示 |
| `commands.py` | 命令处理 |
| `config.py` | 配置管理 |
| `gateway_watcher.py` | 网关监听 |
| `helpers.py` | 辅助函数 |
| `metering.py` | 用量计量 |
| `models.py` | Session 数据模型 |
| `onboarding.py` | 引导流程 |
| `profiles.py` | Profile 管理 |
| `providers.py` | AI Provider 配置 |
| `routes.py` | REST 路由入口（handle_get/handle_post） |
| `session_ops.py` | 会话 CRUD |
| `startup.py` | 启动初始化 |
| `state_sync.py` | 状态同步 |
| `streaming.py` | 流式响应（内部供 Gateway 调用） |
| `updates.py` | 版本更新 |
| `upload.py` | 文件上传/转录 |
| `workspace.py` | Workspace 管理 |

hermes-webui 的 `server.py` 和 `static/` 目录**不搬迁**（前端独立）。

---

## 游戏逻辑模块（新增）

### 数据模型

#### Agent（角色）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 名称 |
| profession | string | 职业 |
| gender | string | 性别 |
| status | enum | idle / working / resting / social / walking |
| location | string | 所在房间 ID |
| energy | int | 能量 0-100 |
| mood | int | 情绪 0-100 |
| affection | int | 好感度（与城主）0-100 |
| relation | int | 关系值（同伴间）0-100 |
| focus | int | 专注度 0-100 |
| sleepiness | int | 睡意 0-100 |
| satiety | int | 饱食度 0-100 |
| speed | float | 工作速度倍率 |
| catchphrase | string | 口头禅 |
| personality | string | 性格特点 |
| memes | string[] | 已解锁的梗 |
| reasoning_model | string | 推理模型 |
| soul_md | string | soul.md 内容（来自 Hermes profile） |
| memory_md | string | memory.md 内容（来自 Hermes profile） |
| profession_skills | dict | 职业能力 |
| current_task_id | int? | 当前任务 ID |

#### Task（任务）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | int | 唯一标识 |
| name | string | 任务名称 |
| description | string | 描述 |
| progress | float | 进度 0-100 |
| status | enum | pending / in_progress / completed / failed |
| assignee_id | string? | 分配对象 Agent ID |
| required_profession | string | 所需职业 |
| difficulty | int | 难度 1-5 |
| reward | int | 积分奖励 |
| quality | int | 质量评分 0-100 |
| estimated_hours | float | 预计小时数 |
| is_collaborative | bool | 是否协作任务 |
| collaboration_bonus | float | 协作加成 |
| subtasks | dict[] | 子任务列表 |

#### Room（房间）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 唯一标识 |
| name | string | 名称 |
| type | enum | fixed（固定房间）/ office（办公室） |
| agents | string[] | 在房间中的 Agent ID 列表 |

#### TaskWorld（游戏世界）

| 字段 | 类型 | 说明 |
|------|------|------|
| day | int | 游戏天数 |
| time | string | 游戏时间 HH:MM |
| money | int | 积分 |
| lord_level | int | 城主等级 |
| lord_xp | int | 城主经验值 |
| agents | Agent[] | 所有 Agent |
| tasks | Task[] | 所有任务 |
| rooms | Room[] | 所有房间 |
| competition_history | dict[] | 竞争历史记录 |

---

## REST API 端点

### hermes-webui REST（来自搬迁）

| 方法 | 路径 | 说明 |
|------|------|------|
| * | `/api/*` | 全部 hermes-webui REST API（原样搬迁） |

### 游戏 REST

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/task/state` | 获取完整游戏状态 |
| GET | `/api/task/rooms` | 获取所有房间列表 |
| GET | `/api/task/agents` | 获取所有 Agent |
| GET | `/api/task/tasks` | 获取所有任务 |
| POST | `/api/task/agent` | 添加新 Agent |
| POST | `/api/task/agent/update` | 更新 Agent 属性 |
| POST | `/api/task/agent/move` | 移动 Agent 到房间 |
| POST | `/api/task/task` | 创建任务 |
| POST | `/api/task/task/assign` | 分配任务（含竞争判定） |
| POST | `/api/task/greeting` | 触发打招呼 |
| POST | `/api/task/collaboration` | 触发协作任务 |
| GET | `/api/task/competition/history` | 获取竞争历史记录 |

---

## 任务竞争机制

### 触发条件

主 Agent（城主/AI）分配任务时，发现同职业 Agent ≥ 2 人。

### 判定流程

1. 收集所有该职业的 Agent
2. 纯随机抽签决定赢家（非先到先得，非举手）
3. **赢家**：情绪 +8~15
4. **输家**：情绪 -5~10
5. 任务完成后评估质量（由 AI 或预设逻辑判断）
6. 若质量差（< 50 分），赢家情绪额外加倍扣除

### 竞争结果广播

通过 Gateway 的 `game_event` 推送给订阅了 `competition` 频道的前端，前端播放 3 秒动画（宣布→抽签→结果）。

---

## 社交机制

### 打招呼

- **触发房间**：休息室 / 会议室 / 资料室 / 机房
- **条件**：关系值 ≥ 11，**同职业不触发**（竞争关系）
- **冷却时间**：10 分钟
- **效果**：关系值 +1（上限 100）
- **内容**：AI 实时生成，不预配置
- **推送**：通过 Gateway 的 `game_event`（频道 `social`）推送

### 协作任务

- **触发**：任务需要多职业配合
- **效果**：效率 +≤30%，质量 +≤20%
- **实现**：AI 推理判断复杂度 → 主 Agent 分配（不支持 Agent 自主发起）

---

## 关系阶段

| 阶段 | 范围 | 说明 |
|------|------|------|
| 陌生 | 0-10 | 初始关系 |
| 认识 | 11-30 | 可打招呼 |
| 朋友 | 31-70 | 可协作 |
| 挚友 | 71-100 | 上限，无恋人阶段 |

---

## 初始关系值

- 主 Agent ↔ Agent：100/100（满值）
- Agent ↔ Agent：40/20（竞争心态）

---

## 服务端目录结构

```
HermesBungalow/server/
├── main.py              # 服务器入口
├── gateway.py            # 统一 WebSocket+SSE 网关（新增）
├── requirements.txt     # Python 依赖
└── api/
    ├── __init__.py
    ├── routes.py         # REST 路由（handle_get/handle_post）
    │
    ├── # ── hermes-webui 全量模块 ──────────────────────────
    ├── agent_sessions.py
    ├── auth.py
    ├── background.py
    ├── clarify.py
    ├── commands.py
    ├── config.py
    ├── gateway_watcher.py
    ├── helpers.py
    ├── metering.py
    ├── models.py
    ├── onboarding.py
    ├── profiles.py
    ├── providers.py
    ├── session_ops.py
    ├── startup.py
    ├── state_sync.py
    ├── streaming.py
    ├── updates.py
    ├── upload.py
    ├── workspace.py
    │
    └── game/             # 游戏逻辑（新增）
        ├── __init__.py
        ├── models.py
        ├── world.py
        ├── competition.py
        └── social.py
```

---

## 技术要求

- 服务器端**不托管任何静态文件**（前端独立部署）
- 前端 Next.js 只连接后端 **Gateway 端口**（WebSocket）
- REST API 走同一端口的 HTTP 路径（`/api/*`）
- 游戏时间流：每 5 秒 = 游戏 1 分钟（真实 1:1 模拟）
- 睡意/饱食等数值真实自然增长，非加速模拟
