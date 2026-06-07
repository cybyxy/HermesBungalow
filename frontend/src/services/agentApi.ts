import { JSON_HDR, parseJson, normalizeAgentFromApi } from './gameApi';
import type { Agent } from '../types/game';

/** Authoritative agent list from backend (same rows as embedded in state, explicit endpoint). */
export async function fetchGameAgents(): Promise<Agent[]> {
  const res = await fetch('/api/task/agents');
  const data = await parseJson<{ agents?: unknown[] }>(res);
  return (data.agents ?? []).map(normalizeAgentFromApi);
}

export async function postCreateAgent(payload: {
  name: string;
  profession: string;
  gender?: string;
  catchphrase?: string;
  personality?: string;
}): Promise<void> {
  const res = await fetch('/api/task/agent', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  await parseJson(res);
}

export async function postCreateHermesProfileAgent(payload: {
  name: string;
  profile_name?: string;
  gender?: string;
  soul?: string;
  memory?: string;
}): Promise<{ profile_name: string; agent_count: number }> {
  const res = await fetch('/api/task/agent/create-from-hermes-profile', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson<{ profile_name: string; agent_count: number }>(res);
}

export async function getAgentProfileFiles(agentId: string): Promise<{ profile: string; soul: string; memory: string }> {
  const res = await fetch(`/api/task/agent/profile-files?agent_id=${encodeURIComponent(agentId)}`);
  return parseJson<{ profile: string; soul: string; memory: string }>(res);
}

export async function saveAgentProfileFiles(payload: {
  agent_id: string;
  soul?: string;
  memory?: string;
  reset_soul?: boolean;
}): Promise<void> {
  const res = await fetch('/api/task/agent/profile-files/save', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  await parseJson(res);
}

export async function updateAgentConfig(payload: {
  id: string;
  reasoning_model?: string;
  channel?: string;
  profession?: string;
  display_name?: string;
  skills?: Record<string, unknown>[];
}): Promise<{ ok: boolean; agent?: Record<string, unknown> }> {
  const res = await fetch('/api/task/agent/update', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; agent?: Record<string, unknown> }>(res);
}

export async function postDeleteAgent(agentId: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch('/api/task/agent/delete', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ agent_id: agentId }),
  });
  return parseJson<{ ok: boolean; error?: string }>(res);
}

/** BFF：为游戏 Agent 确保 Hermes 会话（浏览器禁止调用 /api/session/new）。 */
export async function ensureGameAgentSession(agentId: string): Promise<{ session_id: string }> {
  const res = await fetch('/api/task/hermes/session', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ agent_id: agentId }),
  });
  const data = (await parseJson(res)) as { ok?: boolean; session_id?: string; error?: string };
  if (!data.ok || typeof data.session_id !== 'string' || !data.session_id) {
    throw new Error(data.error ?? 'ensure_session_failed');
  }
  return { session_id: data.session_id };
}

/** BFF：上传附件到该 Agent 的 Hermes workspace（浏览器禁止调用 /api/upload）。 */
export async function uploadGameAgentAttachment(
  agentId: string,
  file: File,
): Promise<{ filename: string; path: string; size: number }> {
  const form = new FormData();
  form.append('agent_id', agentId);
  form.append('file', file);
  const res = await fetch('/api/task/agent/upload-attachment', { method: 'POST', body: form });
  const data = (await parseJson(res)) as {
    ok?: boolean;
    filename?: string;
    path?: string;
    size?: number;
    error?: string;
  };
  if (!data.ok || typeof data.path !== 'string') {
    throw new Error(data.error ?? 'upload_failed');
  }
  return {
    filename: String(data.filename ?? ''),
    path: data.path,
    size: typeof data.size === 'number' ? data.size : 0,
  };
}
