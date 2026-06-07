import { JSON_HDR, parseJson } from './gameApi';
import type { TaskItem } from '../types/game';

// ── Task CRUD ──────────────────────────────────────────────────────────────

export async function postCreateTask(payload: {
  name: string;
  description?: string;
  required_profession?: string;
  difficulty?: number;
  reward?: number;
}): Promise<{ ok: boolean; task: TaskItem }> {
  const res = await fetch('/api/task/task', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function postTaskAssign(taskId: number, agentId?: string | null): Promise<Record<string, unknown>> {
  const res = await fetch('/api/task/task/assign', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ task_id: taskId, agent_id: agentId ?? null }),
  });
  return parseJson(res);
}

export async function postTaskDelete(taskId: number): Promise<{ ok: boolean; task_id?: number; error?: string }> {
  const res = await fetch('/api/task/task/delete', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ task_id: taskId }),
  });
  return parseJson(res);
}

export async function postTaskUpdate(payload: {
  task_id: number;
  name?: string;
  description?: string;
  status?: string;
  due_at?: string;
  deliverables?: string;
  acceptance_criteria?: string;
  catalog?: string;
  estimated_hours?: number;
  is_collaborative?: boolean;
  depends_on?: number[];
}): Promise<{ ok: boolean; task?: TaskItem; error?: string }> {
  const res = await fetch('/api/task/task/update', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

/** 后端拼接 JSON Schema + 可选用户 SKILL 摘录，调用 LLM 后解析并写入 ``workflow_steps`` */
export async function postTaskWorkflowGenerate(payload: {
  task_id: number;
  agent_id: string;
  user_skill_excerpt?: string;
}): Promise<{
  ok: boolean;
  workflow_applied?: boolean;
  task?: TaskItem;
  orchestrate?: unknown;
  error?: string;
  detail?: string;
}> {
  const res = await fetch('/api/task/task/workflow/generate', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

// ─ 任务链 DAG API ─

export async function postTaskDependency(taskId: number, dependsOn: number[]): Promise<{ ok: boolean; task?: TaskItem; error?: string }> {
  const res = await fetch('/api/task/task/dependency', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ task_id: taskId, depends_on: dependsOn }),
  });
  return parseJson(res);
}

export async function postBatchCreateTasks(tasks: {
  name: string;
  description?: string;
  required_profession?: string;
  difficulty?: number;
  depends_on_indices?: number[];
}[]): Promise<{ ok: boolean; tasks: TaskItem[]; count: number; error?: string }> {
  const res = await fetch('/api/task/task/batch-create', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ tasks }),
  });
  return parseJson(res);
}

export type TaskChainNode = {
  id: number;
  name: string;
  status: string;
  assignee_id: string | null;
  progress: number;
  depends_on: number[];
  parent_task_id: number;
};

export type TaskChainData = {
  nodes: TaskChainNode[];
  edges: { from: number; to: number }[];
};

export async function fetchTaskChain(): Promise<TaskChainData> {
  const res = await fetch('/api/task/task-chain');
  return parseJson<TaskChainData>(res);
}

export async function postTaskClaim(taskId: number, agentId: string): Promise<{ ok: boolean; task?: TaskItem; error?: string }> {
  const res = await fetch('/api/task/task/claim', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ task_id: taskId, agent_id: agentId }),
  });
  return parseJson(res);
}
