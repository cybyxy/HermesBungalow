# 崽崽数字小屋 — 软件概要设计说明书

> **文档版本**：v1.0
> **项目名称**：崽崽数字小屋 UI 改造
> **关联需求文档**：`PRD-崽崽数字小屋Rimworld风格UI改造.md`（v1.0）
> **状态**：待开发

---

## 1. 文档目的与范围

### 1.1 目的

本文档定义崽崽数字小屋 UI 改造项目的软件概要设计，作为详细设计、实现和测试的依据。本文档面向开发团队，明确系统架构、模块划分、接口定义和技术选型。

### 1.2 范围

- 前端应用架构设计
- 游戏状态管理方案
- 组件层级与职责划分
- 后端接口设计（WebSocket 通信）
- 前端模块划分
- 技术选型与约束

---

## 2. 系统架构设计

### 2.1 整体架构

系统采用 **React + TypeScript** 单页应用架构，前端作为 Hermes Gateway 的 WebSocket 客户端，通过 WebSocket 与后端 Agent 系统通信。

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    React Application                       │  │
│  │  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  │  │
│  │  │ TopBar  │  │ Activity │  │  Panel    │  │ Bottom   │  │  │
│  │  │         │  │  Space    │  │  (L/R)    │  │  Menu    │  │  │
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
                    │  (WebSocket Server)  │
                    │  ws://localhost:8000 │
                    └──────────┬──────────┘
                               │
                    ┌──────────┴──────────┐
                    │    Backend Agents    │
                    │  (崽崽 + 子Agents)  │
                    └─────────────────────┘
```

### 2.2 前端架构模式

采用 **组件化架构**，以 React Context / Zustand 为状态管理核心，各 UI 组件订阅各自关心的状态切片：

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
├── ActivityFeed (右上活动提示)
│   └── 订阅 events[], notifications[]
├── SessionInput (右下输入)
│   └── 订阅 currentSession, currentAgent
└── BottomMenu (底部菜单)
    └── 订阅 weekProgress, menuItems
```

### 2.3 技术栈

| 层级 | 技术 | 选型理由 |
|------|------|----------|
| 框架 | React 18+ | 生态成熟，组件化完善 |
| 语言 | TypeScript | 类型安全，IDE 支持好 |
| 构建 | Vite | 快速冷启动，热更新快 |
| 样式 | Tailwind CSS | 原子化，复用率高 |
| 状态 | Zustand | 轻量，TypeScript 友好 |
| WebSocket | 原生 WebSocket API | 避免引入不必要的库 |
| 图标 | Lucide React | 轻量、一致的图标库 |
| 字体 | Google Fonts (VT323, Noto Sans SC) | CDN 加载 |

---

## 3. 模块设计

### 3.1 前端模块划分

