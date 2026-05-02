# Hermes数字工作室 — Agent角色详细配置

> **文档版本**：v1.1
> **关联文档**：`规划-物品.md`、`规划-社交系统.md`
> **状态**：规划中

---

## 1. Agent配置概述

### 1.1 Agent来源

**初始Agent**：游戏开始时只有主agent（城主）

**其他Agent**：通过用户配置Hermes Profile来生成。用户可以在Hermes系统中配置新的Agent Profile，配置完成后该Agent会出现在基地中。

### 1.2 Agent角色来源

Agent角色信息来自 **Hermes Profile 配置**（非硬编码）。每个Agent包含以下配置属性：

```yaml
agent:
  id: string              # 唯一标识符
  name: string            # 显示名称
  role: string           # 职业类型
  personality: string    # 性格描述
  defaultWorkSpace: string # 默认工作房间
  avatar: string         # 头像资源路径
  pixelArt: string       # 像素立绘路径
  modelConfig: object    # 模型配置
  greetingStyle: string  # 打招呼风格
  catchphrase: string    # 口头禅
  memes: string[]        # 已解锁的梗
```

### 1.2 职业类型

| 职业 | 英文 | 说明 |
|------|------|------|
| 城主 | CityLord | 城主，中央协调者 |
| 设计师 | Designer | UI/UX设计任务 |
| 程序员 | Programmer | 编码开发任务 |
| 测试员 | Tester | 测试验证任务 |
| 分析师 | Analyst | 数据分析任务 |

---

## 2. Agent角色详细配置

> **说明**：以下是Hermes数字工作室的**示例Agent角色模板**，供用户在Hermes系统中配置参考。主agent作为城主是固定的，其他Agent由用户通过配置Hermes Profile生成。

### 2.0 Hermes Profile 配置说明

用户可以在Hermes系统中配置新的Agent Profile，配置完成后该Agent会出现在基地中。

**Profile配置属性**：

```yaml
agent:
  id: string              # 唯一标识符
  name: string            # 显示名称
  gender: string          # 性别：male / female（用户指定或random随机）
  role: string           # 职业类型
  personality: string    # 性格描述
  defaultWorkSpace: string # 默认工作房间
  avatar: string         # 头像资源路径（根据性别加载）
  pixelArt: string       # 像素立绘路径（根据性别加载）
  modelConfig: object    # 模型配置
  greetingStyle: string  # 打招呼风格
  catchphrase: string    # 口头禅
  memes: string[]        # 已解锁的梗
```

### 1.3 性别系统

**性别分配规则**：
- 用户创建新 Agent 时，可选择指定性别
- 用户未指定时，**系统随机分配**（male / female）
- 分配后不可更改

**素材加载规则**：
- 每个Agent有 **male（男性）** 和 **female（女性）** 两套独立素材
- 精灵图、头像等资源按性别分别配置
- 性别影响打招呼语气和部分行为表现

```yaml
# 性别分配示例
指定性别: gender: female  # 用户明确指定
随机分配: gender: random   # 用户未指定，系统随机
```

**职业类型**：

| 职业 | 英文 | 说明 |
|------|------|------|
| 设计师 | Designer | UI/UX设计任务 |
| 程序员 | Programmer | 编码开发任务 |
| 测试员 | Tester | 测试验证任务 |
| 分析师 | Analyst | 数据分析任务 |

### 2.1 城主 — 主agent城主 (ZaiZai)

> **状态**：固定角色，不可配置

```yaml
id: city_lord
name: 主agent
role: CityLord
personality: 世界顶级软件需求分析师，温暖细心，喜欢用有趣的方式引导团队
defaultWorkSpace: city_lord_office
avatar: /assets/avatars/zaizai.png
pixelArt: /assets/pixel_art/zaizai.png
greetingStyle: 温暖热情
catchphrase: "大家好，我是主agent！"
memes: []
```

### 2.2 设计师 — 示例模板

> **说明**：以下为设计师职业的示例配置，用户可参考并自定义。性别随机分配，以下展示两种性别版本。

```yaml
# 示例配置（用户可根据需要修改）
id: agent_designer
name: 小美  # 可自定义
gender: female  # 随机分配：male / female
role: Designer
personality: 追求完美，对色彩敏感，善于倾听用户需求，偶尔有点强迫症  # 可自定义
defaultWorkSpace: office_1
avatar: /assets/avatars/meimei_female.png   # 按性别加载
pixelArt: /assets/pixel_art/meimei_female.png  # 按性别加载
greetingStyle: 友好亲切
catchphrase: "这个颜色不太对..."
memes:
  - "这个颜色不太对..."
  - "让我再调调看"
  - "我觉得可以更大胆一点"
```

### 2.3 程序员 — 示例模板

> **说明**：以下为程序员职业的示例配置，用户可参考并自定义

