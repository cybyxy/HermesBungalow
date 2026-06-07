# 🏠 Hermes 数字工作室

> **多Agent养成经营游戏** — Rimworld风格，管理你的Agent团队！

[PRD v1.1](docs/PRD-Hermes数字工作室完整版.md)
[游戏域](docs/API_CONTRACTS.md)
[Phase 7](docs/task-tracker.md)

---

## 一句话介绍

Hermes 数字工作室是一款 **Rimworld风格** 的多Agent养成经营游戏，玩家扮演城主，管理一群子Agent。通过配置Hermes Profile生成新的Agent伙伴，分配任务、维护关系、触发协作与竞争。

---

## 当前架构（2026-06-06）

| 层级           | 技术                                     | 说明                   |
| ------------ | -------------------------------------- | -------------------- |
| **前端**       | React 18 + Vite + TypeScript           | 纯 React 卡片 UI         |
| **状态管理**     | Zustand 5.x                            | 游戏状态统一管理             |
| **后端**       | Starlette + Uvicorn                    | REST API + WebSocket + SSE |
| **LLM 推理**   | hermes-agent（`~/.hermes/hermes-agent/`）| Agent 对话推理引擎          |
| **持久化**      | SQLite                                 | 本地存档                 |

---

## 快速开始

### 前置要求

- Node.js >= 18
- Python >= 3.10
- **hermes-agent** 安装到 `~/.hermes/hermes-agent/`（含 venv + 全部依赖）

### 安装 hermes-agent

```bash
cp -r /path/to/hermes-agent ~/.hermes/hermes-agent
cd ~/.hermes/hermes-agent && bash setup-hermes.sh
```

### 启动步骤

```bash
# 一键启动
bash scripts/start-dev.sh

# 或手动启动
# 1) 后端
cd backend
PYTHONPATH=. uvicorn server:app --host 0.0.0.0 --port 8765

# 2) 前端（另一个终端）
cd frontend
VITE_BACKEND_PORT=8765 npx vite --host 0.0.0.0 --port 3000
```

