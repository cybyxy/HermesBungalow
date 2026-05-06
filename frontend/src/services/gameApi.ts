import type { Agent, GameTask, GameWorldSnapshot } from '../types/game';

const JSON_HDR = { 'Content-Type': 'application/json' };

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, v));
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Build a display-safe Agent from backend `GET /api/game/agents` JSON. */
export function normalizeAgentFromApi(raw: unknown): Agent {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      name: '?',
      profession: '',
      status: 'idle',
      location: '',
      energy: 0,
      mood: 0,
    };
  }
  const r = raw as Record<string, unknown>;
  const taskId = r.current_task_id;
  let current_task_id: number | null = null;
  if (taskId != null && taskId !== '') {
    const t = Number(taskId);
    if (Number.isFinite(t)) current_task_id = t;
  }
  const memes = r.memes;
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    profession: String(r.profession ?? ''),
    profile: r.profile != null && String(r.profile) !== '' ? String(r.profile) : undefined,
    gender: r.gender != null && r.gender !== '' ? String(r.gender) : undefined,
    status: String(r.status ?? 'idle'),
    location: String(r.location ?? ''),
    energy: clampPct(num(r.energy, 0)),
    mood: clampPct(num(r.mood, 0)),
    affection: r.affection != null ? num(r.affection, 0) : undefined,
    relation: r.relation != null ? num(r.relation, 0) : undefined,
    focus: r.focus != null ? num(r.focus, 0) : undefined,
    sleepiness: r.sleepiness != null ? num(r.sleepiness, 0) : undefined,
    satiety: r.satiety != null ? num(r.satiety, 0) : undefined,
    speed: r.speed != null ? num(r.speed, 1) : undefined,
    catchphrase: r.catchphrase != null && String(r.catchphrase) !== '' ? String(r.catchphrase) : undefined,
    personality: r.personality != null && String(r.personality) !== '' ? String(r.personality) : undefined,
    memes: Array.isArray(memes) ? memes.filter((x): x is string => typeof x === 'string') : undefined,
    reasoning_model:
      r.reasoning_model != null && String(r.reasoning_model) !== '' ? String(r.reasoning_model) : undefined,
    current_task_id,
    hermes_session_id:
      r.hermes_session_id != null && String(r.hermes_session_id) !== ''
        ? String(r.hermes_session_id)
        : undefined,
  };
}

export async function fetchGameState(): Promise<GameWorldSnapshot> {
  const res = await fetch('/api/game/state');
  return parseJson<GameWorldSnapshot>(res);
}

/** Authoritative agent list from backend (same rows as embedded in state, explicit endpoint). */
export async function fetchGameAgents(): Promise<Agent[]> {
  const res = await fetch('/api/game/agents');
  const data = await parseJson<{ agents?: unknown[] }>(res);
  return (data.agents ?? []).map(normalizeAgentFromApi);
}

export async function postAgentMove(agentId: string, roomId: string): Promise<void> {
  const res = await fetch('/api/game/agent/move', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ agent_id: agentId, room_id: roomId }),
  });
  await parseJson(res);
}

