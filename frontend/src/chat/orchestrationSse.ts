/**
 * SSE 消费：编排会话事件 → inferenceLog / 画布状态。
 * 同 step_id 的 reasoning_delta 合并到一条 reasoning 气泡（appendToInference）。
 *
 * 多 Agent 并发推理时，text_delta / reasoning_delta 频率极高（每秒数十次）。
 * 每次 delta 直接写 Zustand 会触发 RightPanel 全量重渲染（200 条带 Markdown 的 DOM），
 * 主线程被 React reconciliation 堵死 → 前端无响应。
 *
 * 这里用模块级 buffer：delta 文本先累积在 Map 里，每 80ms 批量 flush 到 Zustand，
 * 将重渲染次数从 ~50/s 降到 ~12/s，消除卡顿。
 */
import { useUiStore } from '../store/uiStore';
import type { Agent, TaskWorldSnapshot } from '../types/game';

// ── Delta batching ────────────────────────────────────────────────────
const DELTA_FLUSH_MS = 80;
const _deltaBuf = new Map<string, string>();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;

function _flushDeltaBuf(appendTo: (id: string, chunk: string) => void) {
  _flushTimer = null;
  for (const [id, chunk] of _deltaBuf) {
    appendTo(id, chunk);
  }
  _deltaBuf.clear();
}

function _batchDelta(id: string, text: string, appendTo: (id: string, chunk: string) => void) {
  const prev = _deltaBuf.get(id) || '';
  _deltaBuf.set(id, prev + text);
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => _flushDeltaBuf(appendTo), DELTA_FLUSH_MS);
  }
}

function _flushPending(appendTo: (id: string, chunk: string) => void) {
  if (_flushTimer) {
    clearTimeout(_flushTimer);
    _flushDeltaBuf(appendTo);
  }
}

let sseActiveHermesStreamId: string | null = null;
const stepReasoningEntryId = new Map<string, string>();

export function getSseActiveHermesStreamId(): string | null {
  return sseActiveHermesStreamId;
}

export function clearSseActiveHermesStreamId(): void {
  sseActiveHermesStreamId = null;
}

function agentReplyHeadline(agent: Agent | undefined): string {
  if (!agent) return 'Agent';
  const p = (agent.profession || '').trim();
  return p ? `${agent.name} · ${p}` : agent.name;
}

function resolveAgent(snapshot: TaskWorldSnapshot | null, agentId: string | null | undefined): Agent | undefined {
  if (!snapshot || !agentId) return undefined;
  return snapshot.agents.find((a) => a.id === agentId);
}

