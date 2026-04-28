# 崽崽的数字小屋 — 实现路径规划

> **版本**: v1.1 | **作者**: 崽崽（需求分析师） | **日期**: 2026-04-28

---

## 任务链总览

```
Phase 1: 项目脚手架搭建 ✅ (已完成)
    ↓
Phase 2: 前端核心 — Phaser像素场景 ✅ (已完成)
    ↓
Phase 3: 后端 API + Gateway桥接 ✅ (已完成)
    ↓
Phase 4: 崽崽交互系统 ✅ (已完成)
    ↓
Phase 5: 文档墙 + UI覆盖层 🟡 (基础完成，待丰富交互)
    ↓
Phase 6: 联调测试 🟡 (部分验证通过，待完整端到端测试)
```

---

## Phase 1: 项目脚手架搭建 ✅

### T1: 前端 React + Vite + Phaser.js 初始化
- [x] `npm create vite@latest frontend -- --template react-ts`
- [x] 安装依赖：`phaser`, `zustand`, `axios`
- [x] 配置 TailwindCSS
- [x] 复制素材到 `public/assets/`

### T2: 后端 FastAPI + SQLite 初始化
- [x] 创建虚拟环境
- [x] 安装依赖：`fastapi`, `uvicorn`, `sqlalchemy`, `aiosqlite`
- [x] 搭建项目目录结构
- [x] 编写基础路由

### T3: PRD 文档归档入库
- [x] SQLite 建表（PRD表、留言表）
- [x] 导入已有 PRD.md 作为种子数据
- [x] 实现 CRUD API

---

## Phase 2: 前端核心 — Phaser像素场景 ✅

### T4: Phaser 游戏引擎集成
- [x] 创建 `GameScene.ts` — 主场景加载
- [x] 配置 Phaser 渲染器（320x180 → 拉伸到16:9）
- [x] React + Phaser Canvas 融合方案

### T5: 办公室场景瓦片地图
- [x] `buildCozyScene()` — 绘制像素墙壁、地板、窗户
- [x] 放置办公桌、书架、白板、沙发等物件
- [x] 氛围灯光效果

### T6: 崽崽精灵实体
- [x] `Caicai.ts` — 精灵加载 expression1/expression2
- [x] 帧动画系统（待机呼吸、行走四方向）
- [x] 表情切换机制（showExpression + 头顶气泡）

### T7: 场景热区 + 点击交互
- [x] 崽崽点击触发 `caicai-click` 事件
- [x] 咖啡杯交互区（点击 → 加咖啡 → 崽崽转圈）
- [x] 迎宾动画（崽崽从沙发跑过来打招呼+挥手）

---

## Phase 3: 后端 API + Gateway桥接 ✅

### T8: Hermes Gateway 桥接层
- [x] `gateway_bridge.py` — 通过 `resolve_runtime_provider()` 动态获取 LLM 配置
- [x] MiniMax Anthropic 兼容 API (`/v1/messages`) 分支
- [x] `event_mapper.py` — 语义解析 → 事件标签生成
- [x] `state_machine.py` — 崽崽状态机管理（IDLE→THINKING→WORKING）

### T9: WebSocket 实时推送
- [x] FastAPI WebSocket 端点 `/ws/caicai`
- [x] Gateway 回复 + 事件标签 → WS 推送前端
- [x] 心跳检测（30s ping/pong）+ 断线重连（指数退避）

### T10: API 路由完善
- [x] `GET /api/prd` — PRD列表
- [x] `POST /api/chat` — 对话接口
- [x] `WS /ws/caicai` — 崽崽状态推送
- [x] Session 管理（hermes-webui `/api/session/new` + `/api/chat/start` + `/api/chat/stream`）

---

## Phase 4: 崽崽交互系统 ✅

### T11: 前端 WebSocket 客户端
- [x] `ws.ts` — 连接后端 WS（心跳+指数退避重连）
- [x] Zustand store 接收事件（token/caicai_event/chat_reply/error）
- [x] 事件 → Phaser 动画映射（caicai-action → GameScene.handleAction）

