# API 契约真源表（PRD × 后端架构 × 规划-API）

> 与实现对照：Python 入口 [backend/server.py](../backend/server.py)（原规划中的 `routes.py` 由 Starlette 路由表替代），游戏域 [backend/api/game/](../backend/api/game/)。
> 基线端口：`http://127.0.0.1:8000`（与 [frontend/vite.config.ts](../frontend/vite.config.ts) 代理一致）。
>
> **文档状态**：v1.1（正式版）— 新增 WebSocket 细化、agent_server.py 职责边界、推送频率控制

---

## 0. 后端服务职责边界

### 0.1 服务划分

| 服务 | 进程 | 端口 | 职责 |
|------|------|------|------|
| `server.py` | 游戏主进程 | `:8000` | 游戏状态唯一事实来源（SQLite）、REST API、WebSocket Gateway |
| `agent_server.py` | per-agent 子进程 | `:8001~` | Hermes Agent 对话推理、SSE 流式输出、Agent 私有状态 |

### 0.2 agent_server.py 职责（每个 Agent 独立进程）

```
职责：
├── 接收 Hermes 对话请求（/api/chat/start + /api/chat/stream）
├── 调用 LLM 推理生成回复（使用自己的 SOUL.md / memory.md / skills）
├── 通过 SSE 流式输出推理过程（delta / tool_call / stream_end）
├── 维护 Agent 私有会话状态（session_id ↔ 对话历史）
└── 不参与游戏状态读写

不负责：
├── 游戏状态管理（SQLite 读写）→ server.py
├── Agent 移动/任务分配/社交逻辑 → server.py
└── WebSocket Gateway 广播 → server.py
```

### 0.3 server.py 职责（游戏主进程）

```
职责：
├── 游戏状态管理（GameWorld SQLite 持久化）
├── REST API（/api/game/*）— Agent/任务/房间/存档 CRUD
├── WebSocket Gateway（/ws/gateway）— 广播游戏事件到前端
├── LLM 事件标签解析（/api/game/llm/apply-tags）— 解析 [[GAME_EVENT:...]]
├── 游戏 Tick 推进（/api/game/tick）
└── agent_server.py 子进程生命周期管理

不负责：
├── LLM 对话推理 → agent_server.py
├── Agent 私有会话历史 → agent_server.py
└── 前端 UI 渲染 → 前端
```

### 0.4 服务间通信

```
前端 ←→ server.py (:8000)
         ├── REST /api/game/*（游戏状态读写）
         └── WebSocket /ws/gateway（游戏事件推送）
              ↕（内部调用）
         agent_server.py (:8001~)（LLM 推理，SSE 流）
```

## 一、REST（游戏域 `/api/game/*`）

设计来源：[docs/设计-Hermes 数字工作室后端API架构.md](./设计-Hermes 数字工作室后端API架构.md)「游戏 REST」。

| 方法 | 路径 | 说明 | 实现状态 |
|------|------|------|----------|
| GET | `/health` | 服务健康 | 有 |
| GET | `/api/game/state` | 完整 `GameWorld` JSON | 有 |
| GET | `/api/game/agents` | Agent 列表 | 有 |
| GET | `/api/game/tasks` | 任务列表 | 有 |
| GET | `/api/game/rooms` | 房间列表 | 有 |
| POST | `/api/game/agent` | 添加 Agent（body JSON） | 有 |
| POST | `/api/game/agent/update` | 更新 Agent 字段 | 有 |
| POST | `/api/game/agent/move` | `{ agent_id, room_id }` | 有 |
| POST | `/api/game/task` | 创建任务 | 有 |
| POST | `/api/game/task/assign` | 分配任务（含简单竞争） | 有 |
| POST | `/api/game/greeting` | 触发打招呼（占位 + 事件） | 有 |
| POST | `/api/game/collaboration` | 协作占位 + 事件 | 有 |
| GET | `/api/game/competition/history` | 竞争历史 | 有 |
| GET | `/api/game/save` | 读取存档元数据 / 快照 | 有 |
| PUT | `/api/game/save` | 写入存档快照 | 有 |
| POST | `/api/game/llm/apply-tags` | 解析 LLM 文本中的游戏事件标签并应用 | 有 |
| POST | `/api/game/tick` | 推进游戏内时间（body 可选 `{ "minutes": N }`，默认 1 分钟/次） | 有 |

