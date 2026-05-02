# Hermes数字工作室 — 技术架构规划

> **文档版本**：v2.0
> **项目名称**：Hermes数字工作室 UI 改造
> **核心原则**：业务逻辑100%在后端，前端只做展示
> **关联文档**：`规划-前后端职责划分.md` — 详细前后端职责定义
> **状态**：待开发

---

## 0. 核心原则

```
【后端 - 游戏框架】              【前端 - 展示层】
├── 业务逻辑（100%）             ├── UI渲染（100%）
├── 状态管理（唯一事实来源）      ├── 动画播放
├── 数值计算                     ├── 用户输入捕获
├── AI推理调用                  └── 音视频播放
├── 任务调度
├── 事件系统
├── 碰撞检测
├── 路径规划
└── 数据存储
```

> **详细职责划分请参阅**：`规划-前后端职责划分.md`

---

## 1. 技术栈概览

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| 前端框架 | React 18+ / Next.js | 生态成熟，组件化完善 |
| 语言 | TypeScript | 类型安全，IDE 支持好 |
| 构建工具 | Vite | 快速冷启动，热更新快 |
| 游戏引擎 | Phaser | 轻量2D游戏引擎，支持精灵图动画 |
| 样式 | Tailwind CSS | 原子化，复用率高 |
| 状态管理 | Zustand | 轻量，TypeScript 友好 |
| 后端框架 | obEspoir Python | 游戏服务器 |
| **持久存储** | **SQLite** | **轻量、无依赖、适合单机游戏** |
| 通信 | WebSocket | 前后端分离架构 |
| 图标 | Lucide React | 轻量、一致的图标库 |
| 字体 | Google Fonts (VT323, Noto Sans SC) | CDN 加载 |

---

## 2. 系统架构图

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    React Application                       │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ TopBar  │  │ Activity │  │  Panel    │  │ Bottom   │  │  │
│  │  │         │  │  Space    │  │  (L/R)    │  │  Menu    │  │  │
│  │  │         │  │(Phaser)   │  │          │  │          │  │  │
│  │  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘  │  │
│  │       │            │              │              │        │  │
│  │  ┌────┴────────────┴──────────────┴──────────────┴────┐  │  │
│  │  │              GameState (Zustand Store)                │  │  │
│  │  │   - agents[]  - cityLord   - rooms[]  - events[]   │  │  │
│  │  └────────────────────────┬─────────────────────────────┘  │  │
│  └──────────────────────────┼───────────────────────────────┘  │
│                              │ WebSocket                        │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │  Hermes Gateway      │
                    │  (WebSocket Server) │
                    │  ws://localhost:8000 │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │    obEspoir Python    │
                    │    Game Server        │
                    │                       │
                    │  ┌───────────────┐    │
                    │  │   SQLite DB   │    │
                    │  │  (持久存储)    │    │
                    │  └───────────────┘    │
                    └─────────────────────┘
```

### 2.2 前端架构模式

```
App (根组件)
├── TopBar (状态栏)
│   └── AgentAvatarList → 订阅 agents[]
├── ModelUsagePanel (左侧面板)
│   └── 订阅 modelUsage, agent needs, roleMatch
├── ActivitySpace (中央活动空间)
│   ├── Room[] → 订阅 room state
│   ├── RestRoom → 订阅 agents in rest
│   ├── ServerRoom → 订阅 service status
│   ├── ArchiveRoom → 订阅 archive data
│   └── MeetingRoom → 订阅 meeting state
│   └── PhaserGame → Agent移动动画、房间渲染
├── ActivityFeed (右上活动提示)
│   └── 订阅 events[], notifications[]
├── SessionInput (右下输入)
│   └── 订阅 currentSession, currentAgent
└── BottomMenu (底部菜单)
    └── 订阅 weekProgress, menuItems
