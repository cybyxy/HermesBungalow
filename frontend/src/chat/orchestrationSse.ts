/**
 * SSE 消费：编排会话事件 → inferenceLog / 画布状态。
 * 同 step_id 的 reasoning_delta 合并到一条 reasoning 气泡（appendToInference）。
 */
import { useUiStore } from '../store/uiStore';
import type { Agent, TaskWorldSnapshot } from '../types/game';

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
        appendTo(replyId, text);
      }
      break;
    }
    case 'reasoning_delta': {
      const id = stepId ? stepReasoningEntryId.get(stepId) : undefined;
      if (id) appendTo(id, String(ev.text ?? ''));
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
  return new Promise((resolve, reject) => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as Record<string, unknown>;
        applyOrchestrationSseEvent(ev, snapshot);
        if (ev.type === 'turn_done') {
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
  return new Promise((resolve, reject) => {
    const es = new EventSource(url);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as Record<string, unknown>;
        applyOrchestrationSseEvent(ev, snapshot);
        if (ev.type === 'round_done') {
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