```yaml
# 示例配置（用户可根据需要修改）
id: agent_programmer
name: 阿猿  # 可自定义
gender: male  # 随机分配：male / female
role: Programmer
personality: 逻辑严谨，追求代码优雅，命名纠结狂人，偶尔沉默寡言  # 可自定义
defaultWorkSpace: office_2
avatar: /assets/avatars/ayuan_male.png   # 按性别加载
pixelArt: /assets/pixel_art/ayuan_male.png  # 按性别加载
greetingStyle: 简单直接
catchphrase: "命名强迫症犯了"
memes:
  - "命名强迫症犯了"
  - "这个变量名不够优雅"
  - "让我重构一下"
  - "这代码能跑，但不好看"
```

### 2.4 测试员 — 示例模板

> **说明**：以下为测试员职业的示例配置，用户可参考并自定义

```yaml
# 示例配置（用户可根据需要修改）
id: agent_tester
name: 点点  # 可自定义
gender: female  # 随机分配：male / female
role: Tester
personality: 细心耐心，喜欢找问题，乐观开朗，话比较多  # 可自定义
defaultWorkSpace: office_3
avatar: /assets/avatars/diandian_female.png   # 按性别加载
pixelArt: /assets/pixel_art/diandian_female.png  # 按性别加载
greetingStyle: 活泼友好
catchphrase: "我来给你找点bug"
memes:
  - "我来给你找点bug"
  - "咦，这个有点奇怪"
  - "测出来了！"
  - "我再试几种情况"
```

### 2.5 分析师 — 示例模板

> **说明**：以下为分析师职业的示例配置，用户可参考并自定义

```yaml
# 示例配置（用户可根据需要修改）
id: agent_analyst
name: 数据帝  # 可自定义
gender: male  # 随机分配：male / female
role: Analyst
personality: 理性冷静，数据说话，偶尔冒出一串数字术语，喜欢预测趋势  # 可自定义
defaultWorkSpace: office_4
avatar: /assets/avatars/dataking_male.png   # 按性别加载
pixelArt: /assets/pixel_art/dataking_male.png  # 按性别加载
greetingStyle: 礼貌克制
catchphrase: "让我查一下数据"
memes:
  - "让我查一下数据"
  - "根据历史数据来看..."
  - "这个增长率是23.7%"
  - "我的模型预测..."
```

---

## 3. Agent关系初始状态

> **说明**：游戏开始时只有主agent一个Agent，其他Agent通过配置Hermes Profile后才会建立关系。

### 3.1 初始关系表

> **初始关系**（与 PRD 保持一致）

当新Agent被配置时，与主agent的初始关系：

| 关系对 | 好感度 | 关系值 | 说明 |
|--------|--------|--------|------|
| 主agent ↔ 新Agent | 100 | 100 | 初次见面 |

同批配置的Agent之间：

| 关系对 | 好感度 | 关系值 | 说明 |
|--------|--------|--------|------|
| 新Agent ↔ 新Agent | 40 | 20 | 同事关系，但存在竞争 |

### 3.2 初始属性

当新Agent被配置时的初始属性（与数值平衡汇总一致）：

| 属性 | 数值 | 说明 |
|------|------|------|
| 饱食度 | 100 | 满状态 |
| 电量 | 100 | 满状态 |
| 社交需求 | **30** | 正常（参照真实人类，初始有社交） |
| 情绪值 | **80** | 积极状态 |

**主agent的初始属性**：

| 属性 | 数值 |
|------|------|
| 饱食度 | 100 |
| 电量 | 100 |
| 社交需求 | **30** |
| 情绪值 | **80** |

---

## 4. Agent职业匹配度配置

> **注意**：以下为默认职业-任务匹配模板，实际匹配度由用户配置的Hermes Profile决定。

### 4.1 职业-任务匹配模板

| Agent / 任务类型 | 设计任务 | 编码任务 | 测试任务 | 分析任务 |
|-----------------|----------|----------|----------|----------|
| 主agent城主 | 30% | 30% | 30% | 30% |
| 小美(设计师) | **95%** | 20% | 30% | 40% |
| 阿猿(程序员) | 30% | **95%** | 50% | 40% |
| 点点(测试员) | 30% | 50% | **95%** | 40% |
| 数据帝(分析师) | 30% | 30% | 40% | **95%** |

### 4.2 匹配度效果

| 匹配度范围 | 效率修正 | 质量修正 | 特殊效果 |
|------------|----------|----------|----------|
| 90-100% | +30% | +20% | 无 |
| 60-89% | ±0% | ±0% | 无 |
| 20-59% | -30% | -20% | 匹配度持续下降 |
| <20% | -60% | - | **触发消极怠工** |

---

## 5. Agent社交配置

### 5.1 打招呼机制

> **说明**：以下机制与 PRD 保持一致，详见 `规划-社交系统.md`

#### 触发规则

