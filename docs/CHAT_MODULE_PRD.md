# 📋 聊天模块需求规格说明书

> **版本**: v1.0 | **日期**: 2026-04-28 | **作者**: 崽崽 | **老板**: 小宝

---

## 一、背景与目标

### 1.1 背景
崽崽的数字小屋已有基础对话能力（HTTP API + 降级回复），但缺少完整的实时聊天体验。需要构建四个核心模块，实现访客与崽崽之间的流畅交互。

### 1.2 目标
```
┌─────────── 访客 ───────────┐
│                            │
│  输入文字 / 发送图片        │
│       ↓                    │
│  WebSocket → 后端 → LLM    │
│       ↓                    │
│  崽崽回复 + 表情/动作反馈   │
│       ↓                    │
│  消息气泡展示              │
└────────────────────────────┘
```

### 1.3 MVP 范围（MoSCoW）

| # | 需求项 | 优先级 | 说明 |
|---|--------|--------|------|
| M1 | WebSocket 连接管理 | **Must** | 稳定连接、自动重连、心跳保活 |
| M2 | 聊天界面组件 | **Must** | 输入框、发送按钮、消息气泡、打字指示器 |
| M3 | 图片支持（文件选择 + 粘贴） | **Should** | 发送/接收图片消息 |
| S1 | 事件处理器增强 | **Could** | 表情/动作事件的视觉反馈联动 |

---

## 二、模块详细规格

### 2.1 WebSocket 连接管理模块

#### 2.1.1 现状分析
- ✅ 已有 `connectWS()` / `sendChatMessage()` / `handleWSEvent()` 基础骨架
- ❌ 缺少心跳保活机制
- ❌ 重连策略过于简单（固定3秒，无指数退避）
- ❌ 图片消息无法通过 WS 发送
- ❌ 连接状态未暴露给 UI

#### 2.1.2 需求规格

**A. 连接生命周期管理**

```
┌──────────┐    ┌───────┐    ┌───────┐    ┌───────┐
│   DISCONNECTED  │──►│ CONNECTING │──►│   OPEN    │──►│ CLOSED   │
└──────────┘    └───────┘    └───────┘    └───────┘
     ▲                                      │
     │          ┌───────┐                    │
     └──────────│ RECONNECTING ◄─────────────┘
                └───────┘
```

**B. 重连策略（指数退避）**

| 重试次数 | 延迟 | 最大延迟 |
|----------|------|----------|
| 1 | 1s | - |
| 2 | 2s | - |
| 3 | 4s | - |
| 4+ | 8s（上限） | 8s |

**C. 心跳保活**
- 间隔：每 30s 发送一次 `ping` 消息
- 超时：60s 未收到 `pong` 则判定连接失效，触发重连

**D. 图片传输协议**

```json
// 文字消息（现有）
{ "type": "chat", "message": "你好崽崽" }

// 图片消息（新增）
{
  "type": "chat",
  "message": "看这个截图",
  "image": {
    "data_url": "data:image/png;base64,iVBOR...",
    "mime_type": "image/png",
    "width": 800,
    "height": 600
  }
}
```

**E. 连接状态暴露（供 UI 消费）**

```typescript
export type WSStatus = 'disconnected' | 'connecting' | 'open' | 'reconnecting';

// Zustand store 新增字段
wsStatus: WSStatus;
setWsStatus: (status: WSStatus) => void;
```

---

### 2.2 聊天界面组件

#### 2.2.1 现状分析
- ✅ `DialogBox.tsx` 已有输入框、发送按钮、消息气泡基础实现
- ❌ 缺少连接状态指示器（在线/离线/重连中）
- ❌ 消息不支持图片类型
- ❌ 打字指示器不够生动（仅静态文字，无动画）
- ❌ 长时间无消息时缺少欢迎提示

#### 2.2.2 需求规格

**A. 组件结构**

```
DialogBox (w-80)
├── HeaderCard (崽崽信息卡)
│   ├── Avatar + Name + StatusIndicator ⬅️ 新增连接状态指示
│   └── ExpressionButtons
├── ChatArea (消息列表)
│   ├── WelcomeMessage ⬅️ 新增欢迎占位
│   ├── MessageBubble[]
│   │   ├── TextOnlyBubble
│   │   └── ImageBubble ⬅️ 新增图片气泡
│   └── TypingIndicator ⬅️ 增强动画
├── QuickActions (快捷操作)
├── InputBar
│   ├── TextInput
│   ├── ImageIcon ⬅️ 新增图片选择按钮
│   └── SendButton
```