```
frontend/src/
├── App.tsx                          # 根组件，五区域布局
├── index.css                        # 全局样式 + CSS变量定义
├── main.tsx                         # 入口文件
│
├── store/                           # 状态管理
│   └── gameState.ts                 # Zustand Store：全游戏状态
│
├── ui/                              # UI 组件（按区域划分）
│   ├── TopBar/
│   │   ├── TopBar.tsx              # 顶栏容器
│   │   ├── TopBar.css
│   │   └── components/
│   │       ├── AgentAvatar.tsx       # Agent头像组件
│   │       └── ScoreDisplay.tsx     # 积分/等级显示
│   │
│   ├── ActivitySpace/
│   │   ├── ActivitySpace.tsx        # 中央活动空间容器
│   │   ├── ActivitySpace.css
│   │   └── components/
│   │       ├── Room.tsx             # 办公室格子
│   │       ├── RestRoom.tsx         # 休息室
│   │       ├── ServerRoom.tsx       # 机房
│   │       ├── ArchiveRoom.tsx      # 资料室
│   │       └── MeetingRoom.tsx      # 会议室
│   │
│   ├── LeftPanel/
│   │   ├── ModelUsagePanel.tsx      # 左侧面板
│   │   ├── ModelUsagePanel.css
│   │   └── components/
│   │       ├── ModelUsageChart.tsx   # 模型使用量图表
│   │       ├── NeedsBar.tsx          # 需求条组件
│   │       └── RoleMatchIndicator.tsx # 职业匹配度指示
│   │
│   ├── RightPanel/
│   │   ├── ActivityFeed.tsx         # 右上活动提示
│   │   └── SessionInput.tsx         # 右下输入框
│   │
│   ├── BottomMenu/
│   │   ├── BottomMenu.tsx           # 底部菜单
│   │   └── WeekProgress.tsx         # 周目标进度
│   │
│   └── Popups/                      # 弹窗组件
│       ├── AgentPopup.tsx           # Agent详情弹窗（5标签页）
│       ├── CityLordPanel.tsx        # 城主面板
│       ├── AchievementPanel.tsx     # 成就面板
│       ├── EventModal.tsx           # 事件弹窗
│       ├── CelebrationRoom.tsx      # 庆功室弹窗
│       └── MeetingRoomPanel.tsx     # 复盘会议弹窗
│
├── hooks/                           # 自定义 Hooks
│   ├── useWebSocket.ts              # WebSocket 连接管理
│   ├── useGameLoop.ts               # 游戏循环（定时器驱动）
│   ├── useAgentMovement.ts          # Agent 移动逻辑
│   └── useAutoChat.ts               # 自主交流引擎
│
├── services/                        # 服务层
│   ├── websocket.ts                 # WebSocket 客户端封装
│   ├── gameEngine.ts                # 游戏逻辑引擎
│   └── storage.ts                  # 本地存储（存档/读档）
│
├── types/                           # TypeScript 类型定义
│   ├── agent.ts                     # Agent 相关类型
│   ├── cityLord.ts                  # 城主相关类型
│   ├── room.ts                     # 房间相关类型
│   └── events.ts                   # 事件相关类型
│
└── utils/                           # 工具函数
    ├── constants.ts                 # 常量定义
    ├── math.ts                      # 数学计算（加成、百分比）
    └── text.ts                      # 文本处理（打字机效果）
```

### 3.2 模块职责

| 模块 | 职责 | 主要 API |
|------|------|----------|
| `store/gameState.ts` | 单一数据源，管理全游戏状态 | `useGameStore()` |
| `services/websocket.ts` | WebSocket 连接、消息收发 | `connect()`, `send()`, `onMessage()` |
| `services/gameEngine.ts` | 游戏逻辑计算（加成、判定） | `calcEfficiency()`, `calcMatch()`, `triggerEvent()` |
| `hooks/useGameLoop.ts` | 定时更新游戏状态 | 内部 Interval，触发状态更新 |
| `hooks/useAutoChat.ts` | 自主交流触发与执行 | `triggerAutoChat()`, `acceptChat()`, `rejectChat()` |
| `ui/Popups/AgentPopup.tsx` | Agent 详情展示与编辑 | Props: `agentId`, `onClose` |

---

## 4. 数据流设计

### 4.1 状态数据流

```
WebSocket 消息
      │
      ▼
┌─────────────────┐
│ websocket.ts    │ 解析消息类型
│ (收到后转发)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ gameEngine.ts   │执行业务逻辑
│ (状态变更计算)   │ 例：计算效率加成
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ gameState.ts    │ 更新 Zustand Store
│ (唯一数据源)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ React Components │ 自动重渲染
│ (订阅状态切片)    │
└─────────────────┘
```

### 4.2 用户操作数据流

```
用户操作（点击/输入）
      │
      ▼
┌─────────────────┐
│ React Component │ 触发事件处理函数
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ gameEngine.ts   │ 执行业务逻辑
│ (操作验证+计算)  │
└────────┬────────┘
         │
         ├──────────────────────┐
         ▼                      ▼
┌─────────────────┐   ┌─────────────────┐
│ gameState.ts    │   │ websocket.ts    │
│ (更新本地状态)   │   │ (发送消息到后端) │
└────────┬────────┘   └────────┬────────┘
         │                      │
         ▼                      ▼
┌─────────────────┐   ┌─────────────────┐
│ UI 自动重渲染   │   │ 后端处理         │
└─────────────────┘   └─────────────────┘
```

### 4.3 游戏循环数据流

