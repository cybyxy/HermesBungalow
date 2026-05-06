---
name: Hermes数字工作室-任务与流程
description: 可选：用户自定义「任务分析 / 拆解」思路；持久化时的 JSON 结构由数字工作室后端统一注入 Schema 保证规范。
---

# Hermes 数字工作室 — 任务与流程（可选用户 SKILL）

本文件**不**再要求固定输出 `[[GAME_EVENT:…]]` 或固定 JSON 形态。你可以完全按自己的方法论写分析、风险、干系人、里程碑等，**长短与格式不限**。

## 与后端的关系

- 用户在「新建任务」后，工作室会调用后端接口 **`POST /api/game/task/workflow/generate`**。
- 请求体可带可选字段 **`user_skill_excerpt`**：即本 SKILL 全文或节选（前端若未传则为空）。
- **后端**会把你的摘录（若有）与当前任务 JSON 拼在一起，并**强制附上 JSON Schema**，再发给 LLM；因此即使用户 SKILL 写得再自由，落库用的 `workflow_steps` 仍由后端解析与归一化（见仓库 `backend/api/game/task_workflow_llm.py`）。

## 写作建议（非强制）

- 若希望模型在「自由分析」之外仍贴近你的习惯，可在 SKILL 里列出：常用阶段名、你们团队的 DoD、评审门禁等。
- 不必重复 Schema 里已有字段说明；Schema 由后端维护，与存档 `Task.workflow_steps` 一致。