**B. 连接状态指示器**

| 状态 | 显示 | 颜色 |
|------|------|------|
| open | 🟢 在线 | green-400 |
| connecting | 🔵 连接中... | blue-400 |
| reconnecting | 🟡 重连中... | yellow-400 |
| disconnected | 🔴 已断开 | red-400 |

**C. 欢迎占位消息**

```
┌───────────────────────┐
│   👋 你好！我是崽崽    │
│                        │
│   软件需求分析师        │
│   有什么可以帮你的吗？   │
│                        │
│   [📋查看PRD] [☕加咖啡] │
└───────────────────────┘
```

**D. 打字指示器增强**
- 三个跳动的小圆点动画（类似微信/iMessage）
- CSS animation: `typing-dot` (0.6s ease-in-out infinite alternate)

---

### 2.3 图片支持模块

#### 2.3.1 现状分析
- ❌ 完全缺失，从零开始构建

#### 2.3.2 需求规格

**A. 发送图片 — 文件选择器**

```
InputBar:
├── TextInput (flex-1)
├── ImageIcon (点击触发隐藏的 <input type="file" accept="image/*">)  ⬅️ 新增
└── SendButton
```

交互流程：
1. 用户点击图片图标 → 弹出文件选择器（仅允许图片格式）
2. 选中图片后，在输入框上方显示缩略图预览（带删除按钮）
3. 点击发送时，将图片转为 base64 data URL 附加到消息中
4. 限制：单张图片最大 2MB，支持 JPG/PNG/GIF/WebP

**B. 发送图片 — 粘贴板**

```
textInput.onPaste = (e) => {
  const items = e.clipboardData.items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      // → 转 base64 → 显示预览
      showImagePreview(blob);
    }
  }
}
```

**C. 图片消息气泡渲染**

```typescript
// ChatMessage 类型扩展
export interface ChatMessage {
  id: string;
  sender: 'caicai' | 'user';
  text: string;
  timestamp: Date;
  image?: ImageData;        // ⬅️ 新增图片字段
  events?: GatewayEvent[];
}

export interface ImageData {
  data_url: string;
  mime_type: string;
  width: number;
  height: number;
}
```

气泡样式：
- 用户发送的图片 → 圆角卡片，最大宽度 100%，高度自适应（max-h-48）
- 崽崽回复的图片（未来扩展）→ 同样样式，左侧对齐

**D. 图片预览区域**

```
┌───────────────────────┐
│ [🖼️ 截图.png]      ✕ │ ← 选中图片后显示在输入框上方
└───────────────────────┘
├── ────────────────────┤
│ 输入框 | 📎 | ➤     │
└───────────────────────┘
```

---

### 2.4 事件处理器增强模块

#### 2.4.1 现状分析
- ✅ `handleGatewayEvents()` 已有 expression/action 基础处理
- ❌ action 类型覆盖不全（仅 search_documents / type_on_keyboard）
- ❌ object_reaction / environment_change 仅有 console.log，无视觉反馈
- ❌ 事件触发后缺少状态自动恢复机制（如思考2秒后回到IDLE）

#### 2.4.2 需求规格

**A. Action 映射表扩展**

| LLM 动作标签 | 前端 action value | 视觉表现 | 持续时长 |
|-------------|-------------------|----------|----------|
| 挥手 | wave_hand | 崽崽挥手动画 | 1500ms |
| 打字 | type_on_keyboard | 切换到 WORKING 状态，键盘敲击动画 | 3000ms |
| 翻文档 | search_documents | 切换到 SEARCHING 状态，抽屉打开动画 | 2000ms |
| 喝咖啡 | drink_coffee | 咖啡杯升起 + 蒸汽效果 | 1500ms |
| 点头 | nod_head | 崽崽上下晃动 | 800ms |
| 摇头 | shake_head | 崽崽左右晃动 | 800ms |
| 转圈 | spin | 崽崽旋转360° | 1200ms |

**B. 状态自动恢复机制**