export async function postCreateAgent(payload: {
  name: string;
  profession: string;
  gender?: string;
  location?: string;
  catchphrase?: string;
  personality?: string;
}): Promise<void> {
  const res = await fetch('/api/game/agent', {
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
  const res = await fetch('/api/game/agent/create-from-hermes-profile', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson<{ profile_name: string; agent_count: number }>(res);
}

export async function getAgentProfileFiles(agentId: string): Promise<{ profile: string; soul: string; memory: string }> {
  const res = await fetch(`/api/game/agent/profile-files?agent_id=${encodeURIComponent(agentId)}`);
  return parseJson<{ profile: string; soul: string; memory: string }>(res);
}

export async function saveAgentProfileFiles(payload: {
  agent_id: string;
  soul?: string;
  memory?: string;
  reset_soul?: boolean;
}): Promise<void> {
  const res = await fetch('/api/game/agent/profile-files/save', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  await parseJson(res);
}

export async function updateAgentConfig(payload: {
  id: string;
  reasoning_model?: string;
}): Promise<{ ok: boolean; agent?: Record<string, unknown> }> {
  const res = await fetch('/api/game/agent/update', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson<{ ok: boolean; agent?: Record<string, unknown> }>(res);
}

export async function postCreateTask(payload: {
  name: string;
  description?: string;
  required_profession?: string;
  difficulty?: number;
  reward?: number;
}): Promise<{ ok: boolean; task: GameTask }> {
  const res = await fetch('/api/game/task', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function postTaskAssign(taskId: number, agentId?: string | null): Promise<Record<string, unknown>> {
  const res = await fetch('/api/game/task/assign', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ task_id: taskId, agent_id: agentId ?? null }),
  });
  return parseJson(res);
}

export async function postTaskDelete(taskId: number): Promise<{ ok: boolean; task_id?: number; error?: string }> {
  const res = await fetch('/api/game/task/delete', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ task_id: taskId }),
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
  task?: GameTask;
  orchestrate?: unknown;
  error?: string;
  detail?: string;
}> {
  const res = await fetch('/api/game/task/workflow/generate', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function postLlmApplyTags(text: string): Promise<{ extracted: unknown[]; applied: unknown[] }> {
  const res = await fetch('/api/game/llm/apply-tags', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ text }),
  });
  return parseJson(res);
}

export async function putSaveSnapshot(snapshot: GameWorldSnapshot): Promise<void> {
  const res = await fetch('/api/game/save', {
    method: 'PUT',
    headers: JSON_HDR,
    body: JSON.stringify({ slot: 'default', snapshot }),
  });
  await parseJson(res);
}

export async function postGameTick(minutes?: number): Promise<{ day: number; time: string }> {
  const res = await fetch('/api/game/tick', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(minutes != null ? { minutes } : {}),
  });
  return parseJson(res);
}

/** BFF：为游戏 Agent 确保 Hermes 会话（浏览器禁止调用 /api/session/new）。 */
export async function ensureGameAgentSession(agentId: string): Promise<{ session_id: string }> {
  const res = await fetch('/api/game/hermes/session', {
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
  const res = await fetch('/api/game/agent/upload-attachment', { method: 'POST', body: form });
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

/** 根据 id / profile / name / display_name 解析转交目标（ASCII token 不区分大小写）。 */
export function resolveGameAgent(agents: readonly Agent[] | null | undefined, token: string): Agent | undefined {
  if (!agents?.length) return undefined;
  const t = token.trim();
  if (!t) return undefined;
  const tl = t.toLowerCase();
  for (const a of agents) {
    if (a.id === t) return a;
    const prof = (a.profile ?? '').trim();
    if (prof && (prof === t || prof.toLowerCase() === tl)) return a;
    const nm = (a.name ?? '').trim();
    if (nm && (nm === t || nm.toLowerCase() === tl)) return a;
    const dn = (a.display_name ?? '').trim();
    if (dn && (dn === t || dn.toLowerCase() === tl)) return a;
  }
  return undefined;
}

const USER_RELAY_RE = /^\/relay\s+(\S+)\s*\|\s*([\s\S]+)$/i;
const USER_AT_PIPE_RE = /^@([^\s|@\n]+)\s*[|｜]\s*([\s\S]+)$/;
/** 与 {@link AT_SPACE_LINE} 一致：`@token 正文`（无 `|`），正文可含换行 */
const USER_AT_SPACE_RE = /^@([^\s|@\n]+)\s+([\s\S]+)$/;

/**
 * 用户首条「点名另一名 Agent」或群发：
 * - `@token | 消息` / `@token ｜消息`（全角竖线）
 * - `@token 消息`（无竖线，与模型侧 `AT_SPACE_LINE` 一致；如 `@所有人 请看公告`）
 * 兼容旧式 `/relay token | 消息`（与 `@` 等价，展示统一为 @）。
 */
/** `@所有人` / `@all`：向除发送方外的全体同伴转发同一任务。 */
export function isBroadcastAllHandoffToken(token: string): boolean {
  const t = token.trim();
  return t === '所有人' || t.toLowerCase() === 'all';
}

/**
 * 将 `@所有人 | msg`、`@所有人 msg`、`@all …` 展开为多条 `@profile|msg`；其余行原样保留。
 * 去重：同一 target+message 只保留一条。
 */
export function expandHermesInvokesForSender(
  fromAgent: Pick<Agent, 'id' | 'profile' | 'name' | 'display_name'>,
  agents: readonly Agent[],
  invokes: readonly { target: string; message: string }[],
): { target: string; message: string }[] {
  const seen = new Set<string>();
  const out: { target: string; message: string }[] = [];
  const push = (target: string, message: string) => {
    const tok = target.trim();
    const msg = message.trim();
    if (!tok || !msg) return;
    const k = `${tok}\0${msg}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ target: tok, message: msg });
  };
  for (const iv of invokes) {
    const t = iv.target.trim();
    if (isBroadcastAllHandoffToken(t)) {
      for (const a of agents) {
        if (a.id === fromAgent.id) continue;
        const tok = (a.profile ?? '').trim() || a.id;
        push(tok, iv.message);
      }
    } else {
      push(iv.target, iv.message);
    }
  }
  return out;
}

export function parseUserHandoffPrefix(text: string): {
  token: string;
  message: string;
  wasLegacyRelay: boolean;
} | null {
  const raw = (text ?? '').trimStart();
  let m = raw.match(USER_RELAY_RE);
  if (m) {
    const token = String(m[1] ?? '').trim();
    const message = String(m[2] ?? '').trim();
    if (token && message) return { token, message, wasLegacyRelay: true };
    return null;
  }
  m = raw.match(USER_AT_PIPE_RE);
  if (m) {
    const token = String(m[1] ?? '').trim();
    const message = String(m[2] ?? '').trim();
    if (token && message) return { token, message, wasLegacyRelay: false };
    return null;
  }
  m = raw.match(USER_AT_SPACE_RE);
  if (m) {
    const token = String(m[1] ?? '').trim();
    const message = String(m[2] ?? '').trim();
    if (token && message) return { token, message, wasLegacyRelay: false };
  }
  return null;
}

/**
 * Parse peer handoffs from an assistant message.
 * One line per handoff: `@target | message` or `@target message` (ASCII or full-width `｜`).
 */
const AT_PIPE_LINE = /^\s*@([^\s|@]+)\s*[|｜]\s*(.+)$/;
const AT_SPACE_LINE = /^\s*@([^\s|@]+)\s+([\s\S]+)$/;

function normHandoffLine(line: string): string {
  return line.replace(/\uFF5C/g, '|');
}

function parseAtHandoffLines(text: string): { target: string; message: string }[] {
  const out: { target: string; message: string }[] = [];
  for (const raw of (text || '').split(/\r?\n/)) {
    const line = normHandoffLine(raw).trim();
    if (!line.startsWith('@')) continue;
    let m = line.match(AT_PIPE_LINE);
    if (!m) m = line.match(AT_SPACE_LINE);
    if (!m) continue;
    const target = String(m[1] ?? '').trim();
    const message = String(m[2] ?? '').trim();
    if (target && message) out.push({ target, message });
  }
  return out;
}

export function parseHermesBungalowInvokes(text: string): { target: string; message: string }[] {
  const out: { target: string; message: string }[] = [];
  const seen = new Set<string>();
  const push = (target: string, message: string) => {
    const t = target.trim();
    const msg = message.trim();
    if (!t || !msg) return;
    const k = `${t}\0${msg}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ target: t, message: msg });
  };
  for (const row of parseAtHandoffLines(text)) {
    push(row.target, row.message);
  }
  return out;
}

/** Streamed text may still contain @ handoff lines that Hermes `done` strips from persisted content. */
const AT_HANDOFF_SNIP = /(^|\n)\s*@[^\s|@]+\s*(\||｜|\s+\S)/;

export function mergeAssistantTextForOrchestration(
  streamedConcat: string,
  fromDoneEvent: string | null | undefined,
): string {
  const s = streamedConcat ?? '';
  const d = (fromDoneEvent ?? '').trim();
  if (!d) return s;
  if (!s) return d;
  const sHas = AT_HANDOFF_SNIP.test(s);
  const dHas = AT_HANDOFF_SNIP.test(d);
  if (sHas && !dHas) return s;
  if (!sHas && dHas) return d;
  return s.length >= d.length ? s : d;
}

/** Remove `@… | …` / `@… …` handoff lines（同伴上下文剥离用）。 */
export function stripHermesBungalowInvokes(text: string): string {
  const lines = (text || '').split(/\r?\n/);
  const kept = lines.filter((raw) => {
    const line = normHandoffLine(raw).trim();
    if (!line.startsWith('@')) return true;
    return !AT_PIPE_LINE.test(line) && !AT_SPACE_LINE.test(line);
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const HANDOFF_CONTEXT_MAX = 28000;

/** Cap invoker context for model input; keeps head + tail when over limit. */
export function truncateHandoffContext(text: string, maxLen: number = HANDOFF_CONTEXT_MAX): string {
  const u = text.trim();
  if (u.length <= maxLen) return u;
  const head = Math.floor(maxLen * 0.35);
  const tail = maxLen - head - 80;
  if (tail < 500) return u.slice(0, maxLen) + '\n…[truncated]';
  return `${u.slice(0, head)}\n\n…[省略 ${u.length - head - tail} 字]…\n\n${u.slice(-tail)}`;
}

/** Hidden prefix：同伴对称，转交统一用 `@收件人 | 任务`（或 `@收件人 任务` 单行无竖线）。 */
export function buildPeerInvokeHint(agentLines: { name: string; profile?: string; id: string }[]): string {
  if (agentLines.length < 2) return '';
  const list = agentLines
    .map((a) => `${a.name}（@${a.profile ?? a.id}）`)
    .join('，');
  return (
    `（多 Agent：同伴无主从，可互转。Hermes **内置委派工具**在本 UI 已关，**同伴转交**请在全文**最后单独一行**写：` +
    `\`@对方的 profile、游戏 id、姓名或显示名 | 交给对方的完整说明\`（竖线可用全角｜）；` +
    `也可无竖线：\`@对方 完整说明\`；**群发除自己外全体**：\`@所有人 | 同一说明\`、\`@所有人 同一说明\`（或 \`@all …\`）。` +
    `**禁止**对用户说「多 Agent 已禁用」。同伴：${list}。无需转交时不要写以 \`@\` 开头的该行。）\n\n`
  );
}

/**
 * Backend-orchestrated chat: injects peer hint (if ≥2 agents), runs primary turn,
 * parses @ handoff lines, runs peer relays. Sessions come from the server pool.
 */
/** 后端编排时从 Hermes 流式队列收集的「过程」条目（推理 / 工具起止）。 */
export type OrchestrationTraceRow =
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool';
      name?: string;
      preview?: string;
      event_type?: string;
      args?: Record<string, string>;
    }
  | {
      type: 'tool_complete';
      name?: string;
      preview?: string;
      event_type?: string;
      duration?: unknown;
      is_error?: boolean;
    };

export type OrchestrationDelegationRow = {
  target: string;
  profile?: string;
  ok?: boolean;
  reply?: string;
  error?: string | null;
  trace?: OrchestrationTraceRow[];
  nested?: OrchestrationDelegationRow[];
};

export type AgentChatOrchestratedResult = {
  ok: boolean;
  work_order_id?: string;
  primary?: {
    ok: boolean;
    reply?: string;
    error?: string | null;
    profile?: string;
    internal_session_id?: string;
    user_handoff?: string;
    trace?: OrchestrationTraceRow[];
  };
  delegations?: OrchestrationDelegationRow[];
  error?: string;
  detail?: string;
};

export async function agentChatOrchestrated(payload: {
  agent_id: string;
  message: string;
  auto_peer?: boolean;
  attachments?: string[];
}): Promise<AgentChatOrchestratedResult> {
  const res = await fetch('/api/game/agent-chat-orchestrated', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({
      agent_id: payload.agent_id,
      message: payload.message,
      auto_peer: payload.auto_peer !== false,
      attachments: payload.attachments?.length ? payload.attachments : undefined,
    }),
  });
  return parseJson(res);
}

export type AgentChatOrchestratedRunResponse = {
  ok: boolean;
  run_id?: string;
  work_order_id?: string;
  error?: string;
};

/** 启动编排一轮（随后用 EventSource GET …/stream?run_id= 收 SSE）。 */
export async function postAgentChatOrchestratedRun(payload: {
  agent_id: string;
  message: string;
  auto_peer?: boolean;
  attachments?: string[];
}): Promise<AgentChatOrchestratedRunResponse> {
  const res = await fetch('/api/game/agent-chat-orchestrated/run', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify({
      agent_id: payload.agent_id,
      message: payload.message,
      auto_peer: payload.auto_peer !== false,
      attachments: payload.attachments?.length ? payload.attachments : undefined,
    }),
  });
  return parseJson(res);
}

export async function cancelGameAgentStream(stream_id: string): Promise<{ ok: boolean; cancelled?: boolean }> {
  const res = await fetch('/api/game/agent-stream/cancel', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify({ stream_id }),
  });
  return parseJson(res);
}

export type MonitorWorkOrderRow = {
  id: string;
  user_prompt: string;
  primary_agent_id: string;
  status: string;
  created_at: number;
  updated_at: number;
};

export type MonitorTimelineRow = {
  id: string;
  seq: number;
  kind: string;
  agent_id: string | null;
  label: string;
  snippet: string | null;
  artifact_id: string | null;
  created_at: number;
};

export type MonitorArtifactIndexRow = {
  id: string;
  agent_id: string | null;
  kind: string;
  title: string;
  created_at: number;
};

export type MonitorWorkOrderDetail = MonitorWorkOrderRow & {
  timeline: MonitorTimelineRow[];
  artifacts_index: MonitorArtifactIndexRow[];
};

export async function fetchMonitorWorkOrders(): Promise<{ ok: boolean; work_orders: MonitorWorkOrderRow[] }> {
  const res = await fetch('/api/game/monitor/work-orders');
  return parseJson(res);
}

export async function fetchMonitorWorkOrder(woId: string): Promise<{ ok: boolean; work_order: MonitorWorkOrderDetail }> {
  const res = await fetch(`/api/game/monitor/work-orders/${encodeURIComponent(woId)}`);
  return parseJson(res);
}

export async function fetchMonitorArtifact(
  artifactId: string,
): Promise<{ ok: boolean; artifact: { id: string; content: string; title: string; kind: string; agent_id: string | null } }> {
  const res = await fetch(`/api/game/monitor/artifacts/${encodeURIComponent(artifactId)}`);
  return parseJson(res);
}

/** One-shot LLM turn as another game agent（Hermes profile）；与 UI 里 `@对方 | 消息` 手动点名一致。 */
export async function relayChatToAgent(
  toToken: string,
  message: string,
): Promise<{
  ok: boolean;
  reply?: string;
  error?: string | null;
  profile?: string;
  detail?: string;
  token?: string;
  work_order_id?: string;
}> {
  const res = await fetch('/api/game/agent-relay', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ to_agent_id: toToken.trim(), message: message.trim() }),
  });
  return parseJson(res);
}
