/**
 * Hermes 会话发送 / 停止 — 供 React 底栏与 Phaser 全页 UI 共用。
 * 多 Agent 编排由后端 `/api/task/agent-chat-orchestrated` 执行。
 */
import { clearSseActiveHermesStreamId, consumeMultiRoundSse, consumeOrchestratedSse, getSseActiveHermesStreamId } from './orchestrationSse';
import * as gameApi from '../services/gameApi';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import type { Agent, TaskWorldSnapshot } from '../types/game';
import { isPeerVisitorAgent } from '../ui/buildingLayout';

const sessionsRef: Record<string, string> = {};

export function syncHermesSessionsFromSnapshot(snapshot: TaskWorldSnapshot | null): void {
  if (!snapshot) return;
  const valid = new Set(snapshot.agents.map((a) => a.id));
  for (const k of Object.keys(sessionsRef)) {
    if (!valid.has(k)) delete sessionsRef[k];
  }
  for (const a of snapshot.agents) {
    if (a.hermes_session_id) sessionsRef[a.id] = a.hermes_session_id;
  }
}

export function resolveAgent(snapshot: TaskWorldSnapshot | null, token: string): Agent | undefined {
  return gameApi.resolveGameAgent(snapshot?.agents, token);
}

export function agentReplyHeadline(agent: Agent): string {
  const p = (agent.profession || '').trim();
  return p ? `${agent.display_name || agent.name} · ${p}` : (agent.display_name || agent.name);
}

/** 用户 `@同伴|…` 且未选顶栏 Agent 时，用「另一名」作 API 的 agent_id（发起点）。跨机访客不能当编排主 agent。 */
function orchestratorForRelay(snapshot: TaskWorldSnapshot | null, selected: Agent | null, relayPeer: Agent): Agent | null {
  if (selected && !isPeerVisitorAgent(selected)) return selected;
  return snapshot?.agents.find((a) => a.id !== relayPeer.id && !isPeerVisitorAgent(a)) ?? null;
}

/** 与底栏发送一致：使用 multi-round 端点，每次对话自动支持后续继续。 */
export async function runOrchestratedAndFlushUi(
  snapshot: TaskWorldSnapshot | null,
  orchestratorId: string,
  message: string,
  attachments: string[] | undefined,
  loadState_: () => void,
): Promise<void> {
  const store = useUiStore.getState();
  store.beginCenterAgentThinking(orchestratorId);
  try {
    const existingSessionId = store.multiRoundSessionId;
    const raw = await gameApi.postMultiRoundRun({
      agent_id: orchestratorId,
      message,
      session_id: existingSessionId || undefined,
    });
    if (!raw.ok || !raw.run_id) {
      throw new Error(raw.error || 'multi_round_run_failed');
    }
    const wo = typeof raw.work_order_id === 'string' && raw.work_order_id.trim() ? raw.work_order_id.trim() : '';
    const sid = raw.session_id || existingSessionId || '';
    if (wo) useUiStore.getState().setMonitorFocusWorkOrderId(wo);
    await consumeMultiRoundSse(raw.run_id, sid, snapshot, orchestratorId, loadState_);
    // 自动激活多轮会话，后续发送自动走 continue 路径
    if (sid && sid !== existingSessionId) {
      useUiStore.getState().setMultiRoundSession(sid);
    }
  } finally {
    store.finishCenterAgentInference(orchestratorId, '');
  }
}

export async function stopStudioChat(): Promise<void> {
  const sid = getSseActiveHermesStreamId();
  if (sid) {
    try {
      await gameApi.cancelGameAgentStream(sid);
    } catch {
      /* ignore */
    }
    clearSseActiveHermesStreamId();
    return;
  }
  const aid = useUiStore.getState().selectedAgentId;
  if (!aid) return;
  if (!useUiStore.getState().agentStreamIds[aid]) return;
  useUiStore.getState().clearAgentStream(aid);
}

/** Continue a multi-round discussion with a user continuation message via SSE. */
export async function continueMultiRoundDiscussion(
  snapshot: TaskWorldSnapshot | null,
  orchestratorId: string,
  sessionId: string,
  message: string,
  loadState_: () => void,
): Promise<void> {
  const store = useUiStore.getState();
  store.beginCenterAgentThinking(orchestratorId);
  try {
    const raw = await gameApi.postMultiRoundRun({
      agent_id: orchestratorId,
      message,
      session_id: sessionId,
    });
    if (!raw.ok || !raw.run_id) {
      throw new Error(raw.error || 'multi_round_run_failed');
    }
    const newSid = raw.session_id || sessionId;
    if (newSid !== sessionId) {
      useUiStore.getState().setMultiRoundSession(newSid);
    }
    await consumeMultiRoundSse(raw.run_id, newSid, snapshot, orchestratorId, loadState_);
  } finally {
    store.finishCenterAgentInference(orchestratorId, '');
  }
}

export type SubmitChatOptions = {
  text: string;
  pendingFiles: File[];
  snapshot: TaskWorldSnapshot | null;
  onToast: (msg: string) => void;
  clearInput: () => void;
  clearPendingFiles: () => void;
};

