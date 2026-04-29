# 崽崽数字小屋 — 界面美化设计规范

> **版本**: v1.1 | **日期**: 2026-04-29 | **作者**: 崽崽

---

## 1. 设计语言：深空紫 + 柔光（Deep Space Purple）

### 配色系统
```
背景层:
  --bg-base:        #0d0d1a   (最深背景)
  --bg-surface:     #13132a   (卡片/面板背景)
  --bg-elevated:    #1a1a38   (悬浮/激活态)
  --bg-glass:       rgba(26,26,56,0.7) (毛玻璃)

边框:
  --border-subtle:  rgba(139,92,246,0.15)  (紫色细线)
  --border-normal:  rgba(139,92,246,0.30)  (常规边框)
  --border-strong:  rgba(139,92,246,0.50)  (强调边框)

主色调:
  --accent-primary: #a78bfa   (紫 — 主操作)
  --accent-warm:   #f472b6   (粉 — 崽崽/用户消息)
  --accent-info:   #67e8f9   (青 — 信息/状态)

功能色:
  --success:       #4ade80
  --warning:       #fbbf24
  --danger:        #f87171

文字:
  --text-primary:  #e2e8f0
  --text-secondary:#94a3b8
  --text-muted:    #475569
```

### 排版
- 基础字号：12px → 14px（正文）
- 小字号：11px → 12px（次要信息）
- 极小：10px → 11px（标签/元数据）
- 字体：system-ui, -apple-system, sans-serif（干净现代）
- 行高：1.6（宽松）

### 间距系统
- 基础单位：4px
- 紧凑：4-8px
- 常规：12-16px
- 宽松：20-24px
- 区块：24-32px

### 圆角
- 小（按钮/输入框）：8px
- 中（卡片/气泡）：12px
- 大（面板/覆盖层）：16px

### 动效
- 过渡：200ms ease-out（hover）、300ms ease（展开）
- 阴影：多层柔和光晕替代硬阴影
- 滚动条：自定义细线样式

---

## 2. 各组件美化方案

### TimeAwareBackground.tsx（全局日夜渐变背景）
- **日夜8时段渐变**：深夜(0-4h) / 凌晨(4-6h) / 早晨(6-9h) / 上午(9-12h) / 中午(12-14h) / 下午(14-18h) / 傍晚(18-20h) / 晚上(20-24h)
- **径向光晕**：左上角暖光 + 右上角冷光 + 底部补光，各时段颜色/透明度动态变化
- **星空粒子层**：80颗漂浮星点，夜间透明度高，日间几乎不可见
- **CRT扫描线层**：水平半透明线条模拟老式显示器，opacity=0.03
- **Canvas噪点层**：伪随机噪点纹理，opacity=0.02
- **平滑过渡**：CSS transition 2秒，所有光晕颜色/透明度渐变切换

### StarryBackground.tsx（星空粒子组件）
- 80颗星点，位置/大小/透明度/速度/光晕颜色随机分布
- 持续漂浮动画，粒子透明度独立随机变化
- 透明度受 TimeAwareBackground 外层控制

### ClockDisplay.tsx（右上角时钟占位）
- 右上角固定定位 `top-4 right-4 z-50`
- 当前为占位空组件（时间已移除）

### GameScene.ts — 可交互时钟（墙上时钟）
- **Graphics绘制**：紫色圆形表盘 + 12小时刻度点 + 紫/淡紫时针分针 + 红色秒针
- **Hover放大**：鼠标移入 → Phaser Container 放大3.5倍（Back.easeOut，200ms），depth=9999置顶
- **DOM浮层**：时钟下方显示实时时间(24h HH:mm:ss) + 日期(YYYY/MM/DD 星期)，跳动动画(clockPopPulse keyframe，1s循环)
- **Hover离开**：容器恢复scale=1（Quad.easeOut），DOM浮层opacity=0淡出

### DialogBox.tsx（对话面板）

#### 崽崽信息卡
- 头像：64px，圆角2xl，粉色半透明边框 + 发光阴影
- 咖啡能量条：头像右侧，三色状态（绿>60%/黄>30%/红），带box-shadow发光
- 状态标签：在线/连接中/重连中/断开，对应绿/黄脉冲/红色圆点
- 表情切换按钮：😀开心 / 🤔思考 / 💧流汗，带颜色边框区分

#### 消息气泡
- **崽崽气泡**：紫色半透明 `rgba(139,92,246,0.12)`，紫色细边框
- **用户气泡**：粉色渐变 `linear-gradient(135deg, rgba(236,72,153,0.35), rgba(167,139,250,0.35))`，粉色边框 + 粉色光晕阴影
- **打字指示器**：三个跳动圆点，1s循环

#### 输入区
- 毛玻璃背景，聚焦时紫色高亮边框
- 发送按钮：紫色渐变背景

#### 清空按钮
- 聊天区域右上角，红色文字按钮，hover时加边框

### Sidebar.tsx（侧边栏）
- Tab 按钮：激活态有底部指示条
- 覆盖层：全屏毛玻璃背景，卡片网格布局

### index.css（全局）
- 自定义滚动条（细线紫色）
- 全局渐变背景
- 字体平滑
- 选中文本颜色

---

## 3. 已实现的视觉增强清单

| 组件 | 功能 | 状态 | 实现文件 |
|------|------|------|----------|
| TimeAwareBackground | 日夜8时段渐变 | ✅ | `frontend/src/ui/TimeAwareBackground.tsx` |
| StarryBackground | 80颗星空粒子漂浮 | ✅ | `frontend/src/ui/StarryBackground.tsx` |
| ClockDisplay | 右上角时钟占位 | ✅ | `frontend/src/ui/ClockDisplay.tsx` |
| GameScene | 可交互墙上时钟 | ✅ | `frontend/src/game/GameScene.ts` |
| DialogBox | 崽崽能量条 | ✅ | `frontend/src/ui/DialogBox.tsx` |
| DialogBox | 用户消息粉色气泡 | ✅ | `frontend/src/ui/DialogBox.tsx` |
| DialogBox | 清空对话按钮 | ✅ | `frontend/src/ui/DialogBox.tsx` |
| DialogBox | 表情切换按钮 | ✅ | `frontend/src/ui/DialogBox.tsx` |
| gameState | clearMessages action | ✅ | `frontend/src/store/gameState.ts` |
| gateway.py | overview model_name | ✅ | `backend/app/api/gateway.py` |
| gateway.py | cli_version正则提取 | ✅ | `backend/app/api/gateway.py` |
