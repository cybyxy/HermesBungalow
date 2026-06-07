# Hermes数字工作室 - API 设计

> 基于 `DDD-Hermes数字工作室详细设计.md` 提取的 API 规划
> 更新时间：2025-05-01

---

## 一、通信架构

### 1.1 技术选型

| 层级 | 技术 | 说明 |
|------|------|------|
| 前端 | React + Next.js + Phaser + TypeScript | 游戏界面 + 实时渲染 |
| 后端 | obEspoir (Python) / FastAPI | 游戏逻辑服务器 |
| 通信 | WebSocket | 前后端实时双向通信 |
| LLM桥接 | Hermes Gateway | Agent 推理服务 |

### 1.2 数据流向

```
用户操作 → 游戏层(Phaser/React) → obEspoir → Hermes Agent → obEspoir → 前端(WS推送)
```

### 1.3 核心链路

> 访客发消息 → Gateway API Server 转给 LLM → LLM 返回回复 + **结构化事件标签** → 后端解析事件标签 → WebSocket 推送到前端 → 触发主agent动画/物件互动

---

## 二、WebSocket 服务

**文件路径**：`frontend/src/services/websocket.ts`

### 2.1 WebSocket 客户端实现

```typescript
type MessageHandler = (message: WSMessage) => void;

interface WSMessage {
  type: 'agent_update' | 'task_update' | 'event' | 'chat' | 'system' | 'auto_chat' | 'achievement';
  payload: unknown;
  timestamp: number;
  source: string;
}

class HermesWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: number | null = null;
  private isIntentionalClose = false;

  constructor(url: string = 'ws://localhost:8000') {
    this.url = url;
  }

  connect(): Promise<void> { /* ... */ }
  disconnect(): void { /* ... */ }
  send(type: string, payload: unknown): void { /* ... */ }
  on(type: string, handler: MessageHandler): () => void { /* ... */ }
  off(type: string, handler: MessageHandler): void { /* ... */ }
  
  private handleMessage(message: WSMessage): void { /* ... */ }
  private emit(type: string, message: WSMessage): void { /* ... */ }
  private startHeartbeat(): void { /* 30秒心跳 */ }
  private stopHeartbeat(): void { /* ... */ }
  private attemptReconnect(): void { /* 指数退避重连 */ }
  
  get readyState(): number { return this.ws?.readyState ?? WebSocket.CLOSED; }
  get isConnected(): boolean { return this.ws?.readyState === WebSocket.OPEN; }
}

export const wsService = new HermesWebSocket();
```

### 2.2 连接管理

| 功能 | 说明 |
|------|------|
| 心跳 | 30秒发送一次 heartbeat |
| 重连 | 指数退避（1s, 2s, 4s, 8s, 16s），最多5次 |
| 状态 | `connected` / `disconnected` / `reconnect_failed` |

---

## 三、消息格式

### 3.1 前端 → 后端

| type | payload | 说明 |
|------|---------|------|
| `heartbeat` | `{ timestamp }` | 心跳保活 |
| `assign_task` | `{ agentId, taskId }` | 分配任务 |
| `move_agent` | `{ agentId, targetRoom }` | 移动Agent |
| `use_skill` | `{ skillName, targetAgentId? }` | 使用城主技能 |
| `chat` | `{ content, agentId? }` | 发送聊天消息 |
| `event_choice` | `{ eventId, choice }` | 事件选择 |
| `auto_chat_control` | `{ enabled, tokenLimit }` | 自主交流开关 |

### 3.2 后端 → 前端

| type | payload | 说明 |
|------|---------|------|
| `agent_update` | `{ id, ...updates }` | Agent状态更新 |
| `task_update` | `{ id, status, progress }` | 任务状态更新 |
| `event` | `{ id, type, title, choices }` | 触发事件 |
| `chat` | `{ agentId, content, isAutoChat }` | 收到聊天消息 |
| `auto_chat` | `{ fromAgent, toAgent, chatType, content }` | 自主交流消息 |
| `achievement` | `{ id, name, description }` | 成就解锁通知 |
| `system` | `{ type, message }` | 系统消息 |
| `room_change` | `{ agentId, fromRoom, toRoom }` | Agent房间变更 |
| `city_lord_update` | `{ xp, level, skills }` | 城主状态更新 |