> **Hermes 对话（里程碑 B）**  
> - 当前实现改为 **hermes-webui `api/` 全量搬迁** 到 `backend/api`，并由 `backend/server.py` 桥接调用搬迁路由。  
> - 推理模型调用采用搬迁后 providers/runtime-provider 体系（`providers.py` + `streaming.py`），不再使用本地 mock 生成回复。  
> - 与游戏 API 同端口共存：`/api/game/*` 保留在 Starlette 路由层，Hermes 通用接口经 `/api/*` 桥接进入搬迁模块。

### Hermes REST（同应用，可选）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/session/new` | 创建会话（搬迁 `session_ops`），返回 `session` 对象（含 `session_id`） |
| POST | `/api/chat/start` | `{ session_id, message, attachments?, workspace?, model? }`，返回 `{ stream_id, session_id, ... }` |
| GET | `/api/chat/stream?stream_id=...` | SSE 流；`event:` 包含 `delta` / `tool_call` / `stream_end` / `apperror` / `cancel` 等 |
| GET | `/api/providers` | providers 配置状态（是否有 key、来源、模型清单） |
| POST | `/api/providers` | 更新 provider key（写入 `~/.hermes/.env` / config） |
| GET | `/api/models` | 模型分组与默认模型（按 provider/config 动态解析） |

Hermes 推理接入关键环境变量：

| 变量 | 说明 |
|------|------|
| `HERMES_HOME` | Hermes 配置根目录（默认 `~/.hermes`） |
| `HERMES_WEBUI_AGENT_DIR` | hermes-agent 路径（找不到时会禁用部分能力） |
| `HERMES_CONFIG_PATH` | 显式指定 `config.yaml` |
| `HERMES_WEBUI_DEFAULT_WORKSPACE` | 默认工作区路径 |

> 说明：若 provider 未配置有效凭据，`/api/chat/stream` 会输出 `event: apperror`，并在 `data` 中包含错误原因与提示。

## 游戏快照字段补充

| 字段 | 说明 |
|------|------|
| `event_log` | 近期操作日志（移动、分配、打招呼、LLM 标签等），最多约 80 条 |
| `rooms[].agent_ids` | 与 `agents[].location` 同步维护的房间占用列表 |

## 二、Gateway WebSocket（`WS /ws/gateway`）

设计来源：架构文档「统一消息格式」；环境变量 `GATEWAY_ENABLED=1`（默认开启）。

单帧文本消息建议不超过 **64KB**（超出返回 `payload_too_large`）。

### 2.1 状态版本控制

| 字段 | 说明 | 用途 |
|------|------|------|
| `seq` | 消息序列号（整数，从 1 开始单调递增） | 检测消息丢失/乱序 |
| `snapshot_seq` | 最近一次 `state:snapshot` 的序列号 | 客户端请求增量同步基准 |

**重连流程**：
1. 客户端记录最后收到的 `seq`
2. 连接后发送 `{type: "sync_request", last_seq: N}`（可选）
3. 服务端返回 `state:snapshot`（`seq = snapshot_seq`）用于全量同步
4. 缺失消息通过 `state:snapshot` 补齐，不单独补发中间消息

### 2.2 心跳与超时

| 配置 | 值 |
|------|-----|
| 客户端 ping 间隔 | 30 秒 |
| 服务端 pong 响应 | 立即 |
| 连接超时阈值 | 60 秒无消息则断开 |
| 重连策略 | 指数退避（1s → 2s → 4s → 8s → max 30s） |

### 2.3 推送频率控制

