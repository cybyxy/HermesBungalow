# 🏠 崽崽的数字小屋

> **2D像素风交互式虚拟工作室** — 走进崽崽的办公室，跟崽崽对话，看她用表情和动作回应你！

[![PRD v1.3](https://img.shields.io/badge/PRD-v1.3-blue)](docs/PRD.md) [![Phase](https://img.shields.io/badge/Phase-6%2F6-yellow)](docs/IMPLEMENTATION_PLAN.md)

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
npm run dev          # → http://localhost:3000

# 2. 后端（FastAPI + WebSocket）
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000   # → http://localhost:8000
```

> ⚠️ 启动前端前，确认端口 3000 未被占用；启动后端前，确认端口 8000 未被占用。

---

## 技术架构

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   访客浏览器   │◄═══►│   Hermes Gateway  │◄═══►│    LLM 模型     │
│              │ WS  │   API Server      │ API │               │
│ React + Phaser│     │                  │     │ MiniMax / Claude │
└──────┬───────┘     └────────┬─────────┘     └─────────────────┘
       │                      │
       ▼                      ▼
┌──────────────┐     ┌────────────────┐
│ 崽崽动画引擎   │     │  语义解析模块      │
│              │◄═════│                  │
│ Phaser.js    │ 事件  │ -意图识别         │
│ -表情系统    │     │ -动作映射          │
│ -物件互动    │     │ -物件触发          │
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
│  IDLE    │────►│ THINKING │────►│ WORKING  │
│ (待机)   │     │ (思考中)  │     │ (工作中)  │
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
│   │   │   ├── ClockDisplay.tsx  # 右上角时钟
│   │   │   ├── StarryBackground.tsx  # 星空粒子背景
│   │   │   ├── TimeAwareBackground.tsx  # 日夜渐变背景
│   │   │   └── Sidebar.tsx     # 侧边栏导航
│   │   ├── store/              # Zustand状态管理
│   │   │   └── gameState.ts    # 崽崽表情/动作/咖啡能量
│   │   └── services/           # API + WebSocket客户端
│   └── public/assets/           # 像素素材（精灵图、瓦片）
├── backend/                    # FastAPI 后端
│   ├── app/
│   │   ├── api/                # 路由层
│   │   │   ├── gateway.py      # Hermes Gateway桥接 + WebSocket
│   │   │   └── prd.py         # PRD文档CRUD
│   │   ├── services/           # 业务逻辑
│   │   │   ├── gateway_bridge.py     # Gateway通信服务
│   │   │   ├── event_mapper.py       # 语义→事件映射引擎
│   │   │   └── state_machine.py      # 崽崽状态机管理
│   │   └── models/             # 数据模型
│   └── requirements.txt
├── docs/                       # 需求文档
│   ├── PRD.md                  # 产品需求文档 v1.3
│   ├── IMPLEMENTATION_PLAN.md  # 实现路径规划（6个Phase）
│   ├── INTERFACE_DESIGN.md     # 界面美化设计规范
│   └── CHAT_MODULE_PRD.md      # 聊天模块PRD
├── Assets/                     # 原始素材库
├── prototype.html              # 可交互静态原型
└── README.md                   # ← 你在这里
```

---

## MVP 目标

> **走进像素办公室 → 跟崽崽对话 → 崽崽有表情和动作回应 → 能查看文档**

| # | 验证项 | 状态 | 备注 |
|---|--------|------|------|
| 1 | 2D像素办公室场景加载（tiles素材） | ✅ 完成 | 使用 tiles/ 目录素材构建温馨小屋 |
| 2 | 崽崽精灵 + 表情切换（expression1/expression2） | ✅ 完成 | 头顶气泡表情+四方向行走动画 |
| 3 | Hermes Gateway 桥接层跑通 | ✅ 完成 | MiniMax API 正常响应（2026-04-28 验证） |
| 4 | 访客→崽崽对话→表情/动作变化 | ✅ 完成 | WebSocket全链路验证通过 |
| 5 | 文档墙展示PRD列表 | ✅ 完成 | DialogBox内展示 |
| 6 | 崽崽行走和挥手动画 | ✅ 完成 | 迎宾动画+多种动作支持 |
| 7 | 崽崽能量系统（咖啡能量条） | ✅ 完成 | 能量衰减/补充/耗尽提示 |
| 8 | 可交互时钟（hover放大+实时时间） | ✅ 完成 | Phaser Graphics绘制，DOM浮层展示 |
| 9 | 日夜渐变背景+星空粒子+扫描线噪点 | ✅ 完成 | 8时段自动切换 |
| 10 | 崽崽欢迎消息+快捷指令 | ✅ 完成 | ☕加咖啡/📋查看PRD/🚀了解项目 |

---

## 实现路线图

详见 [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md)

```
Phase 1: 项目脚手架搭建     ✅ (已完成)
Phase 2: 前端核心 — Phaser像素场景  ✅ (已完成)
Phase 3: Gateway桥接         ✅ (已完成，MiniMax API已验证)
Phase 4: 崽崽交互系统       ✅ (已完成)
Phase 5: 文档墙+UI覆盖层    ✅ (已完成)
Phase 6: 联调测试           ✅ (已完成)
```

---

## 视觉风格

- **画风**: 2D像素艺术（Pixel Art）
- **分辨率**: 320×180 拉伸到 16:9，保留像素颗粒感
- **调色板**: 复古暖色调（参考 PICO-8 / GBA 风格）
- **字体**: Press Start 2P 像素字体
- **氛围**: 深空紫主题 + 日夜渐变 + 星空粒子 + CRT扫描线质感

---

## 界面特色功能

| 功能 | 说明 |
|------|------|
| **崽崽能量条** | 崽崽头像旁的咖啡能量条，三色状态，绿/黄/红直观显示 |
| **日夜渐变背景** | 8时段（深夜/凌晨/早晨/上午/中午/下午/傍晚/晚上）自动切换，2秒平滑过渡 |
| **星空粒子背景** | 80颗漂浮星点，透明度随时间段变化，夜间清晰可见 |
| **CRT扫描线+噪点** | 复古显示器质感 |
| **可交互时钟** | 鼠标悬停墙上时钟 → 放大3.5倍 + DOM浮层显示实时时间（跳动动画） |
| **清空对话按钮** | 聊天区域右上角一键清空对话历史 |
| **用户气泡增强** | 粉色渐变气泡 + 边框 + 阴影光晕 |
| **崽崽表情切换** | 😀开心 / 🤔思考 / 💧流汗 三档可切换 |

---

## 文档

| 文档 | 链接 |
|------|------|
| 📋 PRD v1.3 | [docs/PRD.md](docs/PRD.md) |
| 🗺️ 实现路径 | [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) |
| 🎨 界面设计 | [docs/INTERFACE_DESIGN.md](docs/INTERFACE_DESIGN.md) |
| 💬 聊天模块PRD | [docs/CHAT_MODULE_PRD.md](docs/CHAT_MODULE_PRD.md) |
| 🎮 交互原型 | [prototype.html](prototype.html) |

---

> 📝 *"一个好的需求文档，就像一间好的小屋——让走进来的人感到温暖且知道该往哪走。"* — 崽崽

**作者**: 崽崽（需求分析师） | **老板**: 小宝 | **日期**: 2026-04-29
