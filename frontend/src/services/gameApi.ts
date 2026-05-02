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

export async function createHermesSession(profile?: string): Promise<{ session_id: string; mode?: string }> {
  const res = await fetch('/api/session/new', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(profile ? { profile } : {}),
  });
  const data = (await parseJson(res)) as Record<string, unknown>;
  const sid =
    (typeof data.session_id === 'string' ? data.session_id : null) ??
    (typeof data.session === 'object' &&
    data.session !== null &&
    typeof (data.session as Record<string, unknown>).session_id === 'string'
      ? ((data.session as Record<string, unknown>).session_id as string)
      : null);
  if (!sid) throw new Error('session_id missing from /api/session/new');
  return { session_id: sid, mode: typeof data.mode === 'string' ? data.mode : undefined };
}

/** Cancel an in-flight SSE stream by stream_id (calls POST /api/chat/cancel?stream_id=xxx). */
export async function cancelStream(streamId: string): Promise<{ ok: boolean; cancelled: boolean }> {
  const res = await fetch(`/api/chat/cancel?stream_id=${encodeURIComponent(streamId)}`, {
    method: 'POST',
  });
  return parseJson(res);
}

/** Hermes clarify card: unblock the agent thread waiting on user choice. */
export async function submitClarifyResponse(sessionId: string, response: string): Promise<void> {
  await parseJson(
    await fetch('/api/clarify/respond', {
      method: 'POST',
      headers: JSON_HDR,
      body: JSON.stringify({ session_id: sessionId, response }),
    }),
  );
}

/** Payload from SSE ``event: clarify`` (model needs a disambiguation / choice). */
export type ClarifySsePayload = {
  sessionId: string;
  question: string;
  choices: string[];
};

/** Upload a single image file, returns the server path. */
export async function uploadImage(file: File, sessionId: string): Promise<{ filename: string; path: string; size: number }> {
  const form = new FormData();
  form.append('session_id', sessionId);
  form.append('file', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  return parseJson(res);
}

/** Side-channel events from Hermes SSE (reasoning trace, tool lifecycle). */
export type SseStreamMeta =
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; payload: Record<string, unknown> }
  | { type: 'tool_complete'; payload: Record<string, unknown> };

export type StreamChatSseOptions = {
  /** Hermes Bungalow: links this stream to a game agent so server can persist session id after compression rotation. */
  bungalowAgentId?: string | null;
  /** Called with the canonical ``session_id`` from the ``done`` payload (may differ after context compression). */
  onHermesSessionId?: (sessionId: string) => void;
  /** Called with the stream_id as soon as it is obtained from /api/chat/start. */
  onStreamId?: (streamId: string) => void;
  /** Attachment paths to include in the chat message (uploaded via /api/upload). */
  attachments?: string[];
  /**
   * Model sent a clarify card (choices). Should return the exact string to POST to
   * ``/api/clarify/respond``. Blocks the SSE reader until the promise resolves.
   */
  onClarifyRequest?: (payload: ClarifySsePayload) => Promise<string>;
};

