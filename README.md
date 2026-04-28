# 🏠 崽崽的数字小屋

> **2D像素风交互式虚拟工作室** — 走进崽崽的办公室，跟崽崽对话，看她用表情和动作回应你！

[![PRD v1.2](https://img.shields.io/badge/PRD-v1.2-blue)](docs/PRD.md) [![Phase](https://img.shields.io/badge/Phase-2%2F6-yellow)](docs/IMPLEMENTATION_PLAN.md)

---

## 一句话介绍

崽崽的数字小屋是一个 **2D像素风** 的交互式虚拟工作室，访客可以通过对话与崽崽（软件需求分析师）互动 —— 每一次对话都会触发崽崽的表情变化、动作反应和办公室物件的互动反馈。

```
┌─────────────────────────────────────┐
│           🏠 崽崽的数字小屋          │
├──────────┬──────────┬───────────────┤
│  📚     │  🖥️      │    👋         │
│ 文档墙   │ 工作台    │   接待区      │
│          │          │               │
│ -PRD归档 │-需求分析 │  -崽崽像素形象 │
│ -用例图  │-白板     │  -对话交互    │
│ -用户故事│-咖啡杯☕ │  -欢迎动画    │
├──────────┴──────────┼───────────────┤
│                     │               │
│   🧰                │    🎨        │
│  工具架              │   展示区      │
└─────────────────────┴───────────────┘
```

---

## 快速开始

### 前置要求
- Node.js >= 18
- Python >= 3.10

### 启动步骤

```bash
# 1. 前端（React + Phaser.js）
cd frontend
npm install
npm run dev          # → http://localhost:5173

# 2. 后端（FastAPI + WebSocket）
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload   # → http://localhost:8000
```

### 静态原型预览

不想跑服务？直接打开浏览器看交互原型：

```bash
open prototype.html    # macOS
# 或直接用浏览器打开 prototype.html
```

---

## 技术架构

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   访客浏览器   │◄═══►│   Hermes Gateway  │◄═══►│    LLM 模型     │
│              │ WS  │   API Server      │ API │               │
│ React + Phaser│     │                  │     │ Qwopus / Claude │
└──────┬───────┘     └────────┬─────────┘     └─────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐     ┌────────────────┐
│ 崽崽动画引擎   │     │  语义解析模块      │
│              │◄═════│                  │
│ Phaser.js    │ 事件  │ -意图识别         │
│ -表情系统    │     │ -动作映射          |
│ -物件互动    │     │ -物件触发          |
└──────────────┘     └─────────────────┘
```

### 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端框架** | React + Vite + TypeScript | 生态成熟，开发效率高 |
| **2D渲染引擎** | Phaser.js | 专业像素游戏引擎，帧动画支持完善 |
| **UI样式** | TailwindCSS | 灵活可定制 |
| **状态管理** | Zustand | 轻量级全局状态（崽崽表情/动作） |
| **后端框架** | FastAPI (Python) | 异步高性能，原生 WebSocket 支持 |
| **数据库** | SQLite + SQLAlchemy | 简单够用，PRD文档存储 |
| **实时通信** | WebSocket | Gateway ↔ 前端双向推送崽崽状态 |

---

## 核心机制：对话驱动动画

访客发消息 → LLM回复 + **结构化事件标签** → 后端解析 → WebSocket推送 → 崽崽表情/动作变化

```json
// LLM 响应示例
{
  "reply": "这个需求我帮你看看！让我翻一下文档",
  "events": [
    {"type": "expression", "value": "thinking", "duration": 2000},
    {"type": "action", "value": "search_documents", "target": "desk_drawer"}
  ]
}
```

### 崽崽状态机

```
┌─────────┐     ┌──────────┐     ┌──────────┐
│  IDLE    │────►│ THINKING │────►│ WORKING  |
│ (待机)   │     │ (思考中)  │     │ (工作中)  |
└─────────┘     └──────────┘     └──────────┘
     ▲                │               │
     │                ▼               ▼
     │           ┌──────────┐   ┌──────────┐
     └──────────│ TALKING  │◄──│ SEARCHING│
                │ (对话中)  │   │ (查找文件)│
                └──────────┘   └──────────┘
```

---

## 项目结构

```
HermesBungalow/
├── frontend/                  # React + Phaser.js 前端
│   ├── src/
│   │   ├── game/              # Phaser游戏逻辑
│   │   │   ├── GameScene.ts   # 主场景：崽崽小屋
│   │   │   └── entities/      # 精灵实体（崽崽）
│   │   ├── ui/                # React UI覆盖层
│   │   │   ├── DialogBox.tsx  # 对话框
│   │   │   └── Sidebar.tsx    # 侧边栏导航
│   │   ├── store/             # Zustand状态管理
│   │   └── services/          # API + WebSocket客户端
│   └── public/assets/         # 像素素材（精灵图、瓦片）
├── backend/                   # FastAPI 后端
│   ├── app/
│   │   ├── api/               # 路由层
│   │   │   ├── gateway.py     # Hermes Gateway桥接 + WebSocket
│   │   │   └── prd.py         # PRD文档CRUD
│   │   ├── services/          # 业务逻辑
│   │   │   ├── gateway_bridge.py      # Gateway通信服务
│   │   │   ├── event_mapper.py        # 语义→事件映射引擎
│   │   │   └── state_machine.py       # 崽崽状态机管理
│   │   └── models/            # 数据模型
│   └── requirements.txt
├── docs/                      # 需求文档
│   ├── PRD.md                 # 产品需求文档 v1.2
│   └── IMPLEMENTATION_PLAN.md # 实现路径规划（6个Phase）
├── Assets/                    # 原始素材库
├── prototype.html             # 可交互静态原型
└── README.md                  # ← 你在这里
```

---

## MVP 目标

> **走进像素办公室 → 跟崽崽对话 → 崽崽有表情和动作回应 → 能查看文档**

| # | 验证项 | 状态 |
|---|--------|------|
| 1 | 2D像素办公室场景加载（office.png） | 🟡 代码已写，待联调 |
| 2 | 崽崽精灵 + 表情切换（expression1/expression2） | 🟡 代码已写，待联调 |
| 3 | Hermes Gateway 桥接层跑通 | 🟡 后端未启动验证 |
| 4 | 访客→崽崽对话→表情/动作变化 | 🟡 全链路待端到端测试 |
| 5 | 文档墙展示PRD列表 | ⬜ DocumentWall组件缺失 |
| 6 | 崽崽行走和挥手动画 | 🟡 代码已写，待联调 |

---

## 实现路线图

详见 [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

```
Phase 1: 项目脚手架搭建 ✅ (代码完成，环境待验证)
Phase 2: Phaser像素场景   🟡 (核心逻辑已写，缺TilemapLoader/HotzoneManager)
Phase 3: Gateway桥接      🟡 (全链路代码存在，待联调)
Phase 4: 崽崽交互系统     🟡 (事件→动画映射已实现)
Phase 5: 文档墙+UI覆盖层  ⬜ (缺DocumentWall组件)
Phase 6: 联调测试         ⬜
```

---

## 视觉风格

- **画风**: 2D像素艺术（Pixel Art）
- **分辨率**: 320×180 拉伸到 16:9，保留像素颗粒感
- **调色板**: 复古暖色调（参考 PICO-8 / GBA 风格）
- **字体**: Press Start 2P 像素字体

---

## 文档

| 文档 | 链接 |
|------|------|
| 📋 PRD v1.2 | [docs/PRD.md](docs/PRD.md) |
| 🗺️ 实现路径 | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |
| 🎨 交互原型 | [prototype.html](prototype.html) |

---

> 📝 *"一个好的需求文档，就像一间好的小屋——让走进来的人感到温暖且知道该往哪走。"* — 崽崽

**作者**: 崽崽（需求分析师） | **老板**: 小宝 | **日期**: 2026-04-28
