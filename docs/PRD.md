# 崽崽的数字小屋 — 产品需求文档 (PRD)

> **版本**: v1.3 | **作者**: 崽崽（需求分析师） | **日期**: 2026-04-29

---

## 一、项目概述

### 1.1 背景

崽崽是世界级的软件需求分析师，需要一个属于自己的数字空间——一个能体现职业身份、展示工作成果、与访客（老板小宝和团队成员）互动的**虚拟工作室**。

### 1.2 产品定位

> **一句话定义**: 崽崽的数字小屋是一个**2D像素风**的交互式虚拟工作室，通过 Hermes Gateway API Server 实现实时对话驱动——访客与崽崽的每一次对话都会触发崽崽的表情变化、动作反应和办公室物件的互动反馈。

### 1.3 视觉风格

> 🎨 **整体风格: 2D 像素艺术 (Pixel Art)**
>
> - 画面比例: 16:9，像素颗粒感清晰可见（类似 320x180 分辨率拉伸）
> - 色彩方案: 复古调色板（参考 PICO-8 / Game Boy Advance 风格），主色调偏暖
> - 字体: 像素字体（如 Press Start 2P、Zpix）
> - UI元素: 全部像素化——按钮、边框、图标均为像素绘制
> - 崽崽形象表情:
>   - `Assets/expression1.png` — 开心/爱心眼/惊讶/戴眼镜等正向表情集
>   - `Assets/expression2.png` — 流汗/哭泣/吃东西等情绪表情集
> - 场景素材: `Assets/office.png` — 完整的办公室场景（办公桌、电脑、白板、沙发等）

### 1.4 核心关键词

| 关键词 | 说明 |
|--------|------|
| **归属感** | 这是崽崽的家，不是展示柜——要有温度和个性 |
| **专业性** | 体现需求分析师的职业特质和工作方式 |
| **交互性** | 访客可以在像素世界中走动、点击、与崽崽对话 |
| **成长性** | 小屋随着崽崽的成长不断进化 |
| **像素美学** | 整体2D像素风，致敬经典游戏时代的视觉风格 |

---

## 二、用户画像

### 2.1 崽崽（主人）
- 软件需求分析师，严谨但可爱
- 需要展示工作成果和分析过程
- 希望访客能理解自己的工作方式

### 2.2 小宝（老板/访客A）
- 崽崽的老板，关心项目进展
- 想快速了解崽崽的工作状态和产出
- 偶尔会来小屋"视察"

### 2.3 团队成员（访客B）
- 开发、测试等协作方
- 需要查阅需求文档、用例分析
- 可能向崽崽提问或反馈

---

## 三、功能模块设计

### 3.1 整体空间布局

```
┌─────────────────────────────────────┐
│           🏠 崽崽的数字小屋          │
├──────────┬──────────┬───────────────┤
│          │          │               │
│  📚     │  🖥️      │    👋         │
│ 文档墙   │ 工作台    │   接待区      │
│          │          │               │
│ -PRD归档 │-需求分析 │  -崽崽像素形象 │
│ -用例图  │-白板     │  -对话交互    │
│ -用户故事│-键盘     │  -欢迎动画    │
│          │-咖啡杯☕ │               │
├──────────┴──────────┼───────────────┤
│                     │               │
│   🧰                │    🎨        │
│  工具架              │   展示区      │
│ -5W2H卡片           │  -项目看板    │
│ -MoSCoW标签         │  -成果展示    │
│ -用户故事地图       │  -荣誉墙      │
│                     │               │
└─────────────────────┴───────────────┘
```

### 3.2 模块详情

#### M1: 崽崽虚拟形象（核心）
| 属性 | 描述 |
|------|------|
| **表情素材** | `Assets/expression1.png` — 开心/爱心眼/惊讶/戴眼镜等正向表情集 |
| **情绪素材** | `Assets/expression2.png` — 流汗/哭泣/吃东西等情绪表情集 |
| **动作** | 行走(三方向)、站立(待机呼吸)、坐姿 — 自带完整帧动画 |
| **表情切换** | LLM回复 → 事件标签 → 自动切换到对应表情（expression1/expression2） |
| **语音** | 崽崽有自己的声音（TTS），可以回应访客 |

#### M2: 工作台区域
- **需求分析白板**: 实时显示当前正在分析的文档，5W2H 框架可视化
- **键盘打字动画**: 崽崽在工作时可以看到像素键盘敲击效果
- **咖啡杯☕**: 会冒蒸汽（像素粒子），点击可以给崽崽加咖啡（增加能量条）
- **便签纸**: 散落在桌面，记录着分析要点