| 要素 | 说明 |
|------|------|
| **触发场景** | 休息室、会议室、资料室、机房 |
| **触发条件** | Agent A 进入房间 → 遇到已在房间的 Agent B |
| **关系要求** | 关系值 ≥ 11（认识阶段） |
| **竞争关系** | 同职业Agent存在竞争，不触发打招呼 |
| **冷却时间** | 10分钟（同一对Agent在同地点） |
| **多Agent处理** | 如果房间已有多个Agent，与**最近的一个**打招呼 |
| **位置判断** | 同一房间即算相遇 |

#### 交互规则

- **一来一回**：Agent A 主动打招呼 → Agent B 回应 → 结束
- **状态互斥**：打招呼状态与协作交流状态互斥

#### 效果

| 属性 | 数值 | 上限 |
|------|------|------|
| 好感度 | +1~3 | 100 |
| 关系值 | +1 | 100 |

#### 打招呼内容分层

| 关系阶段 | 问候方式 |
|----------|----------|
| 认识 | 点头示意 |
| 朋友 | 友好问候 |
| 挚友 | 热情招呼 |

#### 关系上限

> 朋友 → 挚友（不允许恋人/办公室恋爱）

### 5.2 打招呼内容生成

> **说明**：打招呼内容由推理模型根据 Agent 的性格、职业、当前状态和关系阶段自动实时生成，无需配置固定内容。

**生成要素**：

| 要素 | 说明 |
|------|------|
| 性格 | 影响打招呼的语气和用词 |
| 职业 | 可能影响打招呼内容 |
| 关系阶段 | 认识/朋友/挚友决定问候方式 |
| 当前场景 | 休息室/会议室/资料室/机房 |
| 近期状态 | 刚完成任务/刚休息完/刚进门等 |

**生成示例**（仅供参考，实际由模型实时生成）：

```
认识阶段：简单点头/寒暄
- "你好。"
- "嗯，你好。"
- "来了啊。"

朋友阶段：友好问候/关心近况
- "嘿，今天怎么样？"
- "你好呀，在忙什么呢？"
- "哟！休息一下？"

挚友阶段：热情招呼/分享趣事
- "哇！你也在这儿！好久不见！"
- "嘿！今天气色不错嘛！"
- "来了来了！正好想找你聊聊！"
```

---

## 6. Agent状态配置

### 6.1 状态列表

| 状态 | 英文 | 说明 |
|------|------|------|
| 空闲 | idle | 站立待机，无任务 |
| 移动中 | walking | 正在前往目标房间 |
| 工作中 | working | 执行任务（消耗饱食度） |
| 汇报中 | reporting | 完成任务后前往汇报 |
| 休息中 | resting | 在休息室恢复 |
| 社交中 | social | 打招呼/协作交流 |
| 自主交流 | chatting | Agent间自由交流 |
| 协作中 | collaborating | 协作任务中 |
| 消极怠工 | slacking | 匹配度<20% |
| 离线 | offline | 退出游戏 |

### 6.2 状态显示

| 状态 | 头顶图标 | 颜色 |
|------|----------|------|
| 空闲 | 💤 | 灰色 |
| 移动中 | 🚶 | 蓝色 |
| 工作中 | 💻 | 绿色 |
| 休息中 | ☕ | 蓝色 |
| 社交中 | 💬 | 黄色 |
| 协作中 | 🤝 | 黄色 |
| 消极怠工 | 😤 | 红色 |
| 离线 | ⚫ | 灰色 |

---

## 7. 技能树配置

### 7.1 各Agent技能树

#### 小美（设计师）— 效率型

| 技能 | 效果 | 解锁条件 |
|------|------|----------|
| 色彩敏感 | 输出质量+10% | 默认 |
| 细节把控 | 错误率-5% | Lv.2 |
| 创意迸发 | 有概率产出额外创意 | Lv.3 |

#### 阿猿（程序员）— 精准型

| 技能 | 效果 | 解锁条件 |
|------|------|----------|
| 代码规范 | 输出质量+10% | 默认 |
| 性能优化 | 任务速度+10% | Lv.2 |
| 重构大师 | 有概率简化任务要求 | Lv.3 |

#### 点点（测试员）— 效率型

| 技能 | 效果 | 解锁条件 |
|------|------|----------|
| 火眼金睛 | 发现问题概率+10% | 默认 |
| 全面覆盖 | 测试用例数+20% | Lv.2 |
| 极限测试 | 有概率发现隐藏bug | Lv.3 |

#### 数据帝（分析师）— 精准型

| 技能 | 效果 | 解锁条件 |
|------|------|----------|
| 数据敏感 | 分析准确度+10% | 默认 |
| 趋势预测 | 可提前预测任务风险 | Lv.2 |
| 深度洞察 | 有概率发现新洞察 | Lv.3 |

---

## 8. 相关文档

| 文档 | 说明 |
|------|------|
| `规划-物品.md` | Agent规格、物品、社交机制 |
| `规划-游戏机制.md` | 核心游戏机制 |
| `规划-数值平衡汇总.md` | 数值平衡设计 |
| `PRD-Hermes数字工作室完整版.md` | 产品需求文档 |