```
useGameLoop (setInterval 1s/2s)
      │
      ▼
┌─────────────────────────┐
│  遍历所有 Agent          │
│  - 消耗饱食度 (-energy)  │
│  - 检查需求是否归零       │
│  - 触发自主交流概率判定   │
│  - 情绪传染计算          │
│  - 技能冷却倒计时        │
│  - 事件定时器检查        │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  写入 gameState.ts      │
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│  触发 UI 重渲染          │
└─────────────────────────┘
```

---

## 5. WebSocket 接口设计

### 5.1 消息格式

统一消息 envelope：

```typescript
interface WSMessage {
  type: 'agent_update' | 'task_update' | 'event' | 'chat' | 'system';
  payload: unknown;
  timestamp: number;
  source: string;  // '崽崽' | '设计师' | '程序员' | ...
}
```

### 5.2 前端 → 后端消息

| 消息类型 | payload 示例 | 说明 |
|----------|-------------|------|
| `assign_task` | `{ agentId, taskId, taskType }` | 分配任务 |
| `move_agent` | `{ agentId, targetRoom }` | 移动Agent |
| `use_skill` | `{ skillName, targetAgentId? }` | 释放城主技能 |
| `chat_send` | `{ agentId, content }` | 发送消息 |
| `trigger_event` | `{ eventId, choice }` | 事件选择 |
| `auto_chat_control` | `{ enabled: boolean, tokenLimit }` | 自主交流开关 |

### 5.3 后端 → 前端消息

| 消息类型 | payload 示例 | 说明 |
|----------|-------------|------|
| `agent_update` | `{ id, status, energy, quota, mood, ... }` | Agent状态变更 |
| `task_update` | `{ taskId, status, progress, result }` | 任务状态变更 |
| `event` | `{ eventId, eventType, title, choices }` | 触发事件通知 |
| `chat_receive` | `{ agentId, content, isAutoChat }` | 收到消息 |
| `auto_chat` | `{ fromAgent, toAgent, chatType, content }` | 自主交流消息 |
| `achievement_unlock` | `{ achievementId, name }` | 成就解锁 |
| `room_change` | `{ agentId, fromRoom, toRoom }` | Agent房间变更 |

---

## 6. 游戏状态模型

### 6.1 状态存储结构（Zustand Store）

```typescript
interface GameState {
  // 时间
  currentTick: number;        // 游戏内时间戳
  dayOfWeek: number;         // 周几 (1-7)
  weekNumber: number;        // 第几周

  // Agent 管理
  agents: Record<string, Agent>;
  currentAgentId: string;    // 当前选中的Agent
  currentSessionId: string;   // 当前对话Session

  // 城主
  cityLord: CityLord;

  // 房间
  rooms: Room[];
  roomLayout: RoomPosition[]; // 房间位置映射

  // 任务
  tasks: Record<string, Task>;
  currentTaskId: string | null;

  // 事件
  events: GameEvent[];
  activeEventId: string | null;

  // 成就
  unlockedAchievements: string[];

  // UI 状态
  activePopup: PopupType | null;
  popupData: unknown;
  notifications: Notification[];

  // 自主交流
  autoChatEnabled: boolean;
  autoChatTokenLimit: number;

  // 周目标
  weekProgress: WeekProgress;
}
```

### 6.2 核心计算公式

**工作效率计算：**
```
baseEfficiency = 1.0
energyMod = energy < 20 ? 0.5 : 1.0
matchMod = 根据匹配度查表（见4.2节）
moodMod = excited:1.2, positive:1.1, neutral:1.0, sad:0.9, anxious:0.8
finalEfficiency = baseEfficiency × energyMod × matchMod × moodMod
```

**升级所需 XP：**
```
xpRequired = level × 100
```

**协作效率加成：**
```
baseBonus = 0.3  // 效率+30%
if (relationship >= 80) baseBonus += 0.15  // 关系≥80%额外+15%
if (isRoleComplementary) baseBonus += 0.2   // 职业互补额外+20%
finalBonus = min(baseBonus, 0.8)  // 上限80%
```

**情绪传染：**
```
if (sameRoom) moodSync = 0.8      // 同房间80%传染
else if (adjacentRoom) moodSync = 0.5
else moodSync = 0

newMood = oldMood × (1 - moodSync) + infectedMood × moodSync
```

---

## 7. 组件层级设计

### 7.1 组件树