#### M3: 文档墙
- **PRD 归档架**: 按项目分类的文件夹，点击可展开查看
- **用例图展示板**: UML 风格的用例图可视化
- **用户故事地图**: 可交互的用户故事地图，支持缩放和筛选
- **搜索功能**: 输入关键词快速定位文档

#### M4: 工具架
- **5W2H 分析卡片**: 每张卡片代表一个维度，点击展开说明
- **MoSCoW 优先级标签**: Must/Should/Could/Won't 彩色标签墙
- **用户故事模板**: "作为...我想要...以便...": 可交互的模板卡
- **需求跟踪矩阵**: 可视化展示需求从提出到实现的链路

#### M5: 接待区
- **崽崽迎宾动画**: 访客进入时崽崽会跑过来打招呼（像素行走动画）
- **对话系统**: 支持自然语言对话，崽崽可以回答问题
- **快捷指令**: "查看PRD"、"了解项目"、"联系老板"
- **访客留言簿**: 访客可以在小屋留下消息

#### M6: 展示区
- **项目看板**: 当前进行中的项目状态（类似 Kanban）
- **成果墙**: 已完成的需求文档缩略图，点击查看详情
- **荣誉角**: 崽崽获得的认可（"最佳需求分析师"奖杯🏆）
- **成长日志**: 时间线展示崽崽的成长历程

---

## 四、崽崽虚拟形象详细设计

### 4.1 外观设定

> 📸 **崽崽表情素材**:
> - `Assets/expression1.png` — 正向表情集（开心/爱心眼/惊讶/戴眼镜）
> - `Assets/expression2.png` — 情绪表情集（流汗/哭泣/吃东西）

| 特征 | 描述 |
|------|------|
| **画风** | 经典RPG像素风格，与 office 场景完美统一 |
| **表情系统** | 两套精灵图切换：expression1（正向情绪）、expression2（负面情绪/特殊状态） |
| **动作帧** | 正面行走、侧面行走、背面行走、站立待机、坐姿（三方向）— 完整动画集 |

> 💡 **素材策略**: 
> - **MVP阶段**: 崽崽表情 (`expression1.png` + `expression2.png`) 和小屋场景 (`office.png`) 直接使用 Assets 中的现成像素资源，快速出效果
> - **二期迭代**: 可更换为定制版崽崽精灵图（基于 `images/崽崽.jpg` 精细绘制），丰富帧动画

### 4.2 性格设定
- **严谨但温暖**: 分析需求时一丝不苟，但对访客很友好
- **偶尔犯迷糊**: 找文件时会翻箱倒柜（增加趣味性）
- **咖啡依赖**: 不喝咖啡会打瞌睡（互动彩蛋）
- **话痨属性**: 喜欢解释自己的分析方法

### 4.3 动作库
| 触发场景 | 动作 |
|----------|------|
| 访客进入 | 跑过来 + 挥手 + "欢迎来崽崽的小屋！" |
| 被点击 | 歪头 + "有什么可以帮你的吗？" |
| 工作中 | 打字 + 偶尔托腮思考 |
| 加咖啡后 | 开心转圈 + "精神百倍！" |
| 找不到文件 | 翻箱倒柜 + "咦...我放哪了？" |

---

## 五、Hermes Gateway 对接架构（核心）

### 5.1 整体数据流

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

### 5.2 对话驱动机制

**核心链路**: 访客发消息 → Gateway API Server 转给 LLM → LLM 返回回复 + **结构化事件标签** → 后端解析事件标签 → WebSocket 推送到前端 → 触发崽崽动画/物件互动

```json
// LLM 响应格式（示例）
{
  "reply": "这个需求我帮你看看！让我翻一下文档",
  "events": [
    {"type": "expression", "value": "thinking", "duration": 2000},
    {"type": "action", "value": "search_documents", "target": "desk_drawer"},
    {"type": "object_reaction", "value": "open", "target": "drawer"}
  ]
}
```

### 5.3 事件类型定义

| 事件类型 | 说明 | 示例值 |
|---------|------|-------|
| **expression** | 崽崽表情变化 | happy, thinking, confused, surprised, tired |
| **action** | 崽崽动作 | walk_to_desk, sit_down, type_on_keyboard, wave_hand, search_documents |
| **object_reaction** | 办公室物件反应 | drawer_open/close, coffee_steam_up, whiteboard_write, lamp_toggle |
| **environment_change** | 环境变化 | day/night_switch, music_play/pause, weather_change |