- 前端地址：`http://127.0.0.1:3000`
- 后端地址：`http://127.0.0.1:8765`
- 健康检查：`http://127.0.0.1:8765/health`

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  React + Zustand + TypeScript（纯卡片 UI，无游戏引擎）              │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  TopBar │   RoomGrid（房间网格）  │  RightPanel（推理面板）  │  │
│  │─────────┼──────────────────────┼────────────────────────│  │
│  │ LeftStudio│  AgentCard + RoomCard │  任务/日志列表         │  │
│  │ Panel（任务）│  对话卡片 overlay   │  推理时间线            │  │
│  │─────────┼──────────────────────┼────────────────────────│  │
│  │          BottomBar（聊天输入 + 菜单）                       │  │
│  └─────────┴──────────────────────┴────────────────────────┘  │
│                              │                                   │
│  ┌──────────────────────────┼────────────────────────────────┐ │
│  │ REST /api/*    │  WS /ws/gateway  │  SSE /api/.../stream │ │
│  └────────────────┼──────────────────┼──────────────────────┘ │
└───────────────────┼──────────────────┼─────────────────────────┘
                    │                  │
         ┌──────────┴──────────┐       │
         │   Backend :8765     │       │
         │   Starlette/Uvicorn  │       │
         │  ┌──────────────┐   │       │
         │  │ REST /api/*  │   │       │
         │  │ WS  /ws/*    │   │◄──────┘
         │  │ SSE stream   │   │
         │  │  SQLite      │   │
         │  │ LLM Events   │   │
         │  │ Task DAG     │   │
         │  └──────────────┘   │
         └──────────┬──────────┘
                    │
         ┌──────────┴──────────┐
         │  hermes-agent       │
         │  ~/.hermes/hermes-agent/
         │  LLM 推理引擎 (venv)  │
         └──────────────────────┘
```

### 技术栈

| 层级           | 技术选型                         | 说明                           |
| ------------ | ---------------------------- | ---------------------------- |
| **前端框架**     | React 18 + Vite + TypeScript | 纯卡片 UI，无游戏引擎                 |
| **状态管理**     | Zustand 5.x                  | 游戏状态、任务、事件统一管理               |
| **后端框架**     | Starlette + Uvicorn          | 高性能异步 ASGI 服务（52 条路由）        |
| **任务域 API**  | REST                         | `/api/task/*`                |
| **实时通信**    | WebSocket + SSE              | `/ws/gateway` + 编排 SSE 流       |
| **LLM 推理**   | hermes-agent                 | Agent 对话、任务编排、自然语言项目创建       |
| **持久化**      | SQLite                       | 本地存档                         |

---

## 核心概念

### Agent 系统

- **城主（主Agent）**：玩家扮演，管理基地
- **子Agent**：通过 Hermes Profile 配置生成
- **职业**：设计师、程序员、测试员、分析师、项目经理等
- **状态**：idle → working → social → resting → walking

### 任务系统

- **任务链 DAG**：任务支持 `depends_on` 前置依赖，被阻塞任务为 `locked` 状态
- **自然语言建项目**：城主输入 "我要做用户系统" → LLM 分解为多任务项目（`task_chain_create`）
- **批量创建**：支持批内依赖索引解析
- **认领机制**：仅 unlocked + pending 任务可被认领
- **协作**：多Agent合力完成高复杂度任务
- **竞争**：同职业Agent抢同一任务时随机抽签

### 会话架构

- **城主单一入口**：`POST /api/task/lord/chat` — 自动注入任务链上下文
- **消息回执**：@handoff peer 回复回注到发起者 session
- **多轮协作**：max_rounds + 产出物终止条件
- **空闲闲聊**：Agent 社交聊天（`POST /api/task/agent/social-chat`）

### 社交系统

- **打招呼**：房间相遇触发，10分钟冷却
- **情绪感染**：Agent间情绪相互影响

---

## 项目结构

```
HermesBungalow/
├── frontend/
│   └── src/
│       ├── App.tsx                          # 主入口
│       ├── main.tsx                         # React 挂载
│       ├── ui/                              # UI 组件（纯 React 卡片）
│       │   ├── CenterStage.tsx              # 主布局（TopBar + LeftPanel + RoomGrid + RightPanel + BottomBar）
│       │   ├── RoomGrid.tsx                 # 房间网格（CSS Grid）
│       │   ├── AgentCard.tsx                # Agent 卡片（头像/状态条/操作按钮）
│       │   ├── RoomCard.tsx                 # 房间卡片（Agent列表容器）
│       │   ├── ConversationCard.tsx         # 双人对话卡片
│       │   ├── StatusBar.tsx                 # 通用进度条
│       │   ├── TopBar.tsx                   # 顶栏
│       │   ├── BottomBar.tsx                # 底栏（聊天输入框 + 发送 + 图片上传 + 菜单）
│       │   ├── TaskMonitorPanel.tsx         # 左侧任务管理面板
│       │   ├── RightPanel.tsx               # 右侧推理/日志面板
│       │   ├── AgentDetailPanel.tsx         # Agent详情面板
│       │   ├── AddAgentPanel.tsx            # 添加Agent面板
│       │   ├── BottomSheetHost.tsx          # 底部抽屉（菜单/新建任务/Agent详情）
│       │   ├── MenuPanel.tsx                # 菜单面板
│       │   ├── PopupSheet.tsx               # 气泡弹窗
│       │   ├── ClarifyModal.tsx             # 澄清弹窗
│       │   ├── Modal.tsx                    # 通用弹窗
│       │   ├── AgentAvatar.tsx              # Agent头像
│       │   ├── MarkdownWorkspace.tsx         # Markdown工作区
│       │   ├── MermaidRenderer.tsx          # Mermaid图表渲染
│       │   ├── inferenceMarkdown.tsx        # 推理输出Markdown
│       │   ├── buildingLayout.ts            # 建筑布局（仅保留 isPeerVisitorAgent）
│       │   ├── spriteMap.ts                 # Sprite图谱
│       │   ├── personSprites.ts             # 人物精灵定义
│       │   ├── menuConfig.ts                # 菜单配置
│       │   └── theme.ts                     # 主题/颜色/玻璃态样式
│       ├── store/                           # Zustand 状态
│       │   ├── taskStore.ts                 # 任务世界状态
│       │   └── uiStore.ts                   # UI状态
│       ├── services/                        # 服务层
│       │   ├── gameApi.ts                   # API 导出枢纽（重导出 agentApi/taskApi/chatApi/monitorApi/multiRoundApi）
│       │   ├── agentApi.ts                  # Agent CRUD + profile
│       │   ├── taskApi.ts                   # 任务 CRUD + DAG
│       │   ├── chatApi.ts                   # 聊天 + 编排
│       │   ├── modelConfigApi.ts            # 模型/渠道配置
│       │   ├── monitorApi.ts                # 任务监视台账
│       │   ├── multiRoundApi.ts             # 多轮协作
│       │   ├── gameGateway.ts               # WebSocket 广播网关
│       │   └── multiAgentGateway.ts         # 多Agent WebSocket
│       ├── chat/                            # 聊天与编排
│       │   ├── studioChatActions.ts         # 聊天动作
│       │   ├── orchestrationUi.ts           # 编排UI
│       │   └── orchestrationSse.ts          # 编排SSE
│       └── types/
│           └── game.ts                      # 游戏类型定义（含 depends_on, parent_task_id）
├── backend/
│   ├── server.py                            # 主服务器（52 条路由 + 编排 SSE）
│   └── api/
│       ├── routes.py                        # Hermes WebUI 路由桥接
│       ├── streaming.py                     # SSE 流式引擎 + AIAgent 懒加载
│       ├── task/
│       │   ├── service.py                   # 核心任务逻辑（任务链 DAG、依赖计算、认领、批量创建）
│       │   ├── models.py                    # 数据模型（Agent, Task, Room, TaskWorld）
│       │   ├── persistence.py              # SQLite 持久化
│       │   ├── orchestration.py            # LLM 编排引擎（回执注入、多轮协作、城主入口）
│       │   ├── gateway_hub.py              # WebSocket 广播 Hub
│       │   ├── events.py                   # GAME_EVENT 解析（task_chain_create, artifact_create 等）
│       │   ├── context.py                  # LLM 上下文生成（项目创建/任务链/团队状态）
│       │   ├── agents.py                   # Agent 管理（创建/删除/sync-hermes/profile-files）
│       │   ├── task_ops.py                 # 任务 CRUD + DAG + 锁定重算
│       │   ├── peers.py                    # Agent 同伴关系逻辑
│       │   ├── receipt.py                  # 消息回执逻辑
│       │   ├── session_turn.py             # 会话回合管理
│       │   ├── multi_round.py              # 多轮协作会话
│       │   ├── stream_drain.py             # SSE 排流工具
│       │   ├── hermes_sessions.py          # Hermes 会话管理
│       │   ├── main_agent_entry.py         # 城主入口编排
│       │   ├── handoff_parser.py           # @handoff 解析
│       │   ├── monitor_store.py            # 任务监视台账
│       │   ├── monitor_ops.py              # 监控操作
│       │   ├── routes_chat.py              # 聊天/编排/多轮路由
│       │   ├── routes_task.py              # 任务路由
│       │   ├── routes_agent.py             # Agent 路由
│       │   ├── routes_model_config.py      # 模型配置路由
│       │   ├── routes_monitor.py           # 监控路由
│       │   └── _server_helpers.py          # 服务端辅助函数
│       ├── multi_agent_gateway.py          # 多Agent子进程管理
│       └── ...
├── docs/
│   ├── README.md                            # 文档索引
│   ├── PRD-Hermes数字工作室完整版.md         # PRD v1.1
│   ├── API_CONTRACTS.md                    # API 契约真源表
│   ├── task-tracker.md                      # 任务台账
│   ├── 设计规范/（7 个合并规范文档）
│   ├── 版本规划/（v2.0 规划文档）
│   ├── 原型/（13 个 HTML 原型模块）
│   └── assets/（头像、布局截图）
├── skills/
├── scripts/（start-dev.sh, stop-dev.sh, smoke test）
└── tests/（4 个测试文件）
```

---

## 项目阶段进度

| 阶段            | 内容                     | 状态     |
| ------------- | ---------------------- | ------ |
| Phase 1-2     | 项目初始化（前后端脚手架）       | ✅ 完成   |
| Phase 3       | 界面美化                 | ✅ 完成   |
| Phase 4       | 场景丰富                 | ✅ 完成   |
| Phase 5       | Phaser游戏集成 + UI组件重构  | ✅ 完成   |
| Phase 6       | 多Agent系统集成            | ✅ 完成   |
| **Phase 7**   | **架构重构（四阶段）**        | ✅ 完成   |
| ├ 任务链 DAG   | 任务级依赖 + locked 状态 + 批量创建 | ✅ 完成 |
| ├ 消息回执回路  | peer 回复回注发起者 session | ✅ 完成 |
| ├ 卡片 UI     | 移除 Phaser，纯 React 卡片布局 | ✅ 完成 |
| └ 会话架构     | 城主入口 + 任务上下文 + 多轮协作   | ✅ 完成 |

---

## MVP 功能

> **目标**：城主管理基地 → 配置Agent → 分配任务 → 社交互动

| #   | 验证项                      | 状态   |
| --- | ------------------------ | ---- |
| 1   | 基地场景加载（多房间布局）            | ✅ 完成 |
| 2   | Agent 形象 + 状态显示          | ✅ 完成 |
| 3   | WebSocket 多Agent通信       | ✅ 完成 |
| 4   | 任务分配与进度跟踪                | ✅ 完成 |
| 5   | Agent详情弹窗（属性/配置/关系）      | ✅ 完成 |
| 6   | 添加新Agent（Profile配置）      | ✅ 完成 |
| 7   | 卡片式房间网格布局               | ✅ 完成 |
| 8   | 游戏时间推进（5秒=1游戏分钟）         | ✅ 完成 |
| 9   | 任务监视面板（TaskMonitorPanel） | ✅ 完成 |
| 10  | 推理输出流式显示优化               | ✅ 完成 |
| 11  | 任务链 DAG（自然语言建项目）         | ✅ 完成 |
| 12  | 城主会话入口 + 消息回执            | ✅ 完成 |

---

## 设计文档

| 文档                                     | 说明        |
| -------------------------------------- | --------- |
| [PRD v1.1](docs/PRD-Hermes数字工作室完整版.md) | 产品需求文档    |
| [任务台账](docs/task-tracker.md)           | 当前任务进度追踪  |
| [API契约](docs/API_CONTRACTS.md)         | 接口规范      |
| [设计规范/01-游戏机制总览](docs/设计规范/01-游戏机制总览.md) | 游戏机制总览    |
| [设计规范/03-任务与竞争系统](docs/设计规范/03-任务与竞争系统.md) | 任务机制设计    |
| [设计规范/07-技术架构](docs/设计规范/07-技术架构.md) | 技术架构规范    |

---

> 📝 *"一间好的小屋，让每个走进来的Agent都知道自己该做什么、该往哪走。"* — 崽崽

**城主**: 小宝 | **最后更新**: 2026-06-08