export async function submitStudioChat(o: SubmitChatOptions): Promise<void> {
  const text = o.text.trim();
  const { snapshot, onToast, clearInput, clearPendingFiles } = o;
  let pendingImages = [...o.pendingFiles];

  if (!text && pendingImages.length === 0) {
    onToast('请输入内容或添加图片');
    return;
  }

  const loadState = () => void useTaskStore.getState().loadState({ silent: true });
  const finalizeRound = useUiStore.getState().finalizeInferenceRound;
  const selectedAgentId = useUiStore.getState().selectedAgentId;
  const selectedAgent = snapshot?.agents.find((a) => a.id === selectedAgentId) ?? null;

  const handoff = gameApi.parseUserHandoffPrefix(text);
  if (handoff) {
    const { token, message: sub } = handoff;
    if (!sub) {
      onToast(
        '转发内容不能为空。请使用：`@对方 profile/id/姓名/显示名 | 要说的话` 或 `@对方 要说的话`；群发：`@所有人 | …` 或 `@所有人 …`（竖线可用全角｜）',
      );
      clearPendingFiles();
      return;
    }
    const append = useUiStore.getState().appendInference;

    if (gameApi.isBroadcastAllHandoffToken(token)) {
      if (!selectedAgent) {
        onToast('请先在顶部选一个 Agent，再发 `@所有人 | …`（由当前 Agent 群发至其余同伴）');
        clearPendingFiles();
        return;
      }
      if (!snapshot || snapshot.agents.length < 2) {
        onToast('至少需要两名 Agent 才能使用 `@所有人`');
        clearPendingFiles();
        return;
      }
      const relayRoundUserIdx = useUiStore.getState().inferenceLog.length;
      append({
        variant: 'user',
        headline: '你 · 群发',
        body: `@所有人 | ${sub}`,
        agentId: selectedAgent.id,
      });
      try {
        await runOrchestratedAndFlushUi(snapshot, selectedAgent.id, text, undefined, loadState);
      } catch (e) {
        append({
          variant: 'error',
          headline: '系统',
          body: (e as Error).message,
          agentId: selectedAgent.id,
        });
      } finally {
        finalizeRound(relayRoundUserIdx);
        clearInput();
        clearPendingFiles();
      }
      return;
    }

    const peer = resolveAgent(snapshot, token);
    const relayRoundUserIdx = useUiStore.getState().inferenceLog.length;
    append({
      variant: 'user',
      headline: '你 · 手动转发',
      body: `@${token} | ${sub}`,
      agentId: selectedAgent?.id ?? peer?.id ?? null,
    });
    if (!peer) {
      append({
        variant: 'error',
        headline: '系统',
        body: `未找到目标「${token}」。请使用当前存档里 Agent 的 id、profile、姓名或显示名（@ 同一行）。`,
        agentId: selectedAgent?.id ?? null,
      });
      finalizeRound(relayRoundUserIdx);
      clearInput();
      clearPendingFiles();
      return;
    }
    const orch = orchestratorForRelay(snapshot, selectedAgent, peer);
    if (!orch) {
      onToast('请先在顶部选一个 Agent，或确保存档里至少还有另一名 Agent 可作发起点。');
      finalizeRound(relayRoundUserIdx);
      clearInput();
      clearPendingFiles();
      return;
    }
    try {
      await runOrchestratedAndFlushUi(snapshot, orch.id, text, undefined, loadState);
    } catch (e) {
      append({
        variant: 'error',
        headline: '系统',
        body: (e as Error).message,
        agentId: peer?.id ?? null,
      });
    } finally {
      finalizeRound(relayRoundUserIdx);
      clearInput();
      clearPendingFiles();
    }
    return;
  }

  if (!selectedAgent) {
    onToast(
      '请先在顶部选一个 Agent 作为本轮对话入口（各 Agent 独立会话、地位对等）；点名另一名请单独发：`@对方的 profile / id / 姓名 / 显示名 | 消息`（竖线可用全角｜）',
    );
    clearPendingFiles();
    return;
  }
  const append = useUiStore.getState().appendInference;

  const mainRoundUserIdx = useUiStore.getState().inferenceLog.length;
  const pendingCount = pendingImages.length;
  const pendingFilesSnapshot = pendingImages;
  pendingImages = [];
  clearPendingFiles();
  append({
    variant: 'user',
    headline: '你',
    body: text || `（已附加 ${pendingCount} 张图片）`,
    agentId: selectedAgent.id,
  });
  try {
    let attachments: string[] = [];
    if (pendingFilesSnapshot.length > 0) {
      const uploadResults = await Promise.all(
        pendingFilesSnapshot.map((f) =>
          gameApi.uploadGameAgentAttachment(selectedAgent.id, f).catch((err) => {
            onToast(`图片上传失败: ${(err as Error).message}`);
            return null;
          }),
        ),
      );
      const succeeded = uploadResults.filter((r): r is { filename: string; path: string; size: number } => r !== null);
      attachments = succeeded.map((r) => r.path);
      if (succeeded.length < pendingFilesSnapshot.length) {
        onToast(`图片上传部分失败（${succeeded.length}/${pendingFilesSnapshot.length}）`);
      }
    }

    const attachHint = attachments.length > 0 ? `\n\n[Attached files: ${attachments.join('\n')}]` : '';
    const messageToModel = (text || '（请结合上传的图片回答。）') + attachHint;

    await runOrchestratedAndFlushUi(
      snapshot,
      selectedAgent.id,
      messageToModel,
      attachments.length > 0 ? attachments : undefined,
      loadState,
    );
  } catch (e) {
    append({
      variant: 'error',
      headline: '系统',
      body: (e as Error).message,
      agentId: selectedAgent.id,
    });
  } finally {
    finalizeRound(mainRoundUserIdx);
    clearInput();
  }
}