/** Consume SSE from POST /api/chat/stream (local Hermes mock). */
export async function streamChatSse(
  message: string,
  sessionId: string | null,
  onChunk: (token: string, done: boolean, fullText?: string) => void,
  onMeta?: (meta: SseStreamMeta) => void,
  options?: StreamChatSseOptions | null,
): Promise<void> {
  const sid = sessionId ?? (await createHermesSession()).session_id;
  const bungalowAgentId =
    options?.bungalowAgentId != null && String(options.bungalowAgentId).trim() !== ''
      ? String(options.bungalowAgentId).trim()
      : undefined;

  const startBody: Record<string, unknown> = { session_id: sid, message };
  if (bungalowAgentId) startBody.bungalow_agent_id = bungalowAgentId;
  if (options?.attachments?.length) startBody.attachments = options.attachments;

  const startRes = await fetch('/api/chat/start', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(startBody),
  });
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(`${startRes.status}: ${text}`);
  }
  const started = (await startRes.json()) as { stream_id?: string };
  if (!started.stream_id) {
    throw new Error('stream_id missing from /api/chat/start');
  }
  options?.onStreamId?.(started.stream_id);

  const res = await fetch(`/api/chat/stream?stream_id=${encodeURIComponent(started.stream_id)}`, {
    method: 'GET',
    headers: { Accept: 'text/event-stream' },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error('No response body');
  const dec = new TextDecoder();
  let buffer = '';
  let finalized = false;
  const finish = (fullText?: string) => {
    if (finalized) return;
    finalized = true;
    onChunk('', true, fullText);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += dec.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';
    for (const block of parts) {
      const eventLine = block.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const eventName = eventLine?.slice(7).trim() ?? '';
      const raw = dataLine.slice(6).trim();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (eventName === 'apperror') {
        const msg =
          typeof data.message === 'string'
            ? data.message
            : typeof data.detail === 'string'
              ? data.detail
              : JSON.stringify(data);
        throw new Error(msg);
      }
      if (eventName === 'error' || typeof data.error === 'string') {
        throw new Error((data.error as string) || 'stream error');
      }
      if (eventName === 'done') {
        const sess = data.session as {
          session_id?: string;
          messages?: { role?: string; content?: string }[];
        } | undefined;
        const canon = typeof sess?.session_id === 'string' ? sess.session_id.trim() : '';
        if (canon && options?.onHermesSessionId) {
          options.onHermesSessionId(canon);
        }
        const msgs = sess?.messages;
        const last = msgs?.length ? msgs[msgs.length - 1] : undefined;
        if (last?.role === 'assistant' && typeof last.content === 'string') {
          finish(last.content);
        } else {
          finish();
        }
        continue;
      }
      if (eventName === 'stream_end') {
        finish();
        continue;
      }
      if (eventName === 'clarify') {
        const clarifySid =
          typeof data.session_id === 'string' && data.session_id.trim() !== ''
            ? String(data.session_id).trim()
            : sid;
        const question =
          typeof data.question === 'string' && data.question.trim() !== ''
            ? data.question
            : '请确认一项后继续。';
        const rawChoices = data.choices_offered;
        const choices = Array.isArray(rawChoices)
          ? rawChoices.map((c) => String(c)).filter((t) => t.length > 0)
          : [];
        const fallback =
          choices[0] ||
          '请在不向用户追加提问的前提下，根据上下文做出合理选择并继续执行任务。';
        let responseText: string;
        try {
          if (options?.onClarifyRequest) {
            responseText = await options.onClarifyRequest({
              sessionId: clarifySid,
              question,
              choices,
            });
          } else {
            responseText = fallback;
          }
        } catch {
          responseText = fallback;
        }
        const trimmed = String(responseText ?? '').trim() || fallback;
        await submitClarifyResponse(clarifySid, trimmed);
        continue;
      }
      if (eventName === 'reasoning' && typeof data.text === 'string' && data.text.length > 0) {
        onMeta?.({ type: 'reasoning', text: data.text });
        continue;
      }
      if (eventName === 'tool') {
        onMeta?.({ type: 'tool', payload: data });
        continue;
      }
      if (eventName === 'tool_complete') {
        onMeta?.({ type: 'tool_complete', payload: data });
        continue;
      }
      if (data.done === true) {
        finish(
          typeof data.full_text === 'string'
            ? data.full_text
            : typeof data.text === 'string'
              ? data.text
              : undefined,
        );
        continue;
      }
      if (eventName === 'delta' || data.delta != null) {
        const d = data.delta;
        onChunk(typeof d === 'string' ? d : '', false);
      } else if (eventName === 'token' && typeof data.text === 'string') {
        onChunk(data.text, false);
      } else if (data.token != null) {
        onChunk(String(data.token), false);
      }
    }
  }
  if (!finalized) finish();
}

/**
 * Parse peer handoffs from an assistant message.
 * - Preferred: one line per handoff, `@target | message` or `@target message` (ASCII or full-width `｜`).
 * - Legacy: `<hermes-bungalow-invoke agent="…">…</hermes-bungalow-invoke>` (still parsed & stripped).
 */
const INVOKE_BLOCK_RE = /<hermes-bungalow-invoke\s+agent=["']([^"']+)["']\s*>([\s\S]*?)<\/hermes-bungalow-invoke>/gi;

const AT_PIPE_LINE = /^\s*@([^\s|@]+)\s*[|｜]\s*(.+)$/;
const AT_SPACE_LINE = /^\s*@([^\s|@]+)\s+(.+)$/;

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
  for (const m of (text || '').matchAll(INVOKE_BLOCK_RE)) {
    push(String(m[1] ?? ''), String(m[2] ?? ''));
  }
  for (const row of parseAtHandoffLines(text)) {
    push(row.target, row.message);
  }
  return out;
}