```
App
└── .app-container
    ├── TopBar
    │   ├── .top-bar
    │   │   ├── AgentAvatarList
    │   │   │   └── AgentAvatar × N
    │   │   └── ScoreDisplay
    │   └── (崽崽城主徽章)
    │
    ├── .main-area
    │   ├── .left-panel
    │   │   └── ModelUsagePanel
    │   │       ├── ModelUsageChart
    │   │       ├── NeedsBar × 3 (饱食度/电量/社交)
    │   │       └── RoleMatchIndicator
    │   │
    │   ├── .center-area
    │   │   └── ActivitySpace
    │   │       ├── Room × 9 (办公室)
    │   │       ├── RestRoom
    │   │       ├── ServerRoom
    │   │       ├── ArchiveRoom
    │   │       └── MeetingRoom
    │   │
    │   └── .right-area
    │       ├── .top-right
    │       │   └── ActivityFeed
    │       │       └── NotificationItem × N
    │       │
    │       └── .bottom-right
    │           └── SessionInput
    │               ├── SessionTabs
    │               ├── ChatHistory
    │               └── InputBox
    │
    ├── BottomMenu
    │   ├── MenuItem × N
    │   └── WeekProgress
    │
    └── PopupLayer (Portal)
        ├── AgentPopup (5 tabs)
        ├── CityLordPanel
        ├── AchievementPanel
        ├── EventModal
        ├── CelebrationRoom
        └── MeetingRoomPanel
```

### 7.2 关键组件规格

| 组件 | 渲染频率 | 状态依赖 | 交互处理 |
|------|----------|----------|----------|
| `AgentAvatar` | 每tick | `agents[id].status/mood` | onClick → 选中Agent |
| `Room` | 每tick | `agents in room` | onClick → Agent详情 |
| `NeedsBar` | 能量变化时 | `agents[id].energy/quota/social` | 无 |
| `ActivityFeed` | 新事件时 | `events[]` | onClick → EventModal |
| `SessionInput` | 消息到达时 | `currentSession.messages` | onSubmit → 发送消息 |
| `AgentPopup` | 打开时 | `agents[id]` 全量 | tab切换，编辑保存 |

---

## 8. 路由与导航

### 8.1 页面路由（单页应用，路由仅控制弹窗/面板）

```typescript
// 使用 React Router（可选，用于深层链接）
/                     → 主界面（始终显示）
/agent/:id            → 打开 Agent 详情弹窗
/agent/:id/:tab       → 打开 Agent 详情弹窗并切换到指定标签页
/city-lord            → 打开城主面板
/achievements         → 打开成就面板
/event/:id            → 打开事件弹窗
/archive              → 打开资料室弹窗
/archive/:category    → 打开资料室并切换分类
/celebration          → 打开庆功室弹窗
/meeting              → 打开会议室弹窗
```

### 8.2 弹窗层级

| 层级 | 弹窗类型 | 说明 |
|------|----------|------|
| L1 | EventModal | 事件通知，阻塞主操作 |
| L2 | AgentPopup | Agent详情，5标签页 |
| L2 | CityLordPanel | 城主面板 |
| L2 | AchievementPanel | 成就面板 |
| L3 | CelebrationRoom | 庆功室 |
| L3 | MeetingRoomPanel | 复盘会议 |
| L4 | ArchiveRoom | 资料室（可作为右上角展开面板） |

---

## 9. 部署架构

### 9.1 前端部署

```
开发环境：
  Vite Dev Server
  localhost:3000
  → WebSocket → localhost:8000 (Hermes Gateway)

生产环境：
  前端构建产物 (dist/)
  ├── static/
  │   ├── index.html
  │   ├── assets/
  │   └── fonts/
  └── 部署到静态托管（Vercel / Nginx）

  用户浏览器
  → HTTPS → 静态资源
  → WebSocket (wss) → Hermes Gateway
```

### 9.2 环境变量配置

```typescript
// .env
VITE_WS_URL=ws://localhost:8000
VITE_APP_TITLE=崽崽数字小屋
VITE_GAME_TICK_INTERVAL=2000  // 游戏循环间隔(ms)
VITE_MAX_AGENTS=9             // 最大Agent数量
```

---

## 10. 技术约束与决策

