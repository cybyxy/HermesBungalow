# 🏠 Hermes 数字工作室

> **多Agent养成经营游戏** — Rimworld风格，管理你的Agent团队！

[![PRD v1.1](https://img.shields.io/badge/PRD-v1.1-blue)](docs/PRD-Hermes数字工作室完整版.md)
[![游戏域](https://img.shields.io/badge/游戏域-REST-blue)](docs/API_CONTRACTS.md)
[![Phase 6](https://img.shields.io/badge/Phase-6_进行中-orange)](docs/task-tracker.md)

---

## 一句话介绍

Hermes 数字工作室是一款 **Rimworld风格** 的多Agent养成经营游戏，玩家扮演城主，管理一群子Agent。通过配置Hermes Profile生成新的Agent伙伴，分配任务、维护关系、触发协作与竞争。

---

## 当前架构（2026-05-04）

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | React 18 + Vite + TypeScript | 多面板管理界面 |
| **游戏渲染** | Phaser 3.80 + A*寻路插件 | 中央基地活动空间 |
| **状态管理** | Zustand 5.x | 游戏状态统一管理 |
| **后端** | Starlette + Uvicorn | REST API + WebSocket |
| **多Agent通信** | WebSocket `/ws/gateway` + `/ws/caicai` | Agent进程间通信 |
| **持久化** | SQLite | 本地存档 |

---

## 快速开始

### 前置要求
- Node.js >= 18
- Python >= 3.10

### 启动步骤

```bash
# 1) 前端（Vite）
cd frontend
npm install
npm run dev -- --host 0.0.0.0 --port 3000

# 2) 后端（游戏 API + Gateway）
cd backend
pip install -r requirements.txt
PYTHONPATH=. python3 server.py
```

- 前端地址：`http://127.0.0.1:3000`
- 后端地址：`http://127.0.0.1:8765`
- 健康检查：`http://127.0.0.1:8765/health`

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  React + Zustand + Phaser 3.80 + TypeScript                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  TopBar │     CenterStage (Phaser Game)   │  RightPanel   │  │
│  │  44px   │     基地 + Agent导航 + 推理气泡   │  任务列表     │  │
│  │─────────┼───────────────────────────────┼───────────────│  │
│  │ LeftPanel│                             │  日志列表     │  │
│  │ 角色列表 │                             │  任务监视面板 │  │
│  │─────────┼───────────────────────────────┼───────────────│  │
│  │          BottomBar（推理流式输出）        │              │  │
│  └─────────┴───────────────────────────────┴──────────────┘  │
│                              │                                   │
│  ┌──────────────────────────┼────────────────────────────────┐ │
│  │ WebSocket /ws/gateway    │ WebSocket /ws/caicai           │ │
│  └──────────────────────────┼────────────────────────────────┘ │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   Backend :8765     │
                    │   Starlette/Uvicorn  │
                    │  ┌──────────────┐   │
                    │  │ REST /api/*  │   │
                    │  │ WS  /ws/*    │   │
                    │  │  SQLite      │   │
                    │  │ Agent进程Hub │   │
                    │  └──────────────┘   │
                    └──────────────────────┘
```

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端框架** | React 18 + Vite + TypeScript | 面板化 UI 与快速迭代 |
| **状态管理** | Zustand 5.x | 游戏状态、任务、事件统一管理 |
| **游戏渲染** | Phaser 3.80 + A*寻路插件 | 中央基地活动空间 + 智能导航 |
| **后端框架** | Starlette + Uvicorn | 高性能异步 ASGI 服务 |
| **游戏域 API** | REST | `/api/game/*` |
| **多Agent通信** | WebSocket | `/ws/gateway` + `/ws/caicai` |
| **持久化** | SQLite | 本地存档 |

---

## 核心概念

### Agent 系统
- **城主（主Agent）**：玩家扮演，管理基地
- **子Agent**：通过 Hermes Profile 配置生成
- **职业**：设计师、程序员、测试员、分析师等
- **关系阶段**：陌生 → 认识 → 朋友 → 挚友

### 任务系统
- **任务池**：自动生成，支持多复杂度
- **分配**：城主手动分配或AI自动分配
- **协作**：多Agent合力完成高复杂度任务
- **竞争**：同职业Agent抢同一任务时随机抽签
- **任务监视**：实时追踪任务状态，台账化管理（T-005 进行中）

### 社交系统
- **打招呼**：房间相遇触发，10分钟冷却
- **协作**：头顶气泡3秒 + 会话记录
- **情绪感染**：Agent间情绪相互影响

---

## 项目结构

```
HermesBungalow/
├── frontend/
│   └── src/
│       ├── App.tsx                          # 主入口（93行）
│       ├── main.tsx                         # React 挂载
│       ├── ui/                              # UI 组件
│       │   ├── TopBar.tsx                   # 顶栏
│       │   ├── CenterStage.tsx              # 中央舞台(Phaser游戏容器)
│       │   ├── LeftPanel.tsx                # 左面板（Agent列表）
│       │   ├── RightPanel.tsx               # 右面板（任务/日志）
│       │   ├── BottomBar.tsx                # 底栏（推理流式输出）
│       │   ├── TaskMonitorPanel.tsx         # 任务监视面板（411行）
│       │   ├── AgentDetailPanel.tsx         # Agent详情面板
│       │   ├── AddAgentPanel.tsx            # 添加Agent面板
│       │   ├── MenuPanel.tsx                # 菜单面板
│       │   ├── ClarifyModal.tsx             # 澄清弹窗
│       │   ├── Modal.tsx                    # 通用弹窗
│       │   ├── BottomSheetHost.tsx          # 底部抽屉
│       │   ├── PopupSheet.tsx               # 气泡弹窗
│       │   ├── AgentAvatar.tsx              # Agent头像
│       │   ├── MarkdownWorkspace.tsx         # Markdown工作区
│       │   ├── MermaidRenderer.tsx          # Mermaid图表渲染
│       │   ├── inferenceMarkdown.tsx        # 推理输出Markdown
│       │   ├── buildingLayout.ts            # 建筑布局计算
│       │   ├── fullPageLayout.ts           # 全页面布局计算
│       │   ├── spriteMap.ts                 # Sprite图谱
│       │   ├── personSprites.ts             # 人物精灵定义
│       │   ├── menuConfig.ts                # 菜单配置
│       │   └── theme.ts                     # 主题样式
│       ├── store/                           # Zustand 状态
│       │   ├── gameStore.ts                 # 游戏状态
│       │   └── uiStore.ts                   # UI状态
│       ├── services/                        # 服务层
│       │   ├── gameApi.ts                   # 游戏API（620行）
│       │   ├── gameGateway.ts               # 游戏WebSocket（103行）
│       │   └── multiAgentGateway.ts         # 多Agent网关（207行）
│       ├── chat/                            # 聊天与编排
│       │   ├── studioChatActions.ts         # 聊天动作
│       │   ├── orchestrationUi.ts           # 编排UI（136行）
│       │   └── orchestrationSse.ts          # 编排SSE（183行）
│       ├── phaser/                          # Phaser游戏引擎
│       │   ├── studioGame.ts                # 主游戏（1138行）
│       │   ├── studioShellUi.ts             # Shell UI层
│       │   ├── studioInferenceBubbles.ts    # 推理气泡
│       │   ├── studioMaskedScrollText.ts    # 滚动文字
│       │   ├── officeTiledMap.ts            # Tiled地图
│       │   ├── officeObstacleGrid.ts         # 障碍网格
│       │   ├── officeApproachPath.ts         # 寻路路径
│       │   ├── phaserPlugins.d.ts           # 插件类型
│       │   └── plugins/
│       │       ├── AStarPathfinderPlugin.ts  # A*寻路插件
│       │       ├── astarCore.ts             # A*核心算法
│       │       └── index.ts                 # 插件导出
│       ├── collab/
│       │   └── studioCollabWalkBridge.ts    # 协作行走桥接
│       ├── types/
│       │   └── game.ts                      # 游戏类型定义
│       └── utils/
│           └── publicAssetUrl.ts            # 公共资源URL
├── backend/
│   ├── server.py                            # 主服务器（1071行）
│   ├── agent_server.py                      # Agent服务进程
│   └── api/
│       ├── routes.py                        # 路由（3725行）
│       ├── game/
│       │   ├── service.py                  # 游戏业务逻辑
│       │   ├── models.py                   # 数据模型
│       │   ├── persistence.py              # 持久化（SQLite）
│       │   ├── agent.py                    # Agent逻辑
│       │   ├── competition.py             # 竞争机制
│       │   ├── gateway_hub.py             # 网关Hub
│       │   ├── handoff_parser.py          # 转交解析
│       │   ├── monitor_store.py           # 任务监视存储
│       │   └── llm_events.py             # LLM事件
│       ├── streaming.py                    # 流式输出
│       ├── profiles.py                     # Agent Profile
│       ├── hermes_personalities.py         # Agent人格
│       ├── multi_agent_gateway.py         # 多Agent网关
│       ├── agent_sessions.py              # Agent会话
│       ├── state_sync.py                  # 状态同步
│       ├── updates.py                     # 增量更新
│       ├── commands.py                    # 命令处理
│       ├── background.py                  # 后台任务
│       └── ...
├── docs/
│   ├── PRD-Hermes数字工作室完整版.md       # PRD v1.1
│   ├── task-tracker.md                    # 任务台账
│   ├── API_CONTRACTS.md                  # 接口规范
│   ├── 2.0-UI设计方向.md                 # v2.0 UI方向
│   ├── HermesBungalow2/                   # v2.0规划文档
│   └── 规划/                             # 21个子模块设计
├── skills/
│   └── Hermes数字工作室-同伴转交/          # 协作规范
└── tests/
    ├── test_game_service.py               # 游戏服务测试
    ├── test_handoff_orchestration.py      # 转交编排测试
    └── test_hermes_compression_overlay.py # 压缩覆盖测试
```

---

## 项目阶段进度

| 阶段 | 内容 | 状态 | Commit |
|------|------|------|--------|
| Phase 1-2 | 项目初始化（前后端脚手架） | ✅ 完成 | 321ef2e |
| Phase 3 | 界面美化（日夜渐变/星空粒子/时钟/能量条） | ✅ 完成 | 0d545c0 |
| Phase 4 | 场景丰富（书架/打印机/装饰画/隔板等） | ✅ 完成 | a8a4acb |
| Phase 5 | Phaser游戏集成 + UI组件重构 | ✅ 完成 | 5caf40b |
| Phase 6 | 多Agent系统集成 | 🔄 进行中 | — |
| ComfyUI Skill | Flux2-Klein图像生成技能 | ✅ 完成 | 5aefdd4 |
| 办公室草图 | 侧视图布局（最终版 v2） | ✅ 完成 | 19292c7 |

---

## MVP 功能

> **目标**：城主管理基地 → 配置Agent → 分配任务 → 社交互动

| # | 验证项 | 状态 |
|---|--------|------|
| 1 | 基地场景加载（多房间布局） | ✅ 完成 |
| 2 | Agent 形象 + 状态显示 | ✅ 完成 |
| 3 | WebSocket 多Agent通信 | ✅ 完成 |
| 4 | 任务分配与进度跟踪 | ✅ 完成 |
| 5 | Agent详情弹窗（属性/配置/关系） | ✅ 完成 |
| 6 | 添加新Agent（Profile配置） | ✅ 完成 |
| 7 | 基地布局展示（城主办/走廊/办公室等） | ✅ 完成 |
| 8 | 游戏时间推进（5秒=1游戏分钟） | ✅ 完成 |
| 9 | 任务监视面板（TaskMonitorPanel） | ✅ 完成 |
| 10 | 推理输出流式显示优化 | ✅ 完成 |
| 11 | A*寻路导航（Agent自由移动） | ✅ 完成 |
| 12 | 推理气泡（Agent头顶显示思考中） | ✅ 完成 |

---

## 设计文档

| 文档 | 说明 |
|------|------|
| [PRD v1.1](docs/PRD-Hermes数字工作室完整版.md) | 产品需求文档 |
| [任务台账](docs/task-tracker.md) | 当前任务进度追踪 |
| [API契约](docs/API_CONTRACTS.md) | 接口规范 |
| [v2.0规划](docs/HermesBungalow2/) | 任务竞争/数值平衡 |
| [规划/任务系统](docs/规划/规划-任务系统.md) | 任务机制设计 |
| [规划/社交系统](docs/规划/规划-社交系统.md) | 社交机制设计 |
| [规划/成就系统](docs/规划/规划-成就系统详细设计.md) | 成就体系设计 |
| [规划/事件系统](docs/规划/规划-事件系统详细设计.md) | 事件驱动设计 |
| [规划/协作流程状态机](docs/规划/规划-协作流程状态机.md) | 协作状态管理 |

---

## 团队成员

| 工种 | 同伴 | 状态 |
|------|------|------|
| 城主 | @崽崽 | 🟢 活跃 |
| 后端核心 | @马斯特 | 🟢 活跃 |
| 前端架构 | @陆向宇 | 🟢 活跃 |
| UI设计 | @林见溪 | 🟢 活跃 |
| 需求分析 | @顾言卿 | 🟡 待激活 |
| 系统策略 | @江定策 | 🟡 待激活 |
| 质量保障 | @秦鉴微 | 🟡 待激活 |
| 技术文档 | @苏砚书 | 🟡 待激活 |
| 技术架构 | @沈枢衡 | 🟡 待激活 |
| 快速API | @费斯特 | 🟡 待激活 |

---

> 📝 *"一间好的小屋，让每个走进来的Agent都知道自己该做什么、该往哪走。"* — 崽崽

**城主**: 小宝 | **最后更新**: 2026-05-04