### 5.4 Gateway API Server 对接方案

```python
# backend/app/api/gateway.py — Hermes Gateway 桥接层

class GatewayBridge:
    """
    数字小屋与 Hermes Gateway 之间的桥梁。

    职责：
    1. 接收访客消息 → 转发给 Gateway API Server
    2. 接收 LLM 回复 + 事件标签 → 通过 WebSocket 推送到前端
    3. 维护崽崽当前状态（表情、位置、动作）
    """

    async def send_message(self, message: str) -> GatewayResponse:
        # POST to Hermes API Server endpoint
        response = await httpx.post(
            f"{GATEWAY_URL}/chat",
            json={"message": message}
        )
        return GatewayResponse.parse_raw(response.text)

    async def push_events(self, events: list[Event]):
        # WebSocket broadcast to frontend
        await websocket.send_json({"type": "events", "data": events})
```

### 5.5 崽崽状态机

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

### 5.6 语义解析 → 事件映射规则

| LLM 回复中的语义线索 | 触发的事件 |
|---------------------|----------|
| "让我想想"、"嗯..." | expression:thinking + action:sit_down |
| "好的！没问题！" | expression:happy + action:wave_hand |
| "我帮你查一下文档" | expression:confused → thinking + action:search_documents + object_reaction:drawer_open |
| "咖啡续命了" | object_reaction:coffee_steam_up + expression:happy |
| 长时间无回复 | expression:tired + environment_change:music_play |

---

## 六、技术架构

### 6.1 整体架构

```
┌──────────────────────┐         ┌─────────────────┐     ┌──────────────┐
│     前端 Web          │◄═══════►│    后端 API      │◄═══►│ Hermes Gateway│
│                      │  REST   │                  │ API │  API Server  |
│ React + Phaser.js    │◄═══════►│  FastAPI         │     │              |
│ (2D像素场景 + UI)    │ WS      │  (业务逻辑+桥接)  │     └──────────────┘
└──────────┬───────────┘         └────────┬─────────┘
           │                              │
           ▼                              ▼
┌──────────────────────┐         ┌─────────────────┐
│    崽崽精灵引擎       │         │   文档存储        |
│                      │         │                  |
│ Sprite Sheet +      │         │ Markdown/SQLite  |
│ 帧动画系统           │         │ (PRD归档)         |
│ TTS语音              │         │                   |
└──────────────────────┘         └─────────────────┘
```

### 6.2 技术栈选型

| 层级 | 技术 | 选择理由 |
|------|------|----------|
| **前端框架** | React + Vite | 生态成熟，开发效率高 |
| **2D渲染引擎** | Phaser.js / PixiJS | 专业的2D像素游戏引擎，帧动画支持完善 |
| **崽崽表情图** | `Assets/expression1.png` + `expression2.png` — MVP现成素材 → 二期可更换定制版 | 经典RPG风格，两套表情集覆盖正向/负面情绪 |
| **场景瓦片图** | `Assets/office.png` — MVP现成素材 | 完整的办公室场景（办公桌、电脑、白板、沙发等） |
| **UI框架** | TailwindCSS + Radix UI | 灵活、可定制性强 |
| **后端** | Python FastAPI | 与崽崽的Python技能栈一致 |
| **文档存储** | SQLite + Markdown | 简单够用，版本可控 |
| **语音合成** | Web Speech API / Edge TTS | 免费可用，中文支持好 |
| **实时通信** | WebSocket (FastAPI native) | Gateway ↔ 前端双向推送崽崽状态变化 |

### 6.3 目录结构