| 优先级 | 触发条件 | 推送时机 |
|--------|----------|----------|
| **P0 高** | Agent 移动、任务状态变更、事件触发、通知 | 状态变化时立即推送 |
| **P1 中** | 数值变化（能量/专注力/情绪）、冷却状态 | 每秒最多 1 次（防刷） |
| **P2 低** | 完整状态快照（初始化/手动刷新） | 按需，限制频率 |

**防刷机制**：同一 `agent_id` 的高频属性变更（P1）合并为批量消息，单帧最多承载 10 个属性变更。

### 2.4 客户端 → 服务端

| type | 字段 | 说明 |
|------|------|------|
| `chat` | `message` | 聊天（演示：回显 + 可选解析标签） |
| `game_event_sub` | `channels` | 订阅频道数组 |
| `ping` | — | 心跳 |
| `sync_request` | `last_seq` | 重连后请求增量同步（可选） |

### 2.5 服务端 → 客户端

| type | 字段 | 说明 |
|------|------|------|
| `chat_stream` | `delta` | 流式片段（演示） |
| `chat_done` | `final_content` | 聊天结束 |
| `game_event` | `channel`, `data`, `seq` | 游戏事件推送（含序列号） |
| `state:snapshot` | `data`, `snapshot_seq` | 全量状态快照 |
| `pong` | — | 心跳响应 |
| `error` | `code`, `message` | 错误信息 |
| `payload_too_large` | `size` | 消息超限 |

### 2.6 游戏事件频道

| channel | 说明 | 优先级 |
|---------|------|--------|
| `competition` | 任务竞争结果 | P0 |
| `social` | 打招呼 / 社交 | P0 |
| `task` | 任务状态变更 | P0 |
| `agent_status` | Agent 状态变更（移动/情绪/数值） | P0/P1 |

### 2.7 错误处理与降级

| 错误类型 | 错误码 | 前端处理 |
|----------|--------|----------|
| 消息超限 | `payload_too_large` | 分帧发送或请求快照 |
| 连接超时 | `timeout` | 指数退避重连 |
| 序列号跳跃 | `seq_mismatch` | 请求全量 `state:snapshot` |
| 服务不可用 | `service_unavailable` | 显示维护提示 |

---

## 三、规划文档 WS 类型（前端游戏指令，对齐 [规划/规划-API设计.md](./规划/规划-API设计.md)）

以下类型建议在后续版本中与 `POST /api/game/*` 或 Gateway 合并；当前以前端 `gameApi.ts` 的 HTTP 为主，Gateway 用于 **推送**。

| 方向 | type | 用途 |
|------|------|------|
| C→S | `assign_task` | 同 `POST /api/game/task/assign` |
| C→S | `move_agent` | 同 `POST /api/game/agent/move` |
| S→C | `agent_update` | 与 `game_event` channel `agent_status` 对齐 |
| S→C | `task_update` | 与 `game_event` channel `task` 对齐 |

## 四、LLM 结构化事件标签（PRD 对话驱动）

约定在模型输出可包含一行或多行：

```text
[[GAME_EVENT:{"type":"task_progress","task_id":1,"progress":72}]]
```

支持 `type`：`task_progress` | `agent_mood` | `agent_move` | `money_delta` | `log`（详见 [backend/api/game/llm_events.py](../backend/api/game/llm_events.py)）。

## 五、游戏编排 SSE（`server.py` 内联 Hermes）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/game/agent-chat-orchestrated/run` | Body 同 `POST /api/game/agent-chat-orchestrated`，返回 `{ ok, run_id, work_order_id }`，后台线程跑编排。 |
| GET | `/api/game/agent-chat-orchestrated/stream?run_id=` | `text/event-stream`，`data:` 行为 JSON；`type` 含 `step_begin`、`reasoning_delta`、`tool_start`、`tool_end`、`assistant_message`、`step_done`、`delegation_start`、`error`、`stopped`、`turn_done`。 |
| POST | `/api/game/agent-stream/cancel` | Body `{ "stream_id" }`，转发 Hermes `cancel_stream`。 |

详细语义见 [docs/规划/规划-Agent编排SSE会话.md](规划/规划-Agent编排SSE会话.md)。
