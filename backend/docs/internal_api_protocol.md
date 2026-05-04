# 马斯特 Agent ↔ Sidecar 内部通信协议

> 版本：v1.0
> 状态：已确认
> 日期：2026-05-02

---

## 架构概述

```
前端（WebSocket）
       ↓
马斯特Sidecar（server.py，:8000）
  - WebSocket连接管理
  - 消息路由
  - 消息缓存（Agent休眠时）
  - 转发结果给前端
       ↓ 内部HTTP POST
马斯特Agent（agent_server.py，:8001~）
  - LLM推理
  - 记忆（SOUL.md/memory.md）
  - 决策
       ↑ SSE回推
```

---

## 端点定义

### 1. Sidecar → Agent

**端点**：`POST /api/agent/invoke`

```json
// 请求
{
  "task_id": "uuid-v4",
  "client_msg_id": "前端消息ID（可选，透传）",
  "message": "前端发来的消息内容",
  "timestamp": 1704067200
}

// 响应 200
{
  "task_id": "uuid-v4",
  "status": "queued"
}
```

### 2. Agent → Sidecar（SSE 回推）

**端点**：`GET /api/sidecar/stream?task_id={task_id}`

```text
event: result
data: {"task_id":"uuid","client_msg_id":"前端消息ID","status":"done","content":"推理结果","timestamp":1704067201}

event: error
data: {"task_id":"uuid","status":"error","message":"错误原因"}
```

### 3. Agent 健康检查（心跳）

**端点**：`GET /api/agent/health`

```json
// 响应 200
{
  "status": "alive",
  "last_seen": 1704067200
}
```

- Sidecar 每 30 秒调用一次
- 超过 60 秒无响应视为 Agent 休眠

---

## 消息缓存

### 缓存策略

- **队列类型**：FIFO（先进先出）
- **最大长度**：10 条
- **溢出处理**：丢弃最旧的，保留最新的

```python
class MessageCache:
    max_size: int = 10
    queue: list[dict] = []

    def push(message: dict) -> None:
        if len(self.queue) >= self.max_size:
            self.queue.pop(0)  # 丢弃最旧的
        self.queue.append(message)
```

---

## 状态定义

| 状态 | 说明 |
|------|------|
| `queued` | 消息已加入队列，等待 Agent 处理 |
| `streaming` | SSE 回推中 |
| `done` | 推理完成 |
| `error` | 推理异常 |

---

## 完整流程

```
1. 前端发消息 → Sidecar WebSocket
2. Sidecar 检查 Agent 状态
   - 空闲：POST /api/agent/invoke → 等待 SSE
   - 休眠：加入缓存队列
3. Agent 推理 → SSE 回推结果
4. Sidecar 收到 → 转发给前端
5. 处理缓存队列中的消息
```

---

## 调整记录

| 日期 | 调整内容 |
|------|----------|
| 2026-05-02 | 响应码从 202 改为 200（客户端兼容性） |
| 2026-05-02 | 增加心跳机制（每30秒检查，超过60秒视为休眠） |
| 2026-05-02 | 增加 client_msg_id 透传（方便前端匹配消息） |
