/**
 * Renders backend `agent-chat-orchestrated` JSON into the center inference log.
 */
import { useUiStore } from '../store/uiStore';
import type { Agent, GameWorldSnapshot } from '../types/game';
import type {
  AgentChatOrchestratedResult,
  OrchestrationDelegationRow,
  OrchestrationTraceRow,
} from '../services/gameApi';
import * as gameApi from '../services/gameApi';
import type { InferenceEntry } from '../store/uiStore';
import { agentTitleWithProfessionLine, isPeerVisitorAgent } from '../ui/buildingLayout';

function agentReplyHeadline(agent: Agent): string {
  return agentTitleWithProfessionLine(agent);
}

/**
 * 规范化网关 ``peer_relay_inference`` 的 ``trace``（可能为 JSON 字符串、或含 ``Type``/``tool_end`` 等变体）。
 */
export function normalizeGatewayTraceRows(raw: unknown): OrchestrationTraceRow[] {
  let v: unknown = raw;
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: OrchestrationTraceRow[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const typRaw = o.type ?? o.Type ?? o.event_type;
    const typ = String(typRaw ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
    if (typ === 'reasoning') {
      const text = String(o.text ?? o.content ?? o.body ?? '').trim();
      if (text) out.push({ type: 'reasoning', text });
      continue;
    }
    if (typ === 'reasoning_delta' || typ === 'reasoningdelta') {
      const piece = String(o.text ?? '').trim();
      if (!piece) continue;
      const last = out[out.length - 1];
      if (last && last.type === 'reasoning') {
        last.text = `${last.text}${piece}`;
      } else {
        out.push({ type: 'reasoning', text: piece });
      }
      continue;
    }
    if (typ === 'tool' || typ === 'tool_start') {
      out.push({
        type: 'tool',
        name: typeof o.name === 'string' ? o.name : String(o.name ?? ''),
        preview: typeof o.preview === 'string' ? o.preview : undefined,
        args:
          typeof o.args === 'object' && o.args !== null && !Array.isArray(o.args)
            ? (o.args as Record<string, string>)
            : undefined,
      });
      continue;
    }
    if (typ === 'tool_complete' || typ === 'tool_end' || typ === 'tool_done') {
      const isErr = typ === 'tool_complete' ? Boolean(o.is_error) : o.ok === false;
      out.push({
        type: 'tool_complete',
        name: typeof o.name === 'string' ? o.name : String(o.name ?? ''),
        preview: typeof o.preview === 'string' ? o.preview : undefined,
        duration: o.duration,
        is_error: isErr,
      });
    }
  }
  return out;
}

type InferencePartial = Omit<InferenceEntry, 'id' | 'at'> & { id?: string };

function appendTraceRows(agentId: string | null, rows: OrchestrationTraceRow[] | undefined): void {
  if (!agentId || !rows?.length) return;
  const batch: InferencePartial[] = [];
  for (const row of rows) {
    if (row.type === 'reasoning' && (row.text ?? '').trim()) {
      batch.push({
        variant: 'reasoning',
        headline: '推理',
        body: row.text.trim(),
        agentId,
      });
      continue;
    }
    if (row.type === 'tool') {
      const name = (row.name ?? '').trim() || '工具';
      const bits: string[] = [];
      if ((row.preview ?? '').trim()) bits.push(String(row.preview).trim());
      const args = row.args;
      if (args && Object.keys(args).length) {
        try {
          bits.push(JSON.stringify(args, null, 0));
        } catch {
          bits.push(String(args));
        }
      }
      const body = bits.join('\n') || name;
      batch.push({ variant: 'tool_start', headline: name, body, agentId });
      continue;
    }
    if (row.type === 'tool_complete') {
      const name = (row.name ?? '').trim() || '工具';
      const ok = !row.is_error;
      const body =
        [row.preview, row.duration != null ? `耗时: ${String(row.duration)}` : ''].filter(Boolean).join('\n') ||
        (ok ? '完成' : '失败');
      batch.push({
        variant: ok ? 'tool_done' : 'tool_failed',
        headline: name,
        body,
        agentId,
      });
    }
  }
  if (batch.length) useUiStore.getState().appendInferenceBatch(batch);
}

function walkDelegations(snapshot: GameWorldSnapshot | null, delegations: OrchestrationDelegationRow[]): void {
  const append = useUiStore.getState().appendInference;
  for (const d of delegations) {
    const peer = gameApi.resolveGameAgent(snapshot?.agents, d.target);
    const headline = peer ? agentReplyHeadline(peer) : `同伴 · ${d.target}`;
    appendTraceRows(peer?.id ?? null, d.trace);
    if (!d.ok) {
      append({
        variant: 'error',
        headline,
        body: String(d.error ?? '失败'),
        agentId: peer?.id ?? null,
      });
    } else if ((d.reply ?? '').trim()) {
      append({
        variant: 'reply',
        headline,
        body: d.reply ?? '',
        agentId: peer?.id ?? null,
      });
    }
    if (d.nested?.length) {
      walkDelegations(snapshot, d.nested);
    }
  }
}

/** Append primary reply (if any) and the delegation tree from one orchestrate response. */
export function appendOrchestratedInference(
  snapshot: GameWorldSnapshot | null,
  primaryAgentId: string,
  res: AgentChatOrchestratedResult,
): void {
  const append = useUiStore.getState().appendInference;
  const primary = res.primary;
  const uh = primary?.user_handoff;
  const primaryAgent = snapshot?.agents.find((a) => a.id === primaryAgentId);

  if (!res.ok) {
    append({
      variant: 'error',
      headline: '系统',
      body: res.detail ?? res.error ?? 'orchestrate_failed',
      agentId: primaryAgentId,
    });
    return;
  }

  appendTraceRows(primaryAgentId, primary?.trace);

  if (primary && !uh) {
    if (primary.ok && (primary.reply ?? '').trim()) {
      if (primaryAgent) {
        append({
          variant: 'reply',
          headline: agentReplyHeadline(primaryAgent),
          body: primary.reply ?? '',
          agentId: primaryAgent.id,
        });
      }
    } else if (!primary.ok && primary.error) {
      append({
        variant: 'error',
        headline: primaryAgent ? agentReplyHeadline(primaryAgent) : '系统',
        body: String(primary.error),
        agentId: primaryAgentId,
      });
    }
  }

  if (res.delegations?.length) {
    walkDelegations(snapshot, res.delegations);
  }
}

/**
 * WebSocket ``peer_relay_inference`` 一次性带回整段 trace，无 SSE 流式事件，需在此补写头顶
 * ``agentInferState``（与 ``orchestrationSse.applyOrchestrationSseEvent`` 行为对齐）。
 */
export function applyPeerRelayTraceToCenterHead(
  agentId: string,
  trace: OrchestrationTraceRow[],
  replyPreview: string,
  ok: boolean,
): void {
  const beginThink = useUiStore.getState().beginCenterAgentThinking;
  const setTool = useUiStore.getState().setCenterAgentTool;
  const finishInfer = useUiStore.getState().finishCenterAgentInference;
  beginThink(agentId);
  for (const row of trace) {
    if (!row || typeof row !== 'object') continue;
    if (row.type === 'tool') {
      const name = String(row.name || '').trim() || '工具';
      setTool(agentId, name);
    } else if (row.type === 'tool_complete') {
      beginThink(agentId);
    }
  }
  const rp = replyPreview.trim();
  let tail = rp ? [...rp].slice(0, 10).join('') : '';
  if (!tail) {
    for (let i = trace.length - 1; i >= 0; i--) {
      const r = trace[i];
      if (r?.type === 'reasoning' && typeof r.text === 'string') {
        const tx = r.text.trim().replace(/\s+/g, ' ');
        if (tx) {
          tail = [...tx].slice(0, 10).join('');
          break;
        }
      }
    }
  }
  if (!ok) {
    finishInfer(agentId, tail || '失败');
    return;
  }
  finishInfer(agentId, tail);
}

/** WebSocket：对端机 ``agent-relay-from-peer`` 完成后推送，在本地中心日志展示远端 Agent 的推理与回复。 */
export function appendGatewayPeerRelayInference(
  snapshot: GameWorldSnapshot | null,
  data: Record<string, unknown>,
): void {
  const relayTargetId = typeof data.target_agent_id === 'string' ? data.target_agent_id.trim() : '';
  if (!relayTargetId) return;
  const append = useUiStore.getState().appendInference;
  const ag = gameApi.resolveSnapshotAgentForInference(snapshot, relayTargetId);
  /** 头顶气泡 / 右侧过程：一律挂在解析后的本机行（来访为 pv_… id） */
  const uiAgentId = ag?.id ?? relayTargetId;
  const head = ag ? agentReplyHeadline(ag) : '同伴';
  append({
    variant: 'status',
    headline: '串门 · 对端代跑',
    body: ag && isPeerVisitorAgent(ag)
      ? '对端正通过串门接口为该访客执行一轮对话；推理与回复如下。'
      : '同伴工作室正通过串门接口为你的 Agent 执行一轮对话；推理与回复如下。',
    agentId: uiAgentId,
  });
  let trace = normalizeGatewayTraceRows(data.trace);
  const rp = typeof data.reply_preview === 'string' ? data.reply_preview.trim() : '';
  let replyInProcessColumnOnly = false;
  if (trace.length === 0 && rp) {
    trace = [
      {
        type: 'reasoning',
        text: `（未收到分步推理 trace；以下为模型回复全文。）\n\n${rp.slice(0, 12000)}`,
      },
    ];
    replyInProcessColumnOnly = true;
  }
  applyPeerRelayTraceToCenterHead(uiAgentId, trace, rp, data.ok !== false);
  appendTraceRows(uiAgentId, trace);
  if (data.ok === false) {
    const err = typeof data.error === 'string' ? data.error.trim() : '';
    if (err) {
      append({ variant: 'error', headline: head, body: err, agentId: uiAgentId });
    }
  }
  if (rp && !replyInProcessColumnOnly) {
    append({ variant: 'reply', headline: head, body: rp, agentId: uiAgentId });
  }
}