```	ypescript
handleGatewayEvents: (events) => {
  for (const event of events) {
    // ... 处理事件 ...

    // 设置定时器，动作结束后自动回到 IDLE + happy
    if (event.duration) {
      setTimeout(() => {
        set({ caicaiState: 'IDLE', expression: 'happy' });
      }, event.duration);
    }
  }
}
```

**C. Object Reaction 视觉反馈**

| 事件 value | 视觉表现 |
|-----------|----------|
| coffee_steam | 咖啡杯上方显示蒸汽粒子效果 |
| drawer_open | 抽屉打开动画 |
| whiteboard_write | 白板上出现文字动画 |
| light_on/off | 房间灯光变化 |

---

## 三、技术实现路径

### 3.1 文件变更清单

```
frontend/src/
├── services/
│   └── ws.ts                    # ⬅️ 改造：心跳、重连策略、图片传输
├── store/
│   └── gameState.ts             # ⬅️ 扩展：wsStatus、ImageData、状态恢复
├── ui/
│   ├── DialogBox.tsx            # ⬅️ 增强：连接指示器、欢迎消息、打字动画
│   └── ChatImagePreview.tsx     # ➕ 新增：图片预览组件
└── components/
    └── TypingIndicator.tsx      # ➕ 新增：跳动圆点动画组件
```

### 3.2 后端变更清单（如需）

```python
backend/app/api/gateway.py        # ⬅️ 需支持图片消息的 WebSocket 路由
backend/app/services/event_mapper.py  # ⬅️ 扩展 action/object_reaction 映射
```

### 3.3 实施顺序建议

```
Phase A (基础稳固)          Phase B (功能增强)         Phase C (体验优化)
┌─────────────┐           ┌─────────────┐            ┌─────────────┐
│ 1. WS心跳+  │──►        │ 2. 图片选择 │──►         │ 4. 状态自动 |
│   指数退避重连│           │   +粘贴支持 │            │    恢复     │
├─────────────┤           ├─────────────┤            ├─────────────┤
│ 2. WSStatus │           │ 3. 图片气泡 │            │ 5. Object   |
│   UI暴露    │           │   渲染      │            │    Reaction |
└─────────────┘           └─────────────┘            │    视觉反馈  |
                                                     └─────────────┘
```

---

## 四、风险与缓解措施

| # | 风险项 | 影响 | 概率 | 缓解措施 |
|---|--------|------|------|----------|
| R1 | base64图片过大导致WS消息阻塞 | 高 | 中 | 前端压缩+2MB限制，后端流式处理 |
| R2 | LLM不支持图片理解（当前Qwopus3.6） | 高 | 高 | 先实现传输层，LLM视觉能力后续接入 |
| R3 | WS断连时用户发消息丢失 | 中 | 低 | 发送前检查连接状态，断开时缓存消息队列 |

---

## 五、验收标准

### 5.1 WebSocket 模块
- [ ] 正常连接后 wsStatus === 'open'
- [ ] 后端关闭后自动重连，最多等待8s/次
- [ ] 30s心跳保活机制生效（console可观察到 ping/pong）
- [ ] 发送图片消息时，后端能正确解析 image 字段

### 5.2 聊天界面组件
- [ ] 连接状态指示器实时反映 wsStatus
- [ ] 首次打开时无消息显示欢迎占位
- [ ] 崽崽回复前显示打字动画（三个跳动圆点）
- [ ] 消息气泡正确区分用户/崽崽，支持多行文本

### 5.3 图片支持
- [ ] 点击图片图标可弹出文件选择器
- [ ] 选中图片后输入框上方显示预览 + 删除按钮
- [ ] Ctrl+V 粘贴截图可直接添加到预览区
- [ ] 发送的图片消息在聊天区域正确渲染为缩略图
- [ ] 超过2MB的图片被拒绝并提示用户

### 5.4 事件处理器
- [ ] 收到 expression 事件后崽崽表情即时切换
- [ ] 收到 action 事件后触发对应动画，duration 结束后自动恢复 IDLE
- [ ] object_reaction 事件有对应的视觉反馈（至少咖啡蒸汽效果）

---

> 📝 *"需求文档不是写给人看的，是写给未来的自己看的。"— 崽崽*

**状态**: ✅ 待评审 | **下一步**: 小宝确认范围后进入 Phase A 实施

---

*文档结束*