### 3.3 REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/api/chat` | 对话接口 |
| `POST` | `/api/channels` | Channel CRUD |
| `GET` | `/api/channels` | 获取Channel列表 |
| `PUT` | `/api/channels/:id` | 更新Channel |
| `DELETE` | `/api/channels/:id` | 删除Channel |

### 3.4 Hermes Gateway API

```
POST /v1/messages  # MiniMax Anthropic 兼容 API
```

---

## 四、API 路由完善（已完成）

| 路由 | 状态 | 说明 |
|------|------|------|
| `POST /api/chat` | ✅ 已完成 | 对话接口 |
| `POST /api/channels` | ✅ 已完成 | Channel创建 |
| `GET /api/channels` | ✅ 已完成 | Channel列表 |
| `PUT /api/channels/:id` | ✅ 已完成 | Channel更新 |
| `DELETE /api/channels/:id` | ✅ 已完成 | Channel删除 |
| `WS /ws/caicai` | ✅ 已完成 | WebSocket端点 |

---

## 五、数据模型接口

### 5.1 Agent 接口

```typescript
interface Agent {
  id: string;
  name: string;
  roomId: string;
  status: 'idle' | 'working' | 'resting' | 'chatting';
  mood: number;           // 0-100
  energy: number;         // 0-100
  social: number;          // 0-100
  taskId?: string;
  relationships: Map<string, Relationship>;
  skills: string[];
  defaultWorkSpace: string;  // 来自Hermes profile配置
}

interface Relationship {
  targetAgentId: string;
  affection: number;      // 好感度 0-100
  relationship: number;    // 关系值 0-100
  lastGreetTime?: number; // 上次打招呼时间
  lastGreetPlace?: string; // 上次打招呼地点
}
```

### 5.2 Task 接口

```typescript
interface Task {
  id: string;
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;       // 0-100
  assigneeId?: string;
  priority: number;
  estimatedTime: number;
}
```

### 5.3 Room 接口

```typescript
interface Room {
  id: string;
  name: string;
  roomType: 'city_lord_office' | 'office' | 'rest' | 'meeting' | 'archive' | 'server' | 'entrance';
  capacity: number;
  currentOccupancy: number;
  facilityLevel: number;
  items: RoomItem[];
}
```

### 5.4 GameStore 接口

```typescript
interface GameStore {
  agents: Map<string, Agent>;
  tasks: Map<string, Task>;
  rooms: Map<string, Room>;
  cityLord: CityLord;
  events: GameEvent[];
  notifications: Notification[];
  achievements: Achievement[];
  weekProgress: WeekProgress;
}
```

---

## 六、事件系统

### 6.1 GameEvent 接口

```typescript
interface GameEvent {
  id: string;
  type: 'random' | 'scheduled' | 'triggered';
  title: string;
  description: string;
  choices: EventChoice[];
  effects: EventEffect[];
  triggeredAt?: number;
}

interface EventChoice {
  id: string;
  text: string;
  effects: EventEffect[];
}

interface EventEffect {
  type: 'mood' | 'energy' | 'social' | 'xp' | 'item' | 'relationship';
  target?: string;
  value: number;
}
```

---

## 七、实时状态刷新

| 方式 | 频率 | 说明 |
|------|------|------|
| WebSocket推送 | 实时 | Agent状态变化、任务进度、房间变更 |
| 轮询 | 每10秒 | Channel状态（可选，降级方案） |

---

## 八、相关文档

| 文档 | 说明 |
|------|------|
| `规划-游戏机制.md` | 16个核心游戏机制 |
| `规格-物品.md` | Agent规格、物品、社交机制 |
| `规格-任务系统.md` | 任务系统规格 |
| `规格-周目标.md` | 周目标系统规格 |
| `规划-Hermes数字工作室UI布局_v2.md` | UI布局规划 |
| `规划-Hermes数字工作室技术架构.md` | 技术架构规划 |

---

> API状态：**已设计**