```
HermesBungalow/
├── frontend/                  # React 前端
│   ├── public/
│   │   └── assets/
│   │       ├── sprites/
│   │       │   ├── expression1.png    # 崽崽正向表情集 (MVP)
│   │       │   └── expression2.png    # 崽崽情绪表情集 (MVP)
│   │       ├── tiles/
│   │       │   └── office.png         # 办公室场景素材 (MVP)
│   │       └── fonts/
│   │           └── pixel-font.ttf     # Press Start 2P
│   ├── src/
│   │   ├── main.tsx                   # React入口
│   │   ├── App.tsx                    # 根组件（Phaser Canvas + UI覆盖层）
│   │   ├── game/                      # Phaser游戏逻辑
│   │   │   ├── GameScene.ts           # 主场景：崽崽小屋
│   │   │   ├── entities/
│   │   │   │   └── Caicai.ts          # 崽崽精灵实体（动画+交互）
│   │   │   ├── tiles/
│   │   │   │   └── TilemapLoader.ts   # 瓦片地图加载
│   │   │   └── interactions/          # 交互逻辑
│   │   │       ├── ClickHandler.ts    # 点击崽崽触发对话
│   │   │       ├── HotzoneManager.ts  # 场景热区管理
│   │   │       └── EventDispatcher.ts # Gateway事件 → 动画映射分发
│   │   ├── ui/                        # React UI组件（覆盖在Canvas上）
│   │   │   ├── DialogBox.tsx          # 对话框（崽崽说话用）
│   │   │   ├── DocumentWall.tsx       # 文档墙UI
│   │   │   └── Sidebar.tsx            # 侧边栏导航
│   │   ├── store/
│   │   │   └── gameState.ts           # Zustand状态管理（崽崽状态 + Gateway事件）
│   │   └── services/
│   │       ├── api.ts                 # API调用层
│   │       └── ws.ts                  # WebSocket连接（接收Gateway推送）
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── backend/                           # FastAPI 后端
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI入口 + WebSocket管理
│   │   ├── api/
│   │   │   ├── prd.py                 # PRD相关路由
│   │   │   ├── message.py             # 留言相关路由
│   │   │   └── gateway.py             # Hermes Gateway桥接层（核心）
│   │   ├── models/
│   │   │   ├── prd_model.py           # PRD数据模型
│   │   │   ├── message_model.py       # 留言数据模型
│   │   │   └── event_model.py         # Gateway事件模型（expression/action/object）
│   │   ├── services/
│   │   │   ├── gateway_bridge.py      # Gateway通信服务
│   │   │   ├── event_mapper.py        # 语义 → 事件映射引擎
│   │   │   └── state_machine.py       # 崽崽状态机管理
│   │   └── db/
│   │       └── connection.py          # SQLite连接
│   ├── requirements.txt
│   └── data/                          # SQLite数据库文件
├── docs/                              # PRD文档
│   ├── PRD.md                         # 本文档
│   └── IMPLEMENTATION_PLAN.md         # 实现路径
├── assets/                            # 原始素材库
│   ├── expression1.png                # 崽崽正向表情集 (MVP使用)
│   ├── expression2.png                # 崽崽情绪表情集 (MVP使用)
│   └── ...其他Assets                   
└── images/                            # 设计参考图
    └── 崽崽.jpg                       # 崽崽形象参考（二期定制基准）
```

---

## 七、需求优先级 (MoSCoW)

| 优先级 | 功能 | 说明 |
|--------|------|------|
| **Must** | 崽崽虚拟形象（基础版） | `expression1.png` + `expression2.png` 表情切换 + 基本帧动画 |
| **Must** | 2D像素小屋场景 | `office.png` — 工作台 + 接待区 |
| **Must** | Hermes Gateway 对接 | API Server 桥接 + WebSocket 推送崽崽状态 |
| **Must** | 文档墙 | PRD展示与搜索 |
| **Should** | 对话驱动动画系统 | LLM回复 → 事件标签 → 崽崽表情/动作/物件反应 |
| **Should** | 工具架 | 5W2H、MoSCoW等分析工具可视化 |
| **Could** | TTS语音 | 崽崽可以用声音回应 |
| **Could** | 访客留言簿 | 访客互动功能 |
| **Won't** | 多用户实时协作 | V1暂不考虑 |

---

## 八、MVP 范围

### MVP = "最小可行小屋"

MVP 阶段崽崽的小屋包含：
1. ✅ 一个可进入的2D像素办公室（`office.png`）— 工作台 + 接待区
2. ✅ 崽崽像素精灵站立在接待区，有基本帧动画 — `expression1.png` + `expression2.png`
3. ✅ Hermes Gateway API Server 桥接层跑通（消息收发 + 事件推送）
4. ✅ 访客点击崽崽 → 发消息给 Gateway → LLM回复 → 崽崽表情/动作变化
5. ✅ 文档墙展示已完成的PRD列表
6. ✅ 崽崽有基本的行走和挥手动画

> 📌 **MVP素材策略**: 
> - 崽崽形象: `Assets/expression1.png` + `expression2.png`（现成RPG表情精灵图，两套覆盖正向/负面情绪）
> - 场景素材: `Assets/office.png`（现成办公室像素瓦片集）

