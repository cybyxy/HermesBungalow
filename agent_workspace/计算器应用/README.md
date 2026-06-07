# Calculator Web Application

一个支持加减乘除、百分比功能的计算器 Web 应用，前后端分离架构。

## 技术栈

| 层 | 技术 | 说明 |
|:---|:---|:---|
| 前端 | React 18 + TypeScript + Vite | 单页应用 |
| 计算 | big.js | 精确浮点运算 |
| 样式 | 原生 CSS (CSS Variables) | 响应式设计 |
| 后端 | Python 3.12 + FastAPI + Uvicorn | REST API |
| 部署 | Docker + Docker Compose | 一键编排 |

## 快速开始

### 开发环境

```bash
# 1. 启动后端 (端口 4001)
cd backend
pip install -r requirements.txt
python3 main.py

# 2. 启动前端 (端口 4000)
cd frontend
npm install
npm run dev
```

访问 http://localhost:4000

### Docker 部署

```bash
docker-compose up --build
```

访问 http://localhost:4000

## API 接口

| Method | Path | 说明 |
|:---|:---|:---|
| GET | `/api/health` | 健康检查 |
| POST | `/api/calc` | 计算表达式 `{"expression": "125 + 37"}` |
| GET | `/api/history` | 获取计算历史 `?limit=20` |

### 计算接口响应

```json
// 成功
{"result": "162"}

// 错误 (400)
{"detail": "除数不能为零"}
```

## 功能特性

- ✅ 基本运算：加、减、乘、除
- ✅ 百分比计算
- ✅ 正负切换 (±)
- ✅ 退格 (⌫)
- ✅ 连续运算（按运算符优先级）
- ✅ 浮点精度处理（big.js）
- ✅ 键盘映射（数字键 + 运算符 + Enter/Backspace/Esc）
- ✅ 移动端响应式适配
- ✅ AST 安全表达式求值（后端）

## 项目结构

```
计算器应用/
├── frontend/                 # React 前端
│   ├── src/
│   │   ├── App.tsx           # 根组件
│   │   ├── main.tsx          # 入口
│   │   ├── index.css         # 全局样式
│   │   ├── hooks/
│   │   │   └── useCalculator.ts  # 计算器状态逻辑
│   │   └── components/
│   │       ├── Display.tsx       # 显示屏
│   │       └── ButtonGrid.tsx    # 按钮网格
│   ├── vite.config.ts
│   └── Dockerfile
├── backend/                  # FastAPI 后端
│   ├── main.py               # API 服务
│   ├── requirements.txt
│   └── Dockerfile
├── docker-compose.yml        # 编排文件
└── README.md
```

## License

MIT