### T12: 对话 UI 覆盖层
- [x] `DialogBox.tsx` — 崽崽说话气泡
- [x] 连接状态指示器（🟢在线/🔵连接中/🟡重连中/🔴断开）
- [x] 打字机效果（三个跳动圆点）
- [x] 欢迎占位消息（首次无消息时显示）
- [x] 快捷指令按钮（📋查看PRD/🚀了解项目/☕加咖啡）

### T13: 崽崽动作系统
- [x] LLM回复 → 表情变化 + 动作触发
- [x] "挥手" → wave_hand + 挥手动画
- [x] "转圈" → spin + 旋转360°
- [x] "点头/摇头" → nod_head / shake_head
- [x] "查文档" → search_documents + 走向工作区
- [x] "喝咖啡" → drink_coffee + 走向咖啡区
- [x] 语义关键词兜底（回复含"咖啡"→喝咖啡，含"文档"→查文档）

---

## Phase 5: 文档墙 + UI覆盖层 🟡

### T14: 文档墙组件
- [x] `Sidebar.tsx` — 侧边栏导航（小屋/文档墙/工具架/展示区）
- [x] `DocumentWall` 组件 — PRD列表展示（静态卡片，无点击详情）
- [ ] 搜索过滤功能
- [ ] 点击展开PRD详情（Markdown渲染）

### T15: 侧边栏导航 + 工具架
- [x] `Sidebar.tsx` — 小屋/文档墙/工具架/展示区切换
- [x] `ToolShelf` 组件 — 5W2H/MoSCoW/用户故事/需求跟踪矩阵展示
- [ ] 工具架交互（点击卡片展开说明）

---

## Phase 6: 联调测试 🟡

### T16: MVP 端到端验证
- [x] 打开页面 → 像素办公室场景加载成功
- [x] 点击崽崽 → 弹出对话框
- [x] 发送消息 → LLM回复 + 崽崽表情变化 ✅ **（2026-04-28 验证通过）**
- [ ] "查看PRD" → 文档墙展示列表
- [ ] "加咖啡" → 咖啡杯蒸汽动画增强
- [x] WebSocket 断线重连测试 ✅

---

## MVP 完成标准

> ✅ **走进像素办公室 → 跟崽崽对话 → 崽崽有表情和动作回应 → 能查看文档**

| # | 验证项 | 状态 | 备注 |
|---|--------|------|------|
| 1 | 2D像素办公室场景加载（office.png/tiles素材） | ✅ 完成 | 使用 tiles/ 目录素材构建温馨小屋 |
| 2 | 崽崽精灵 + 表情切换（expression1/expression2） | ✅ 完成 | 头顶气泡表情+四方向行走动画 |
| 3 | Hermes Gateway 桥接层跑通 | ✅ 完成 | MiniMax API 正常响应 |
| 4 | 访客→崽崽对话→表情/动作变化 | ✅ 完成 | WebSocket全链路验证通过 |
| 5 | 文档墙展示PRD列表 | 🟡 基础完成 | 静态卡片，待丰富交互 |
| 6 | 崽崽行走和挥手动画 | ✅ 完成 | 迎宾动画+多种动作支持 |

---

## 下一步计划

### 高优先级
1. **端到端联调** — 前端(3000) → Backend(8000) → MiniMax 全流程实测
2. **文档墙详情** — 点击卡片展示 Markdown 文档内容
3. **会话持久化** — 刷新页面后对话历史保留

### 中优先级
4. **工具架交互** — 点击 5W2H/MoSCoW 卡片展开分析说明
5. **咖啡杯蒸汽效果** — 粒子动画增强
6. **欢迎消息触发** — 首次进入时 DialogBox 显示崽崽欢迎语

### 低优先级（V2）
7. **TTS语音** — 崽崽用声音回应
8. **多房间扩展** — 卧室、厨房
9. **访客留言簿** — 持久化留言

---

> 📝 *"实现路径就像需求分析——先拆解，再逐个击破。"* — 崽崽