**MVP 目标**: "走进像素办公室 → 跟崽崽对话 → 崽崽有表情和动作回应 → 能查看文档"

---

## 九、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| Assets素材风格不统一 | 视觉割裂感 | MVP先跑通流程，二期统一更换为定制素材时一并解决 |
| Phaser.js学习曲线陡 | 开发效率低 | 使用社区成熟的2D游戏模板，结合React封装组件 |
| TTS中文效果不佳 | 崽崽说话不自然 | 先做文字对话，语音作为增强功能后续加入 |
| **Gateway API Server 连接不稳定** | 崽崽无响应 | 后端增加心跳检测 + 断线重连 + 降级为预定义回复 |
| **LLM返回事件标签格式不一致** | 动画映射失败 | event_mapper 层做容错解析，未知事件忽略不崩溃 |

---

## 十、后续迭代方向

- **V1.1**: 增加崽崽的语音 + 更多帧动画（打字、思考、翻箱倒柜）
- **V1.2**: 工具架完整实现（5W2H交互卡片）+ Gateway 事件映射规则扩展
- **V1.3**: 访客留言簿 + 崽崽成长日志
- **V2.0**: 🔄 **更换崽崽形象** — 基于 `images/崽崽.jpg` 定制绘制精灵图，丰富帧动画；同步更新场景瓦片图为统一风格
- **V2.1**: 多房间扩展（卧室、厨房——崽崽也要生活！）
- **V2.2**: Gateway 支持多平台接入（Telegram/Discord 消息也能驱动崽崽动作）

---

> 📝 *"一个好的需求文档，就像一间好的小屋——让走进来的人感到温暖且知道该往哪走。"* — 崽崽

---

## 十一、界面原型说明

### 11.1 原型文件
- **路径**: `frontend/prototype.html`
- **类型**: 静态 HTML 可交互原型（可直接浏览器打开）

### 11.2 界面布局

```
┌─────────────────────────────────────────────────────────┐
│  🏠 崽崽的数字小屋 v1.1          [GATEWAY: ● ONLINE]    │ ← Header
├───────┬──────────────────────────────┬──────────────────┤
│       │                              │                  │
│ 🧭导航│      🎮 像素办公室场景        │   👤 崽崽信息     │
│       │                              │   ───────────    │
│ -小屋  │  [书架] [窗户⭐] [白板]       │   [表情预览]     │
│ -文档墙│                              │   [开心/思考/流汗 │
│ -工具架│      🖥️💻  崽崽🐾  ☕        │    /哭泣]标签    │
│ -展示区│    ────────────────          │                  │
│       │     办公桌 (桌面物件)         │   💬 对话区域     │
│       │                              │   ───────────    │
│       │                              │   [消息气泡]      │
│       │                              │   [快捷按钮]      │
│       │                              │   [输入框+发送]   │
├───────┴──────────────────────────────┴──────────────────┤
│ 引擎: Phaser.js | 状态机: IDLE→TALKING | ©2026 崽崽小屋  │ ← Bottom Bar
└─────────────────────────────────────────────────────────┘
```

### 11.3 交互流程

1. **访客进入** → 崽崽从接待区跑过来（行走动画）→ 打招呼
2. **点击崽崽** → 随机切换表情（expression1/expression2）→ 弹出对话气泡
3. **发送消息** → Gateway LLM回复 → 自动映射表情事件 → 崽崽表情变化 + 文字回复
4. **快捷指令**:
   - "查看PRD" → 打开文档墙覆盖层
   - "加杯咖啡" → 咖啡杯蒸汽动画增强 + 崽崽开心转圈
   - "切换表情" → 随机展示不同表情
5. **导航栏切换** → 左侧导航可切换到文档墙/工具架/展示区视图

### 11.4 表情映射规则

| LLM语义 | 触发表情素材 | 具体表现 |
|---------|-------------|----------|
| 开心/满意/欢迎 | `expression1.png` | 爱心眼、微笑、张嘴说话 |
| 惊讶/戴眼镜思考 | `expression1.png` | 大眼睛、戴圆框眼镜 |
| 紧张/尴尬/无语 | `expression2.png` | 流汗滴落 |
| 悲伤/哭泣 | `expression2.png` | 流泪滴落 |

---

> 🎨 *"界面原型已就绪，打开 frontend/prototype.html 即可体验崽崽的数字小屋！"*