```

---

## 3. 项目目录结构

```
HermesBungalow/
├── frontend/                    # React + Next.js 前端
│   ├── src/
│   │   ├── App.tsx            # 根组件
│   │   ├── main.tsx          # 入口文件
│   │   ├── index.css         # 全局样式 + Rimworld配色
│   │   ├── components/        # UI 组件
│   │   │   ├── ui/           # 界面组件
│   │   │   │   ├── TopBar.tsx
│   │   │   │   ├── BottomMenu.tsx
│   │   │   │   ├── ActivitySpace.tsx
│   │   │   │   ├── ModelUsagePanel.tsx
│   │   │   │   ├── ActivityFeed.tsx
│   │   │   │   ├── SessionInput.tsx
│   │   │   │   └── AgentPopup.tsx
│   │   │   ├── rooms/        # 房间组件
│   │   │   │   ├── Room.tsx
│   │   │   │   ├── RestRoom.tsx
│   │   │   │   ├── ServerRoom.tsx
│   │   │   │   ├── ArchiveRoom.tsx
│   │   │   │   └── MeetingRoom.tsx
│   │   │   ├── game/         # 游戏组件
│   │   │   │   ├── PhaserGame.tsx
│   │   │   │   ├── SkillTree.tsx
│   │   │   │   ├── RelationshipMap.tsx
│   │   │   │   └── CityLordSkills.tsx
│   │   │   └── panels/       # 面板组件
│   │   │       ├── AutoChatSystem.tsx
│   │   │       ├── CollaborationPanel.tsx
│   │   │       ├── CityLordPanel.tsx
│   │   │       ├── EventSystem.tsx
│   │   │       └── AchievementPanel.tsx
│   │   ├── store/           # 状态管理
│   │   │   └── gameState.ts  # Zustand Store
│   │   ├── hooks/            # 自定义 Hooks
│   │   │   ├── useWebSocket.ts
│   │   │   ├── useGameLoop.ts
│   │   │   └── useAgent.ts
│   │   ├── services/         # 服务层
│   │   │   ├── websocket.ts  # WebSocket 客户端
│   │   │   └── api.ts        # API 调用
│   │   ├── types/            # TypeScript 类型
│   │   │   └── index.ts
│   │   └── utils/            # 工具函数
│   │       └── index.ts
│   ├── public/
│   │   └── assets/          # 静态资源
│   │       ├── avatars/      # 头像
│   │       └── pixel_art/    # 像素立绘
│   └── package.json
│
├── backend/                    # obEspoir Python 后端
│   ├── server.py             # 游戏服务器入口
│   ├── agents/               # Agent 模块
│   │   ├── __init__.py
│   │   └── base.py
│   ├── rooms/                # 房间模块
│   │   ├── __init__.py
│   │   └── room.py
│   ├── tasks/                # 任务模块
│   │   ├── __init__.py
│   │   └── task.py
│   └── utils/                # 工具模块
│       └── __init__.py
│
├── docs/                      # 文档
│   ├── PRD-Hermes数字工作室Rimworld风格UI改造.md
│   ├── 规划-游戏机制.md
│   ├── 规划-Hermes数字工作室技术架构.md
│   └── game_assets/          # 游戏素材
│       ├── prototype.html
│       └── tiles/
│
└── README.md
```

---

## 4. 数据流设计

### 4.1 WebSocket 通信流程

```
┌─────────────┐                      ┌─────────────┐
│   Frontend  │                      │   Backend   │
│   (React)   │                      │  (obEspoir) │
└──────┬──────┘                      └──────┬──────┘
       │                                    │
       │  1. 连接 WebSocket                 │
       │ ─────────────────────────────────► │
       │                                    │
       │  2. 接收初始游戏状态                │
       │ ◄───────────────────────────────── │
       │    { agents, rooms, tasks, ... }    │
       │                                    │
       │  3. 用户操作 → 发送指令            │
       │ ─────────────────────────────────► │
       │    { type: "agent:move", agentId, targetRoom } │
       │                                    │
       │  4. 服务端处理 → 广播状态变更       │
       │ ◄───────────────────────────────── │
       │    { type: "state:update", ... }    │
       │                                    │
       │  5. 前端更新 Store → 触发 UI 渲染   │
       │                                    │
```

### 4.2 消息类型定义

| 消息类型 | 方向 | 说明 |
|----------|------|------|
| `state:init` | Server→Client | 初始化游戏状态 |
| `state:update` | Server→Client | 状态更新推送 |
| `agent:move` | Client→Server | Agent移动指令 |
| `agent:task:assign` | Client→Server | 分配任务 |
| `agent:interact` | Client→Server | 与Agent交互 |
| `room:enter` | Client→Server | 进入房间 |
| `room:leave` | Client→Server | 离开房间 |
| `chat:message` | Client↔Server | 聊天消息 |
| `event:trigger` | Server→Client | 事件触发 |
| `skill:use` | Client→Server | 使用技能 |

---

## 5. 游戏状态管理 (Zustand Store)

### 5.1 Store 结构

```typescript
interface GameState {
  // Agent 管理
  agents: Agent[];
  mainAgent: Agent;  // Hermes

