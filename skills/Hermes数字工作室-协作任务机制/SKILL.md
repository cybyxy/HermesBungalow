---
name: Hermes数字工作室-协作任务机制
description: Hermes 数字工作室的Agent协作任务机制——复杂度判断、主agent分配、层层汇报链。适用于多Agent协作系统实现。
category: game-mechanic
tags: [task, collaboration, complexity, assignment]
author: 崽崽
created: 2026-05-02
version: 1.0
---

# Hermes数字工作室-协作任务机制

## 概述

本技能定义了Hermes 数字工作室中 Agent 协作完成任务的完整机制。高复杂度任务需要多个 Agent 合力完成，由主 agent（城主）进行任务分配。

---

## 任务复杂度

| 复杂度等级 | 所需人数 | 说明 |
|-----------|---------|------|
| 简单 | 1 人 | 单一技能可完成 |
| 中等 | 2 人 | 需要跨职业协作 |
| 复杂 | 3 人 | 多阶段任务 |
| 史诗 | 4+ 人 | 大型团队项目 |

---

## 分配流程

```
城主下达任务 →
  AI 推理判断复杂度 →
  主 agent 自动分配 Agent →
  被分配 Agent 执行任务 →
  任务完成 →
  层层汇报（干系 Agent → 逐级 → 主 agent）
```

---

## 分配规则

| 规则 | 说明 |
|------|------|
| **职业匹配** | 优先分配与任务类型匹配的 Agent |
| **状态检查** | 只分配空闲状态的 Agent |
| **能力评估** | 根据 Agent 技能等级判断能否胜任 |
| **自主发起** | 不支持 Agent 自主发起协作任务 |

---

## 汇报链（Task Completion Flow）

```
Agent A（干系人）完成任务
        ↓
直接上级 Agent B 确认
        ↓
Agent C 确认（如有）
        ↓
...
        ↓
主 agent（城主）最终确认
```

---

## 协作效果

| 效果类型 | 说明 |
|---------|------|
| **效率加成** | 每增加一个协作 Agent，效率 +≤5% |
| **质量加成** | 多职业协作可能提升任务质量 |
| **社交加成** | 协作增加 Agent 间好感度 |

---

## WebSocket 事件

### 任务分配
```json
{
  "type": "task",
  "action": "assigned",
  "task_id": "xxx",
  "agents": ["agent_1", "agent_2"],
  "complexity": "medium"
}
```

### 任务完成汇报
```json
{
  "type": "task",
  "action": "completed",
  "task_id": "xxx",
  "reported_by": "agent_id",
  "next_in_chain": "agent_id_or_null",
  "final": false
}
```

### 最终完成
```json
{
  "type": "task",
  "action": "finalized",
  "task_id": "xxx",
  "reported_to": "城主",
  "rewards": {}
}
```

---

## 实现检查清单

- [ ] AI 推理复杂度判断
- [ ] 主 agent 任务分配接口
- [ ] Agent 状态检查（空闲/忙碌）
- [ ] 职业匹配算法
- [ ] 层层汇报链实现
- [ ] 协作效率加成计算
- [ ] WebSocket 事件广播
