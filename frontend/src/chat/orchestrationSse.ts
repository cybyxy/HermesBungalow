/**
 * SSE 消费：编排会话事件 → inferenceLog / 画布状态。
 * 同 step_id 的 reasoning_delta 合并到一条 reasoning 气泡（appendToInference）。
 */
import { useUiStore } from '../store/uiStore';
import type { Agent, GameWorldSnapshot } from '../types/game';
import { agentTitleWithProfessionLine } from '../ui/buildingLayout';
import * as gameApi from '../services/gameApi';

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
  return agentTitleWithProfessionLine(agent);
}

function resolveAgent(snapshot: GameWorldSnapshot | null, agentId: string | null | undefined): Agent | undefined {
  return gameApi.resolveSnapshotAgentForInference(snapshot, agentId ?? undefined);
}

export function applyOrchestrationSseEvent(ev: Record<string, unknown>, snapshot: GameWorldSnapshot | null): void {
  const t = String(ev.type || '');
  const append = useUiStore.getState().appendInference;
  const appendTo = useUiStore.getState().appendToInference;
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
      const ag = resolveAgent(snapshot, agentId);
      append({
        variant: 'reply',
        headline: agentReplyHeadline(ag),
        body: md,
        agentId,
      });
      break;
    }
    case 'step_done': {
      if (stepId) stepReasoningEntryId.delete(stepId);
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
    default:
      break;
  }
}

/**
 * 订阅编排 SSE。网络闪断时同一 `run_id` 可再次连接，后端 `_ORCH_SSE_QUEUES` 在 `turn_done` 前仍保留队列。
 */
export function consumeOrchestratedSse(
  runId: string,
  snapshot: GameWorldSnapshot | null,
  orchestratorId: string,
  loadState: () => void,
): Promise<void> {
  const url = `/api/game/agent-chat-orchestrated/stream?run_id=${encodeURIComponent(runId)}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectCount = 0;
    let hasReceivedData = false;
    const maxReconnects = 14;

    const cleanup = () => {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      es?.close();
      es = null;
    };

    const finishOk = () => {
      if (settled) return;
      settled = true;
      cleanup();
      loadState();
      resolve();
    };

    const finishErr = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(message));
    };

    const scheduleReconnect = () => {
      if (settled) return;
      if (!hasReceivedData && reconnectCount >= 3) {
        finishErr('无法建立编排事件流（请确认后端已启动且未返回 404）');
        return;
      }
      reconnectCount += 1;
      if (reconnectCount > maxReconnects) {
        finishErr('编排事件流多次自动重连失败，请检查网络后重试');
        return;
      }
      const delay = Math.min(12_000, 350 + reconnectCount * 600 + Math.random() * 450);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (settled) return;
        if (hasReceivedData && reconnectCount === 1) {
          useUiStore.getState().appendInference({
            variant: 'status',
            headline: '系统',
            body: '编排事件流中断，正在自动重连…',
            agentId: orchestratorId,
          });
        }
        open();
      }, delay);
    };

    const onMessage = (e: MessageEvent) => {
      if (settled) return;
      try {
        hasReceivedData = true;
        const ev = JSON.parse(e.data) as Record<string, unknown>;
        applyOrchestrationSseEvent(ev, snapshot);
        if (ev.type === 'turn_done') {
          finishOk();
        }
      } catch (err) {
        finishErr(err instanceof Error ? err.message : String(err));
      }
    };

    const open = () => {
      if (settled) return;
      es?.close();
      try {
        es = new EventSource(url, { withCredentials: true } as EventSourceInit);
      } catch {
        es = new EventSource(url);
      }
      es.onmessage = onMessage;
      es.onerror = () => {
        if (settled) return;
        es?.close();
        scheduleReconnect();
      };
    };

    open();
  });
}
