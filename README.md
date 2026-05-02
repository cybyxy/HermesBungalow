# 🏠 Hermes 数字工作室

> **多Agent养成经营游戏** — Rimworld风格，管理你的Agent团队！

[![PRD v1.1](https://img.shields.io/badge/PRD-v1.1-blue)](docs/PRD-Hermes数字工作室完整版.md) [![游戏域](https://img.shields.io/badge/游戏域-REST-blue)](docs/API_CONTRACTS.md)

---

## 一句话介绍

Hermes 数字工作室是一款 **Rimworld风格** 的多Agent养成经营游戏，玩家扮演城主，管理一群子Agent。通过配置Hermes Profile生成新的Agent伙伴，分配任务、维护关系、触发协作与竞争。

---

## 当前架构（2026-05-02）

| 层级 | 技术 | 说明 |
|------|------|------|
| **前端** | React 18 + Vite + TypeScript | 多面板管理界面 |
| **状态管理** | Zustand 5.x | 游戏状态统一管理 |
| **游戏渲染** | Phaser 3.80 | 中央活动空间 |
| **后端** | Starlette + Uvicorn | 游戏域 REST + WebSocket |
| **持久化** | SQLite | 本地存档 |
| **多Agent** | WebSocket `/ws/gateway` | Agent间通信 |

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
- 后端地址：`http://127.0.0.1:8000`
- 健康检查：`http://127.0.0.1:8000/health`

---

## 技术架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (Browser)                          │
│  React + Zustand + Phaser + TypeScript                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  TopBar │     CenterStage (Phaser)      │  RightPanel   │  │
│  │  44px   │     基地建筑 + Agent活动        │  任务列表     │  │
│  │─────────┼───────────────────────────────┼───────────────│  │
│  │ LeftPanel│                             │  日志列表     │  │
│  │ 角色列表 │                             │              │  │
│  └─────────┴───────────────────────────────┴──────────────┘  │
│                              │ WebSocket                        │
└──────────────────────────────┼──────────────────────────────────┘
                               │
                    ┌──────────┴──────────┐
                    │   Backend (Python)   │
                    │   Starlette/Uvicorn  │
                    │  ┌──────────────┐   │
                    │  │ REST /api/*  │   │
                    │  │ WS  /ws/*    │   │
                    │  │   SQLite     │   │
                    │  └──────────────┘   │
                    └─────────────────────┘
```

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端框架** | React + Vite + TypeScript | 面板化 UI 与快速迭代 |
| **状态管理** | Zustand 5.x | 游戏状态、任务、事件统一管理 |
| **游戏渲染** | Phaser 3.80 | 中央基地活动空间 |
| **后端框架** | Starlette + Uvicorn | 高性能异步 ASGI 服务 |
| **游戏域 API** | REST | `/api/game/*` |
| **多Agent通信** | WebSocket | `/ws/gateway` |
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
│       ├── App.tsx                 # 主入口
│       ├── ui/                     # UI 组件
│       │   ├── TopBar.tsx          # 顶栏
│       │   ├── CenterStage.tsx     # 中央舞台(Phaser)
│       │   ├── RightPanel.tsx      # 右面板
│       │   ├── LeftPanel.tsx       # 左面板
│       │   ├── BottomBar.tsx       # 底栏
│       │   ├── AgentDetailModal.tsx # Agent详情弹窗
│       │   ├── AddAgentModal.tsx   # 添加Agent弹窗
│       │   └── ...
│       ├── store/                  # Zustand 状态
│       │   ├── gameStore.ts        # 游戏状态
│       │   └── uiStore.ts          # UI状态
│       ├── services/               # 服务层
│       │   ├── gameApi.ts          # 游戏API
│       │   └── websocketService.ts # WebSocket
│       └── types/                  # 类型定义
├── backend/
│   ├── server.py                   # 主服务器入口
│   ├── agent_server.py             # Agent服务
│   └── api/
│       ├── game/                   # 游戏域
│       │   ├── service.py          # 游戏业务逻辑
│       │   ├── models.py           # 数据模型
│       │   └── persistence.py      # 持久化
│       ├── multi_agent_gateway.py  # 多Agent网关
│       └── hermes_personalities.py # Agent人格
├── docs/
│   ├── PRD-Hermes数字工作室完整版.md  # PRD v1.1
│   ├── 项目进度-2026-05-02.md       # 项目进度报告
│   └── 规划/                        # 21个子模块设计
└── skills/
    └── Hermes数字工作室-多Agent辩论协作/          # 辩论协作规范
```

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
| 8 | 游戏时间推进（5秒=1分钟） | ✅ 完成 |

---

## 设计文档

| 文档 | 说明 |
|------|------|
| [PRD v1.1](docs/PRD-Hermes数字工作室完整版.md) | 产品需求文档 |
| [项目进度](docs/项目进度-2026-05-02.md) | 当前状态报告 |
| [API契约](docs/API_CONTRACTS.md) | 接口规范 |
| [规划/任务系统](docs/规划/规划-任务系统.md) | 任务机制设计 |
| [规划/社交系统](docs/规划/规划-社交系统.md) | 社交机制设计 |
| [规划/成就系统](docs/规划/规划-成就系统详细设计.md) | 成就体系设计 |
| [规划/事件系统](docs/规划/规划-事件系统详细设计.md) | 事件驱动设计 |

---

> 📝 *"一间好的小屋，让每个走进来的Agent都知道自己该做什么、该往哪走。"* — 崽崽

**城主**: 小宝 | **日期**: 2026-05-02