### 10.1 关键技术决策

| 决策项 | 选择 | 备选方案 | 决策理由 |
|--------|------|----------|----------|
| 状态管理 | Zustand | Redux / Context API | 轻量，Boilerplate 少，TypeScript 支持好 |
| 组件库 | 纯 Tailwind | Material UI / Ant Design | 定制化程度高，Rimworld 像素风格需要精细控制 |
| WebSocket | 原生 API | socket.io-client | 避免不必要依赖，减少包体积 |
| 游戏循环 | setInterval | requestAnimationFrame | 状态驱动型游戏，Interval 更简单 |
| 弹窗方案 | React Portal | 绝对定位 | Portal 避免 z-index 冲突 |
| 动画 | CSS Transition | Framer Motion | 轻量，Tailwind 集成好 |
| 图标 | Lucide React | Heroicons / Emoji | 一致性好，Tree-shakable |

### 10.2 性能考虑

- 游戏循环使用 `requestAnimationFrame` + `setInterval` 双模式，低配置设备降级
- Agent 移动使用 CSS `transform` 动画（GPU 加速）
- 活动提示区最多保留 50 条历史消息，超出后 FIFO 淘汰
- WebSocket 消息节流：同一 Agent 的状态更新合并为 1 条/200ms
- 大列表（历史会话）使用虚拟滚动（react-virtual）

### 10.3 浏览器兼容

| 特性 | Chrome 90+ | Firefox 90+ | Safari 14+ | Edge 90+ |
|------|------------|-------------|------------|----------|
| CSS Variables | ✅ | ✅ | ✅ | ✅ |
| CSS Grid | ✅ | ✅ | ✅ | ✅ |
| WebSocket | ✅ | ✅ | ✅ | ✅ |
| React 18 | ✅ | ✅ | ✅ | ✅ |
| Portal | ✅ | ✅ | ✅ | ✅ |
| VT323 Font | ✅ | ✅ | ✅ | ✅ |

---

## 11. 目录结构

```
HermesBungalow/
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── index.css
│   │   ├── store/
│   │   │   └── gameState.ts
│   │   ├── ui/
│   │   │   ├── TopBar/
│   │   │   ├── ActivitySpace/
│   │   │   ├── LeftPanel/
│   │   │   ├── RightPanel/
│   │   │   ├── BottomMenu/
│   │   │   └── Popups/
│   │   ├── hooks/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   ├── public/
│   │   └── fonts/              # 本地字体备份
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── package.json
│
├── backend/                      # Hermes Gateway（已有）
│   └── ...
│
├── docs/
│   ├── PRD-崽崽数字小屋Rimworld风格UI改造.md
│   ├── SDD-崽崽数字小屋概要设计.md   # 本文档
│   ├── 2025-05-01_合并规划_崽崽数字小屋UI改造.md
│   └── game_assets/
│       ├── prototype.html
│       ├── agent-popup-prototype.html
│       └── tiles/
│
└── .hermes/
    └── plans/
        └── PRD-v1.0-崽崽数字小屋Rimworld风格UI改造.md
```

---

## 12. 概要设计评审检查清单

| 检查项 | 状态 |
|--------|------|
| 系统架构图清晰，展示前端/后端交互 | ✅ |
| 模块划分合理，职责单一 | ✅ |
| WebSocket 接口消息类型完整 | ✅ |
| Zustand Store 结构定义完整 | ✅ |
| 组件树层级与目录结构一致 | ✅ |
| 技术选型有明确决策理由 | ✅ |
| 部署架构清晰 | ✅ |
| 性能考虑已说明 | ✅ |
| 浏览器兼容性已覆盖 | ✅ |
| 目录结构与文件清单匹配 | ✅ |
| 与 PRD 需求完全对应 | ✅ |

---

## 13. 参考文档

| 文档 | 路径 |
|------|------|
| 产品需求规格说明书 | `docs/PRD-崽崽数字小屋Rimworld风格UI改造.md` |
| 合并规划文档 | `docs/2025-05-01_合并规划_崽崽数字小屋UI改造.md` |
| UI 原型 | `docs/game_assets/prototype.html` |
| Agent 弹窗原型 | `docs/game_assets/agent-popup-prototype.html` |