  // 城主状态
  cityLord: CityLord;

  // 房间状态
  rooms: Room[];

  // 任务状态
  tasks: Task[];
  currentTask: Task | null;

  // 事件系统
  events: GameEvent[];
  notifications: Notification[];

  // 周目标
  weekProgress: WeekProgress;

  // UI 状态
  selectedAgentId: string | null;
  activePopup: PopupType | null;
  isAutoChatEnabled: boolean;

  // 操作方法
  moveAgent: (agentId: string, targetRoom: RoomId) => void;
  assignTask: (agentId: string, taskId: string) => void;
  useSkill: (skillId: string, targetId?: string) => void;
  // ...
}
```

### 5.2 Agent 数据结构

```typescript
interface Agent {
  id: string;
  name: string;
  gender: 'male' | 'female';  // 性别（用户指定或random随机）
  role: '城主' | '设计师' | '程序员' | '测试员' | '分析师';
  isMain: boolean;

  // 形象（按性别加载）
  avatarUrl: string;
  pixelArtUrl: string;

  // 模型配置
  modelProvider: string;
  modelName: string;
  modelConfig: ModelConfig;

  // 房间与状态
  color: string;
  status: AgentStatus;
  room: RoomId;
  homeRoom: number;
  currentTaskId: string | null;

  // 养成属性
  xp: number;
  level: number;
  skillPoints: number;
  skills: {
    efficiency: number;  // 0-3
    quality: number;     // 0-3
    social: number;      // 0-3
  };

  // 需求状态 (0-100)
  energy: number;         // 饱食度
  quota: number;          // Token配额
  socialNeed: number;     // 社交需求

  // 职业匹配度 (0-100)
  roleMatch: number;

  // 关系 (agentId → 关系度)
  relationships: Record<string, number>;

  // 情绪
  mood: Mood;
  moodValue: number;

  // 工作属性
  workMorale: number;
  confidence: number;
}
```

---

## 6. Phaser 游戏层

### 6.1 职责

- Agent 精灵图渲染与动画
- 房间场景渲染
- 移动动画与碰撞检测
- 气泡对话渲染

### 6.2 精灵图规格

| 属性 | 数值 |
|------|------|
| Agent 尺寸 | 23×43 像素 |
| 方向 | 4向（上/下/左/右） |
| 每向帧数 | 3帧（走路动画） |
| 站立 | 复用第1帧 |
| 帧率 | 150ms/帧 |

### 6.3 房间格子系统

| 属性 | 数值 |
|------|------|
| 房间格子 | 32×32 像素 |
| Agent 走路速度 | 3像素/帧 |

---

## 7. 后端架构 (obEspoir Python)

### 7.1 模块划分

```
backend/
├── server.py              # ASGI 应用入口
├── config.py              # 配置管理
├── agents/
│   ├── __init__.py
│   ├── base.py           # Agent 基类
│   ├── city_lord.py      # 城主 Agent
│   └── worker.py         # 工作 Agent
├── rooms/
│   ├── __init__.py
│   ├── room.py           # 房间基类
│   ├── office.py        # 办公室
│   ├── rest_room.py      # 休息室
│   ├── meeting_room.py   # 会议室
│   ├── server_room.py    # 机房
│   └── archive_room.py   # 资料室
├── tasks/
│   ├── __init__.py
│   ├── task.py          # 任务基类
│   ├── design_task.py   # 设计任务
│   ├── code_task.py     # 编码任务
│   ├── test_task.py     # 测试任务
│   └── analyze_task.py  # 分析任务
├── game/
│   ├── __init__.py
│   ├── state.py         # 游戏状态
│   ├── event.py        # 事件系统
│   └── scheduler.py    # 调度器
├── social/
│   ├── __init__.py
│   ├── greeting.py     # 打招呼系统
│   ├── relationship.py # 关系系统
│   └── auto_chat.py    # 自主交流
└── utils/
    ├── __init__.py
    └── helpers.py
```

### 7.2 WebSocket 处理

```python
# 使用 FastAPI + WebSocket
from fastapi import WebSocket

