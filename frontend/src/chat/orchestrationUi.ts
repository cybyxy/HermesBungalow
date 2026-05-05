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

function agentReplyHeadline(agent: Agent): string {
  const p = (agent.profession || '').trim();
  return p ? `${agent.name} · ${p}` : agent.name;
}

function appendTraceRows(agentId: string | null, rows: OrchestrationTraceRow[] | undefined): void {
  if (!agentId || !rows?.length) return;
  const append = useUiStore.getState().appendInference;
  for (const row of rows) {
    if (row.type === 'reasoning' && (row.text ?? '').trim()) {
      append({
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
      append({ variant: 'tool_start', headline: name, body, agentId });
      continue;
    }
    if (row.type === 'tool_complete') {
      const name = (row.name ?? '').trim() || '工具';
      const ok = !row.is_error;
      const body =
        [row.preview, row.duration != null ? `耗时: ${String(row.duration)}` : ''].filter(Boolean).join('\n') ||
        (ok ? '完成' : '失败');
      append({
        variant: ok ? 'tool_done' : 'tool_failed',
        headline: name,
        body,
        agentId,
      });
    }
  }
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
