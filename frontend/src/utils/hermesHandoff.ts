import type { Agent } from '../types/game';

// ── regex constants ────────────────────────────────────────────────────────

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

// ── peer handoff parsing (assistant side) ───────────────────────────────────

const AT_PIPE_LINE = /^\s*@([^\s|@]+)\s*[|｜]\s*(.+)$/;
const AT_SPACE_LINE = /^\s*@([^\s|@]+)\s+([\s\S]+)$/;

function normHandoffLine(line: string): string {
  return line.replace(/｜/g, '|');
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

// ── exported utilities ─────────────────────────────────────────────────────

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
