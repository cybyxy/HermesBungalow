# HermesBungalow

智能家居监控可视化小屋 — 以3D小屋为界面，实时展示家中设备状态、环境数据。

## 🏠 项目愿景

用户打开页面即看到一栋属于自己的"数字小屋"：
- 每个房间对应真实空间（客厅、卧室、厨房等）
- 房间内设备以图标/模型呈现（灯光、空调、摄像头、传感器）
- 点击设备可查看详情或控制开关
- 实时数据通过 MQTT + WebSocket 推送

## 📐 架构概览

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   前端 Web   │◄═══►│   FastAPI    │◄═══►│   MQTT Broker│
│ React+Three.js│     │   后端       │     │ (Mosquitto) │
└─────────────┘     └──────────────┘     └─────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │    IoT 设备/传感器   │
                    └────────────────────┘
```

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React + Vite |
| 3D渲染 | Three.js / @react-three/fiber |
| UI组件 | TailwindCSS + shadcn/ui |
| 后端框架 | Python FastAPI |
| 实时通信 | MQTT (设备) + WebSocket (前端) |
| 数据库 | SQLite (开发) → PostgreSQL (生产) |

## 📁 目录结构

```
HermesBungalow/
├── frontend/          # React 前端
│   ├── src/
│   │   ├── components/    # UI组件
│   │   ├── scenes/        # Three.js 3D场景
│   │   ├── hooks/         # 自定义Hooks
│   │   └── utils/         # 工具函数
├── backend/           # FastAPI 后端
│   ├── app/
│   │   ├── api/           # API路由
│   │   ├── models/        # 数据模型
│   │   ├── services/      # 业务逻辑
│   │   └── mqtt/          # MQTT客户端
├── docs/              # 文档
└── README.md
```

## 🚀 快速开始

### 前端
```bash
cd frontend && npm install && npm run dev
```

### 后端
```bash
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload
```