class GameServer:
    def __init__(self):
        self.active_connections: dict[str, WebSocket] = {}
        self.game_state: GameState = GameState()

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket

    async def disconnect(self, client_id: str):
        del self.active_connections[client_id]

    async def broadcast(self, message: dict):
        for connection in self.active_connections.values():
            await connection.send_json(message)
```

---

## 8. 部署架构

### 8.1 开发环境

```
localhost:3000  (前端 - Vite Dev Server)
localhost:8000  (后端 - FastAPI + WebSocket)
```

### 8.2 生产环境

```
┌─────────────────────────────────────────────┐
│                  Nginx                       │
│         (反向代理 + 静态资源)                  │
└─────────────────┬───────────────────────────┘
                  │
    ┌─────────────┴─────────────┐
    │                           │
┌───▼────┐               ┌─────▼────┐
│ Frontend│               │ Backend  │
│(CDN/Vercel)│            │(uvicorn) │
└─────────┘               └──────────┘
```

---

## 9. 存储管理设计

> **设计决策**：无存档，实时记录所有状态，无法回档

### 9.1 存储方式

| 项目 | 值 |
|------|-----|
| 数据库 | SQLite（`hermes_bungalow.db`） |
| 用途 | 实时状态持久化（页面刷新后恢复） |
| 限制 | 无玩家存档/读档功能，关闭浏览器=游戏结束 |

### 9.2 存储策略

```
【存储时机】
- 用户每次输入触发AI推理时 → 实时写入
- 任务完成/失败时 → 实时写入
- 社交事件发生时 → 实时写入
- 数值变化时 → 实时写入

【读取时机】
- 前端连接时 → 加载最新状态
- 页面刷新时 → 从数据库恢复最新状态

【禁止行为】
- ❌ 玩家手动存档
- ❌ 玩家读档/回档
- ❌ 多存档槽位
```

### 9.3 核心表结构

```sql
-- Agent 状态表
CREATE TABLE agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    profession TEXT NOT NULL,
    energy REAL DEFAULT 100.0,
    focus REAL DEFAULT 100.0,
    social REAL DEFAULT 50.0,
    mood REAL DEFAULT 60.0,
    sleepiness REAL DEFAULT 0.0,
    relationship_main REAL DEFAULT 100.0,
    location TEXT DEFAULT '城主办公室',
    status TEXT DEFAULT 'idle',
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 任务表
CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    complexity INTEGER DEFAULT 1,
    required_profession TEXT,
    status TEXT DEFAULT 'pending',
    assignee_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    completed_at INTEGER,
    FOREIGN KEY (assignee_id) REFERENCES agents(id)
);

-- 社交关系表
CREATE TABLE relationships (
    id TEXT PRIMARY KEY,
    agent_a_id TEXT NOT NULL,
    agent_b_id TEXT NOT NULL,
    affection REAL DEFAULT 50.0,
    relationship_value REAL DEFAULT 30.0,
    stage TEXT DEFAULT 'stranger',
    last_greet_time INTEGER,
    FOREIGN KEY (agent_a_id) REFERENCES agents(id),
    FOREIGN KEY (agent_b_id) REFERENCES agents(id)
);

-- 事件日志表
CREATE TABLE event_logs (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    agent_id TEXT,
    task_id TEXT,
    content TEXT,
    mood_delta REAL,
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);

-- 用户输入日志表（AI推理追踪）
CREATE TABLE input_logs (
    id TEXT PRIMARY KEY,
    input_type TEXT NOT NULL,  -- 'normal' or '@mention'
    target_agent_id TEXT,
    content TEXT NOT NULL,
    ai_reasoning TEXT,  -- JSON
    created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

### 9.4 相关文档

| 文档 | 说明 |
|------|------|
| `规划-游戏机制.md` | 16个核心游戏机制 |
| `规格-物品.md` | Agent规格、物品、社交机制 |
| `规格-任务系统.md` | 任务系统规格 |
| `规格-周目标.md` | 周目标系统规格 |
| `规划-AI推理与本地处理划分.md` | AI推理触发与存储策略 |

---

## 10. 相关文档

| 文档 | 说明 |
|------|------|
| `规划-Hermes数字工作室UI布局_v2.md` | UI布局规划 |
| `规划-API设计.md` | API设计 |