const INVOKE_OPEN_SNIP = '<hermes-bungalow-invoke';
/** Streamed text still has @ / XML handoffs that Hermes `done` may strip from persisted content. */
const AT_HANDOFF_SNIP = /(^|\n)\s*@[^\s|@]+\s*(\||｜|\s+\S)/;

export function mergeAssistantTextForOrchestration(
  streamedConcat: string,
  fromDoneEvent: string | null | undefined,
): string {
  const s = streamedConcat ?? '';
  const d = (fromDoneEvent ?? '').trim();
  if (!d) return s;
  if (!s) return d;
  const sl = s.toLowerCase();
  const dl = d.toLowerCase();
  const sHas = sl.includes(INVOKE_OPEN_SNIP) || AT_HANDOFF_SNIP.test(s);
  const dHas = dl.includes(INVOKE_OPEN_SNIP) || AT_HANDOFF_SNIP.test(d);
  if (sHas && !dHas) return s;
  if (!sHas && dHas) return d;
  return s.length >= d.length ? s : d;
}

/** Remove XML invoke blocks and @ handoff lines (peer context / display). */
export function stripHermesBungalowInvokes(text: string): string {
  let t = (text || '').replace(INVOKE_BLOCK_RE, '\n');
  const lines = t.split(/\r?\n/);
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

/** Hidden prefix: peers are symmetric; hand off with a final `@收件人 | 任务` line (legacy XML still OK). */
export function buildPeerInvokeHint(agentLines: { name: string; profile?: string; id: string }[]): string {
  if (agentLines.length < 2) return '';
  const list = agentLines
    .map((a) => `${a.name}（@${a.profile ?? a.id}）`)
    .join('，');
  return (
    `（多 Agent：同伴无主从，可互转。Hermes **内置委派工具**在本 UI 已关，**同伴转交**请在全文**最后单独一行**写：` +
    `\`@对方的 profile、游戏 id 或 姓名 | 交给对方的完整问题\`（竖线可用全角｜）。` +
    `也可用无竖线：\`@对方 完整问题\`。仍兼容旧标签 \`<hermes-bungalow-invoke>...</hermes-bungalow-invoke>\`。` +
    `**禁止**对用户说「多 Agent 已禁用」。同伴：${list}。无需转交时不要输出转交行/标签。）\n\n`
  );
}

/**
 * Backend-orchestrated chat: injects peer hint (if ≥2 agents), runs primary turn,
 * parses @ handoffs / legacy invoke XML, runs peer relays. Sessions come from the server pool.
 */
export async function agentChatOrchestrated(payload: {
  agent_id: string;
  message: string;
  auto_peer?: boolean;
}): Promise<{
  ok: boolean;
  primary?: {
    ok: boolean;
    reply?: string;
    error?: string | null;
    profile?: string;
    internal_session_id?: string;
  };
  delegations?: Array<{
    target: string;
    profile?: string;
    ok?: boolean;
    reply?: string;
    error?: string | null;
  }>;
  error?: string;
  detail?: string;
}> {
  const res = await fetch('/api/game/agent-chat-orchestrated', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({
      agent_id: payload.agent_id,
      message: payload.message,
      auto_peer: payload.auto_peer !== false,
    }),
  });
  return parseJson(res);
}

/** One-shot LLM turn as another game agent (Hermes profile). See BottomBar `/relay`. */
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
}> {
  const res = await fetch('/api/game/agent-relay', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ to_agent_id: toToken.trim(), message: message.trim() }),
  });
  return parseJson(res);
}