export function applyOrchestrationSseEvent(ev: Record<string, unknown>, snapshot: TaskWorldSnapshot | null): void {
  const t = String(ev.type || '');
  const append = useUiStore.getState().appendInference;
  const appendTo = useUiStore.getState().appendToInference;
  const patchInfer = useUiStore.getState().patchInference;
  const beginThink = useUiStore.getState().beginCenterAgentThinking;
  const setTool = useUiStore.getState().setCenterAgentTool;
  const finishInfer = useUiStore.getState().finishCenterAgentInference;

  const agentId = typeof ev.agent_id === 'string' ? ev.agent_id : null;
  const stepId = typeof ev.step_id === 'string' ? ev.step_id : '';

  switch (t) {
    case 'step_begin': {
      const sid = typeof ev.stream_id === 'string' ? ev.stream_id : '';
      if (sid) sseActiveHermesStreamId = sid;
      if (agentId) beginThink(agentId);
      if (agentId && stepId) {
        const rid = append({
          variant: 'reasoning',
          headline: '推理',
          body: '',
          agentId,
        });
        stepReasoningEntryId.set(stepId, rid);
      }
      break;
    }
    case 'text_delta': {
      const text = String(ev.text ?? '');
      if (!text || !agentId) break;
      const replyKey = stepId ? `${stepId}:reply` : '';
      let replyId = replyKey ? stepReasoningEntryId.get(replyKey) : undefined;
      if (!replyId) {
        const ag = resolveAgent(snapshot, agentId);
        replyId = append({
          variant: 'reply',
          headline: agentReplyHeadline(ag),
          body: text,
          agentId,
        });
        if (replyKey) stepReasoningEntryId.set(replyKey, replyId);
      } else {
        _batchDelta(replyId, text, appendTo);
      }
      break;
    }
    case 'reasoning_delta': {
      const id = stepId ? stepReasoningEntryId.get(stepId) : undefined;
      if (id) _batchDelta(id, String(ev.text ?? ''), appendTo);
      break;
    }
    case 'tool_start': {
      const name = String(ev.name || '工具');
      const body = String(ev.args_summary || '').trim() || name;
      if (agentId) setTool(agentId, name);
      append({ variant: 'tool_start', headline: name, body, agentId });
      break;
    }
    case 'tool_end': {
      const name = String(ev.name || '工具');
      const ok = Boolean(ev.ok);
      const summary = String(ev.result_summary || (ok ? '完成' : '失败'));
      append({
        variant: ok ? 'tool_done' : 'tool_failed',
        headline: name,
        body: summary,
        agentId,
      });
      if (agentId) beginThink(agentId);
      break;
    }
    case 'assistant_message': {
      _flushPending(appendTo);
      const md = String(ev.markdown || '');
      if (!md.trim() || !agentId) break;
      const replyKey = stepId ? `${stepId}:reply` : '';
      const existingId = replyKey ? stepReasoningEntryId.get(replyKey) : undefined;
      if (existingId) {
        patchInfer(existingId, { body: md });
        stepReasoningEntryId.delete(replyKey);
      } else {
        const ag = resolveAgent(snapshot, agentId);
        append({
          variant: 'reply',
          headline: agentReplyHeadline(ag),
          body: md,
          agentId,
        });
      }
      break;
    }
    case 'step_done': {
      _flushPending(appendTo);
      if (stepId) {
        stepReasoningEntryId.delete(stepId);
        stepReasoningEntryId.delete(`${stepId}:reply`);
      }
      if (agentId) finishInfer(agentId, '');
      break;
    }
    case 'delegation_start': {
      const fromId = typeof ev.from_agent_id === 'string' ? ev.from_agent_id : '';
      const toId = typeof ev.to_agent_id === 'string' ? ev.to_agent_id : '';
      const fromA = resolveAgent(snapshot, fromId);
      const toA = resolveAgent(snapshot, toId);
      const label = `${fromA?.name ?? fromId} → ${toA?.name ?? toId}`;
      append({
        variant: 'status',
        headline: '编排',
        body: String(ev.reason || '') ? `${label} · ${String(ev.reason)}` : label,
        agentId: toId || null,
      });
      break;
    }
    case 'error': {
      _flushPending(appendTo);
      append({
        variant: 'error',
        headline: '系统',
        body: String(ev.message || 'error'),
        agentId,
      });
      if (agentId) finishInfer(agentId, String(ev.message || 'error'));
      break;
    }
    case 'stopped': {
      _flushPending(appendTo);
      append({
        variant: 'status',
        headline: '已停止',
        body: '用户中止本轮生成',
        agentId,
      });
      if (agentId) finishInfer(agentId, '已停止');
      break;
    }
    case 'turn_done': {
      _flushPending(appendTo);
      sseActiveHermesStreamId = null;
      stepReasoningEntryId.clear();
      const st = useUiStore.getState().agentInferState;
      for (const [aid, v] of Object.entries(st)) {
        if (v?.phase === 'thinking' || v?.phase === 'tool') {
          finishInfer(aid, '');
        }
      }
      break;
    }
    case 'round_done': {
      _flushPending(appendTo);
      sseActiveHermesStreamId = null;
      stepReasoningEntryId.clear();
      const st = useUiStore.getState().agentInferState;
      for (const [aid, v] of Object.entries(st)) {
        if (v?.phase === 'thinking' || v?.phase === 'tool') {
          finishInfer(aid, '');
        }
      }
      const roundIdx = typeof ev.round_index === 'number' ? ev.round_index : 0;
      if (roundIdx > 0) {
        useUiStore.getState().setMultiRoundCount(roundIdx);
        append({
          variant: 'status',
          headline: `Round ${roundIdx} 完成`,
          body: ev.termination_reason
            ? `收敛方式: ${String(ev.termination_reason)}`
            : '本轮讨论已结束，可继续追加输入。',
          agentId: null,
        });
      }
      break;
    }
    default:
      break;
  }
}

export function consumeOrchestratedSse(
  runId: string,
  snapshot: TaskWorldSnapshot | null,
  orchestratorId: string,
  loadState: () => void,
): Promise<void> {
  const url = `/api/task/agent-chat-orchestrated/stream?run_id=${encodeURIComponent(runId)}`;
  return _sseConnect(url, orchestratorId, snapshot, loadState, 'turn_done');
}

const SSE_MAX_RETRIES = 3;
const SSE_RETRY_BASE_MS = 800;

function _sseConnect(
  url: string,
  orchestratorId: string,
  snapshot: TaskWorldSnapshot | null,
  loadState: () => void,
  doneType: string,
  retryCount = 0,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const es = new EventSource(url);
    let resolved = false;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as Record<string, unknown>;
        applyOrchestrationSseEvent(ev, snapshot);
        if (ev.type === doneType) {
          resolved = true;
          es.close();
          loadState();
          resolve();
        }
      } catch (err) {
        es.close();
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    };
    es.onerror = () => {
      es.close();
      if (resolved) return;
      if (retryCount < SSE_MAX_RETRIES) {
        const delay = SSE_RETRY_BASE_MS * Math.pow(2, retryCount);
        setTimeout(() => {
          _sseConnect(url, orchestratorId, snapshot, loadState, doneType, retryCount + 1)
            .then(resolve, reject);
        }, delay);
        return;
      }
      useUiStore.getState().appendInference({
        variant: 'error',
        headline: '系统',
        body: 'SSE 连接中断',
        agentId: orchestratorId,
      });
      reject(new Error('sse_error'));
    };
  });
}

/** SSE consumer for multi-round orchestration. Resolves on ``round_done`` — keeps going on other events. */
export function consumeMultiRoundSse(
  runId: string,
  sessionId: string,
  snapshot: TaskWorldSnapshot | null,
  orchestratorId: string,
  loadState: () => void,
): Promise<void> {
  const url = `/api/task/multi-round/stream?session_id=${encodeURIComponent(sessionId)}&run_id=${encodeURIComponent(runId)}`;
  return _sseConnect(url, orchestratorId, snapshot, loadState, 'round_done');
}
