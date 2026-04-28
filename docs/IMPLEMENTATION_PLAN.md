# 崽崽的数字小屋 — 实现路径规划

> **版本**: v1.0 | **作者**: 崽崽（需求分析师） | **日期**: 2026-04-28

---

## 任务链总览

```
Phase 1: 项目脚手架搭建 (T1-T3)
    ↓
Phase 2: 前端核心 — Phaser像素场景 (T4-T7)
    ↓
Phase 3: 后端 API + Gateway桥接 (T8-T10)
    ↓
Phase 4: 崽崽交互系统 (T11-T13)
    ↓
Phase 5: 文档墙 + UI覆盖层 (T14-T15)
    ↓
Phase 6: 联调测试 (T16)
```

---

## Phase 1: 项目脚手架搭建

### T1: 前端 React + Vite + Phaser.js 初始化
- [ ] `npm create vite@latest frontend -- --template react-ts`
- [ ] 安装依赖：`phaser`, `zustand`, `axios`
- [ ] 配置 TailwindCSS
- [ ] 复制素材到 `public/assets/`

### T2: 后端 FastAPI + SQLite 初始化
- [ ] 创建虚拟环境
- [ ] 安装依赖：`fastapi`, `uvicorn`, `sqlalchemy`, `aiosqlite`
- [ ] 搭建项目目录结构
- [ ] 编写基础路由

### T3: PRD 文档归档入库
- [ ] SQLite 建表（PRD表、留言表）
- [ ] 导入已有 PRD.md 作为种子数据
- [ ] 实现 CRUD API

---

## Phase 2: 前端核心 — Phaser像素场景

### T4: Phaser 游戏引擎集成
- [ ] 创建 `GameScene.ts` — 主场景加载
- [ ] 配置 Phaser 渲染器（320x180 → 拉伸到16:9）
- [ ] React + Phaser Canvas 融合方案

### T5: 办公室场景瓦片地图
- [ ] `TilemapLoader.ts` — 解析 office.png 素材
- [ ] 绘制像素墙壁、地板、窗户
- [ ] 放置办公桌、书架、白板等物件

### T6: 崽崽精灵实体
- [ ] `Caicai.ts` — 精灵加载 expression1/expression2
- [ ] 帧动画系统（待机呼吸、行走）
- [ ] 表情切换机制

### T7: 场景热区 + 点击交互
- [ ] `HotzoneManager.ts` — 办公桌/咖啡杯/崽崽等可点击区域
- [ ] `ClickHandler.ts` — 点击崽崽触发对话
- [ ] 物件互动（加咖啡、打开抽屉）

---

## Phase 3: 后端 API + Gateway桥接

### T8: Hermes Gateway 桥接层
- [ ] `gateway_bridge.py` — HTTP POST → LLM → 结构化回复
- [ ] `event_mapper.py` — 语义解析 → 事件标签生成
- [ ] `state_machine.py` — 崽崽状态机管理（IDLE→THINKING→WORKING）

### T9: WebSocket 实时推送
- [ ] FastAPI WebSocket 端点
- [ ] Gateway 回复 + 事件标签 → WS 推送前端
- [ ] 心跳检测 + 断线重连

### T10: API 路由完善
- [ ] `GET /api/prd` — PRD列表
- [ ] `POST /api/chat` — 对话接口
- [ ] `WS /ws/caicai` — 崽崽状态推送

---

## Phase 4: 崽崽交互系统

### T11: 前端 WebSocket 客户端
- [ ] `ws.ts` — 连接后端 WS
- [ ] Zustand store 接收事件
- [ ] 事件 → Phaser 动画映射

### T12: 对话 UI 覆盖层
- [ ] `DialogBox.tsx` — 崽崽说话气泡
- [ ] 打字机效果（逐字显示）
- [ ] 快捷指令按钮

### T13: 崽崽动作系统
- [ ] LLM回复 → 表情变化 + 动作触发
- [ ] "让我想想" → thinking表情 + 托腮动画
- [ ] "好的！" → happy表情 + 挥手
- [ ] "查文档" → confused→thinking + 翻找抽屉

---

## Phase 5: 文档墙 + UI覆盖层

### T14: 文档墙组件
- [ ] `DocumentWall.tsx` — PRD列表展示
- [ ] 搜索过滤功能
- [ ] 点击展开PRD详情（Markdown渲染）

### T15: 侧边栏导航 + 工具架
- [ ] `Sidebar.tsx` — 小屋/文档墙/工具架/展示区切换
- [ ] MoSCoW标签可视化
- [ ] 5W2H分析卡片

---

## Phase 6: 联调测试

### T16: MVP 端到端验证
- [ ] 打开页面 → 像素办公室场景加载成功
- [ ] 点击崽崽 → 弹出对话框
- [ ] 发送消息 → LLM回复 + 崽崽表情变化
- [ ] "查看PRD" → 文档墙展示列表
- [ ] "加咖啡" → 咖啡杯蒸汽动画增强
- [ ] WebSocket 断线重连测试

---

## MVP 完成标准

> ✅ **走进像素办公室 → 跟崽崽对话 → 崽崽有表情和动作回应 → 能查看文档**

| # | 验证项 | 状态 |
|---|--------|------|
| 1 | 2D像素办公室场景加载（office.png） | ⬜ |
| 2 | 崽崽精灵 + 表情切换（expression1/expression2） | ⬜ |
| 3 | Hermes Gateway 桥接层跑通 | ⬜ |
| 4 | 访客→崽崽对话→表情/动作变化 | ⬜ |
| 5 | 文档墙展示PRD列表 | ⬜ |
| 6 | 崽崽行走和挥手动画 | ⬜ |

---

> 📝 *"实现路径就像需求分析——先拆解，再逐个击破。"* — 崽崽
