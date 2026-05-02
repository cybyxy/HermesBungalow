---
name: multi-agent-turn-relay
description: 多Agent接力对话模式——XML转交格式规范、场景区分、触发规则。适用于崽崽数字小屋项目中多Agent协作。
triggers:
  - 用户要求两个Agent"对话"、"讨论"、"辩论"、"接力"
  - 需要进行多轮对话交互
  - 需要向多个同伴同时发送通知或任务
---

# 多Agent接力对话模式

## 核心XML转交格式

```xml
<hermes-bungalow-invoke agent="{target_profile}">
{content}
</hermes-bungalow-invoke>
```

### 是否需要"请回复本条消息"？

| 场景 | 是否需要 | 说明 |
|------|---------|------|
| 任务委派（需执行+汇报） | ✅ 需要 | 对方必须回复汇报结果 |
| 多轮对话（辩论/讨论/协商） | ✅ 需要 | 对方必须回复继续下一轮 |
| 并行通知（向多人发消息） | ❌ 不需要 | 对方收到即可，无需回复 |
| 接龙传递（继续传下去） | ❌ 不需要 | 继续传给下一个人即可 |

### 完整格式（需要回复时）

```xml
<hermes-bungalow-invoke agent="{target_profile}">
{content}
-----------------
请回复本条消息。
</hermes-bungalow-invoke>
```

### 完整格式（不需要回复时）

```xml
<hermes-bungalow-invoke agent="{target_profile}">
{content}
</hermes-bungalow-invoke>
```

### 占位符说明

| 占位符 | 说明 | 示例 |
|--------|------|------|
| `{target_profile}` | 目标同伴的 profile 名 | `pymaster`、`uiwizard`、`compass` |
| `{content}` | 本次任务内容（发送方填充） | 见下方模板 |

### 错误做法

❌ 空壳转交（内容由接收方自己填）：
```xml
<hermes-bungalow-invoke agent="pymaster">
请回复本条消息！
</hermes-bungalow-invoke>
```

✅ 完整内容转交（发送方已填好内容）：
```xml
<hermes-bungalow-invoke agent="pymaster">
小宝要求：检查并修复职业映射问题。
完成后回复我。
-----------------
请回复本条消息。
</hermes-bungalow-invoke>
```

---

## 场景区分

### 1. 任务委派（需要执行+汇报）

```xml
<hermes-bungalow-invoke agent="{target_profile}">
{具体任务内容}
完成后回复我。
-----------------
请回复本条消息。
</hermes-bungalow-invoke>
```

### 2. 多轮对话（辩论/业务讨论/方案协商）

适用于需要多轮交互的场景（辩论、方案讨论、技术评审等）。

```xml
<hermes-bungalow-invoke agent="{target_profile}">
【第{N}轮——{当前方}】

对方刚才说：{对方上轮内容摘要}
我的回应：{针对对方内容的回应}
我的第{N}点：{本轮新内容/论点}

@{对方} 你的回应是什么？
请回复本条消息，继续第{N+1}轮！
-----------------
请回复本条消息。
</hermes-bungalow-invoke>
```

**适用场景**：辩论、需求分析讨论、架构方案评审、技术问题协商等。

### 3. 并行通知（向多人发送相同内容）

按顺序列出多个XML标签，依次发送：

```xml
{说明文字}
<hermes-bungalow-invoke agent="pymaster">
{通知内容}
</hermes-bungalow-invoke>
<hermes-bungalow-invoke agent="ui">
{通知内容}
</hermes-bungalow-invoke>
<hermes-bungalow-invoke agent="uiwizard">
{通知内容}
</hermes-bungalow-invoke>
```

### 4. 接龙传递（依次传下去）

```xml
<hermes-bungalow-invoke agent="{next_profile}">
上一位已确认。继续传递：{内容}
</hermes-bungalow-invoke>
```

---

## 关键规则

| 规则 | 说明 |
|------|------|
| **城主不亲自干活** | 收到任务立即委派给对应同伴，不自己执行 |
| **需要回复时加"请回复本条消息"** | 让对方知道需要回复，对话链才不断 |
| **不需要回复时不加** | 通知/接龙场景无需对方回复 |
| **收到回复后立即继续** | 不等用户说"继续"，自动推进下一轮 |
| **内容必须完整** | 发送方填好完整内容，不是让接收方自己填 |

---

## 所有可用 agent 值

| agent | 同伴 |
|-------|------|
| `default` | 崽崽（城主） |
| `pymaster` | 马斯特 |
| `ui` | 林见溪 |
| `uiwizard` | 陆向宇 |
| `compass` | 顾言卿 |
| `apex` | 沈枢衡 |
| `scriptorium` | 苏砚书 |
| `keystone` | 江定策 |
| `libra` | 秦鉴微 |

---

## 常见错误

| 错误 | 后果 |
|------|------|
| 不需要回复时加了"请回复本条消息" | 对方被迫回复，制造不必要的等待 |
| 需要回复时没加"请回复本条消息" | 对方不知道要回复，对话中断 |
| 城主自己执行任务而非委派 | 城主变成执行者，违背职能分工 |
| 空壳XML（让对方自己填内容） | 对方不知道具体任务是什么 |
| 等用户说"继续"才推进 | 多轮对话卡住，用户体验差 |
