# Agent 编排 SSE 会话（计划书）

## 目标

- 推理仅在后端完成；前端通过 **SSE** 实时展示（**仅 reasoning 流式**；工具 `tool_start` + 单条 `tool_end`；最终回复整段 `assistant_message`）。
- **整轮**内除 **POST 创建 run** 与 **POST 取消 stream** 外，**不再**发起编排类 POST；编排循环在服务端完成。
- **同 `step_id` 的多次 `reasoning_delta` 合并为一个气泡**（前端用 `appendToInference` 追加到同一 `InferenceEntry`）。
- 右侧 **RightPanel**：**上** 会话（user / reply / error），**下** 过程与工具（reasoning / status / tool_*）。
- 停止：对已知的 Hermes `stream_id` 调用 **`cancel_stream`**（与 Hermes 引擎一致）。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/game/agent-chat-orchestrated/run` | Body 与现有一致：`agent_id`, `message`, `auto_peer`, `attachments?`。校验后创建 `run_id`，启动后台线程执行编排，立即返回 `{ ok, run_id, work_order_id? }`。 |
| GET | `/api/game/agent-chat-orchestrated/stream?run_id=` | `text/event-stream`，每条 `data: {json}`。 |
| POST | `/api/game/agent-stream/cancel` | Body `{ "stream_id": "..." }`，内部 `cancel_stream(stream_id)`。 |

## SSE 事件（JSON）

公共字段：`run_id`, `seq`（单调）, `type`。

| type | 说明 |
|------|------|
| `step_begin` | 新一步 LLM：`step_id`, `agent_id`, `stream_id`（供取消）。 |
| `reasoning_delta` | 追加文本：`step_id`, `agent_id`, `text`。 |
| `tool_start` | `agent_id`, `step_id`, `name`, `args_summary?`。 |
| `tool_end` | `agent_id`, `step_id`, `name`, `ok`, `result_summary?`, `error?`。 |
| `assistant_message` | 整段回复：`agent_id`, `step_id`, `markdown`。 |
| `step_done` | 本步结束：`step_id`, `agent_id`。 |
| `delegation_start` | `from_agent_id`, `to_agent_id`, `reason?`。 |
| `error` | `message`, `fatal?`。 |
| `stopped` | 用户取消：`step_id?`, `agent_id?`。 |
| `turn_done` | 整轮结束（前端解锁输入）。 |

## 前端行为

1. `submitStudioChat`：用户消息写入 log 后 → `POST .../run` → `EventSource` GET `.../stream?run_id=`。
2. 维护 `stepId -> inferenceEntryId`（仅 `reasoning`）：`step_begin` 创建空 reasoning 气泡并记录映射；`reasoning_delta` 用 `appendToInference`；`step_done` 删除映射。
3. 停止：`POST .../agent-stream/cancel`，body 为最近收到的 `stream_id`（`step_begin`）。
4. `RightPanel`：单栏上下分区；`inferenceLog` 按 variant 过滤到「会话」或「过程与工具」列表。

## 后端实现要点

- `agent.py`：`sync_session_turn` / `_drain_agent_stream` / `run_recursive_peer_invokes` / `orchestrated_peer_turns_sync` 增加可选 `event_sink`（线程内同步 `put` 到 `queue`）与 `run_id`；不改变无 `event_sink` 时的 JSON 行为。
- `server.py`：`RUNS` 内存表 + 三路由；`monitor_*` 与现有一致。

## 风险

- 进程重启丢失 `run_id`（仅内存）；生产可换 Redis。
- EventSource 跨域需 cookie/同源；开发走 Vite 代理。
