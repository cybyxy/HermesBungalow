/**
 * Hermes 会话发送 / 停止 / 多 Agent 转交 — 供 React 底栏与 Phaser 全页 UI 共用。
 */
import * as gameApi from '../services/gameApi';
import {
  clearCollabWalkFootOverride,
  runApproachWalkBeforePeerInvoke,
  runCollabWalkReturnToSpawn,
} from '../collab/studioCollabWalkBridge';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import type { Agent, GameWorldSnapshot } from '../types/game';

export const MAX_INVOKE_DEPTH = 8;

const sessionsRef: Record<string, string> = {};

export function syncHermesSessionsFromSnapshot(snapshot: GameWorldSnapshot | null): void {
  if (!snapshot) return;
  const valid = new Set(snapshot.agents.map((a) => a.id));
  for (const k of Object.keys(sessionsRef)) {
    if (!valid.has(k)) delete sessionsRef[k];
  }
  for (const a of snapshot.agents) {
    if (a.hermes_session_id) sessionsRef[a.id] = a.hermes_session_id;
  }
}

function _eventTypeToChinese(eventType: string): string {
  if (eventType === 'tool.started') return '工具使用中';
  if (eventType === 'tool.completed') return '工具已完成';
  if (eventType === 'approval.required') return '等待确认';
  if (eventType === 'reasoning.available') return '推理中';
  if (eventType === '_thinking') return '思考中';
  if (eventType === 'error') return '出错了';
  return '工具使用中';
}

export function resolveAgent(snapshot: GameWorldSnapshot | null, token: string): Agent | undefined {
  return gameApi.resolveGameAgent(snapshot?.agents, token);
}

export function agentReplyHeadline(agent: Agent): string {
  const p = (agent.profession || '').trim();
  return p ? `${agent.name} · ${p}` : agent.name;
}

function withPeerHintForMessage(snapshot: GameWorldSnapshot | null, core: string): string {
  if (!snapshot || snapshot.agents.length < 2) return core;
  return (
    gameApi.buildPeerInvokeHint(
      snapshot.agents.map((a) => ({ name: a.name, profile: a.profile, id: a.id })),
    ) + core
  );
}

function buildHandoffPeerUserMessage(
  snapshot: GameWorldSnapshot | null,
  invokerFullReply: string,
  invokeBody: string,
): string {
  const stripped = gameApi.stripHermesBungalowInvokes(invokerFullReply);
  const task = invokeBody.trim();
  if (!stripped) {
    return withPeerHintForMessage(snapshot, task);
  }
  const ctx = `\n\n──────── 同伴本轮对用户输出的正文（@ 转交行已剥离，供你衔接上下文）────────\n${gameApi.truncateHandoffContext(stripped)}\n\n──────── 对方点名要你处理的任务 ────────\n${task}`;
  return withPeerHintForMessage(snapshot, ctx);
}

export async function runSseForAgent(
  snapshot: GameWorldSnapshot | null,
  agent: Agent,
  headline: string,
  messageToModel: string,
  attachments?: string[],
): Promise<{ text: string; sid: string }> {
  const append = useUiStore.getState().appendInference;
  const appendTo = useUiStore.getState().appendToInference;
  let sid = agent.hermes_session_id ?? sessionsRef[agent.id];
  if (!sid) {
    const created = await gameApi.createHermesSession(agent.profile);
    sid = created.session_id;
    sessionsRef[agent.id] = sid;
  }
  let replyEntryId: string | null = null;
  const ensureReplyEntry = () => {
    if (!replyEntryId) {
      replyEntryId = append({
        variant: 'reply',
        headline,
        body: '',
        agentId: agent.id,
      });
    }
    return replyEntryId;
  };
  let acc = '';
  let latestSid = sid;
  let streamError: Error | null = null;
  /** 连续多条 reasoning SSE 合并到同一条 inference，避免过程列 sig/重绘与条数问题 */
  let mergeReasoningId: string | null = null;
  useUiStore.getState().beginCenterAgentThinking(agent.id);
  try {
    await gameApi.streamChatSse(
      messageToModel,
      sid,
      (chunk, done, fullText, doneMeta) => {
        if (done) {
          const fromDone = fullText != null && fullText !== '' ? fullText : '';
          acc = gameApi.mergeAssistantTextForOrchestration(acc, fromDone || null);
          const finalized = acc;
          if (finalized) {
            const id = replyEntryId ?? ensureReplyEntry();
            appendTo(id, finalized);
          }
          if (doneMeta?.display?.markdown_editor === true) {
            const id = replyEntryId ?? ensureReplyEntry();
            if (id) {
              useUiStore.getState().patchInference(id, { markdownEditor: true });
            }
          }
          return;
        }
        if (chunk) {
          appendTo(ensureReplyEntry(), chunk);
          acc += chunk;
        }
      },
      (meta) => {
        if (meta.type === 'reasoning') {
          const t = meta.text;
          if (!t) return;
          if (mergeReasoningId) {
            appendTo(mergeReasoningId, t);
          } else {
            mergeReasoningId = append({ variant: 'reasoning', headline: '推理', body: t, agentId: agent.id });
          }
        } else if (meta.type === 'tool') {
          mergeReasoningId = null;
          const p = meta.payload as { name?: string; preview?: string; args?: Record<string, string>; event_type?: string };
          const toolName = p.name ?? '未知工具';
          const eventType = p.event_type ?? 'tool.started';
          const eventLabel = _eventTypeToChinese(eventType);
          const argsLines = p.args
            ? Object.entries(p.args).map(([k, v]) => `  ${k}: ${v}`).join('\n')
            : '';
          const body = argsLines ? `调用工具: ${toolName}\n${argsLines}` : `调用工具: ${toolName}`;
          useUiStore.getState().setCenterAgentTool(agent.id, eventLabel);
          append({ variant: 'tool_start', headline: '工具', body, agentId: agent.id });
        } else if (meta.type === 'tool_complete') {
          mergeReasoningId = null;
          const p = meta.payload as { name?: string };
          const toolName = p.name ?? '';
          const doneText = toolName ? `${toolName} 完成` : '工具完成';
          append({ variant: 'tool_done', headline: '工具', body: doneText, agentId: agent.id });
          useUiStore.getState().setCenterAgentTool(agent.id, doneText);
        }
      },
      {
        bungalowAgentId: agent.id,
        onHermesSessionId: (id) => {
          if (id) {
            sessionsRef[agent.id] = id;
            latestSid = id;
          }
        },
        onStreamId: (streamId) => {
          useUiStore.getState().setAgentStream(agent.id, streamId);
        },
        attachments,
        onClarifyRequest: (p) =>
          new Promise<string>((resolve) => {
            useUiStore.getState().setClarifyPrompt({ question: p.question, choices_offered: p.choices_offered ?? [], resolve });
          }),
      },
    );
  } catch (e) {
    streamError = e instanceof Error ? e : new Error(String(e));
    throw streamError;
  } finally {
    useUiStore.getState().finishCenterAgentInference(
      agent.id,
      streamError ? streamError.message : acc,
    );
    useUiStore.getState().clearAgentStream(agent.id);
  }
  return { text: acc, sid: latestSid };
}

export async function stopStudioChat(): Promise<void> {
  const aid = useUiStore.getState().selectedAgentId;
  if (!aid) return;
  const sid = useUiStore.getState().agentStreamIds[aid];
  if (!sid) return;
  try {
    await gameApi.cancelStream(sid);
  } catch {
    /* best-effort */
  } finally {
    useUiStore.getState().clearAgentStream(aid);
  }
}

export type SubmitChatOptions = {
  text: string;
  pendingFiles: File[];
  snapshot: GameWorldSnapshot | null;
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

  const loadState = () => void useGameStore.getState().loadState();
  const finalizeRound = useUiStore.getState().finalizeInferenceRound;
  const selectedAgentId = useUiStore.getState().selectedAgentId;
  const selectedAgent = snapshot?.agents.find((a) => a.id === selectedAgentId) ?? null;

  const dispatchInvokes = async (
    fromAgent: Agent,
    invokeList: { target: string; message: string }[],
    depth: number,
    invokerFullReply: string,
  ): Promise<void> => {
    const append = useUiStore.getState().appendInference;
    if (depth > MAX_INVOKE_DEPTH) {
      return;
    }
    const expanded = gameApi.expandHermesInvokesForSender(fromAgent, snapshot?.agents ?? [], invokeList);
    const selfSet = new Set(
      [fromAgent.id, fromAgent.profile ?? '', fromAgent.name, (fromAgent.display_name ?? '').trim()].filter(
        Boolean,
      ) as string[],
    );
    type TargetRow = { peer: Agent; message: string };
    const targets: TargetRow[] = [];
    for (const iv of expanded) {
      if (selfSet.has(iv.target)) {
        continue;
      }
      const peer = resolveAgent(snapshot, iv.target);
      if (!peer) {
        append({
          variant: 'error',
          headline: '系统',
          body: `未找到同伴：「${iv.target}」`,
          agentId: fromAgent.id,
        });
        continue;
      }
      targets.push({ peer, message: iv.message });
    }

    clearCollabWalkFootOverride(fromAgent.id);
    for (let i = 0; i < targets.length; i++) {
      const { peer, message } = targets[i]!;
      const msg = buildHandoffPeerUserMessage(snapshot, invokerFullReply, message);
      try {
        await runApproachWalkBeforePeerInvoke(fromAgent.id, peer.id, {
          chainFromCurrent: i > 0,
        });
        const { text: reply } = await runSseForAgent(snapshot, peer, agentReplyHeadline(peer), msg);
        const nested = gameApi.parseHermesBungalowInvokes(reply);
        if (nested.length > 0) {
          await dispatchInvokes(peer, nested, depth + 1, reply);
        }
      } catch (err) {
        append({
          variant: 'error',
          headline: `${peer.name} · 转交异常`,
          body: (err as Error).message,
          agentId: peer.id,
        });
      }
    }
    await runCollabWalkReturnToSpawn(fromAgent.id);
  };

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
        await dispatchInvokes(selectedAgent, [{ target: '所有人', message: sub }], 0, '');
        void loadState();
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
    if (peer && useUiStore.getState().agentStreamIds[peer.id]) {
      onToast(`${peer.name} 正在推理中，请稍后再试或切换到其他 Agent`);
      clearPendingFiles();
      return;
    }
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
    try {
      const { text: relayAcc } = await runSseForAgent(
        snapshot,
        peer,
        agentReplyHeadline(peer),
        withPeerHintForMessage(snapshot, sub),
      );
      const relayInvokes = gameApi.expandHermesInvokesForSender(
        peer,
        snapshot?.agents ?? [],
        gameApi.parseHermesBungalowInvokes(relayAcc),
      );
      if (relayInvokes.length > 0) {
        await dispatchInvokes(peer, relayInvokes, 0, relayAcc);
      }
      void loadState();
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

  if (useUiStore.getState().agentStreamIds[selectedAgent.id]) {
    onToast(`${selectedAgent.name} 正在推理中，请稍候或点击「停止」`);
    clearPendingFiles();
    return;
  }

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
    let sid = sessionsRef[selectedAgent.id] ?? '';
    if (!sid && pendingFilesSnapshot.length > 0) {
      sid = (await gameApi.createHermesSession(selectedAgent.profile)).session_id;
      sessionsRef[selectedAgent.id] = sid;
    }

    let attachments: string[] = [];
    if (pendingFilesSnapshot.length > 0) {
      const uploadResults = await Promise.all(
        pendingFilesSnapshot.map((f) =>
          gameApi.uploadImage(f, sid).catch((err) => {
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

    const peerHint =
      snapshot && snapshot.agents.length > 1
        ? gameApi.buildPeerInvokeHint(
            snapshot.agents.map((a) => ({ name: a.name, profile: a.profile, id: a.id })),
          )
        : '';
    const attachHint = attachments.length > 0 ? `\n\n[Attached files: ${attachments.join('\n')}]` : '';
    const messageToModel = peerHint + (text || '（请结合上传的图片回答。）') + attachHint;

    const { text: acc } = await runSseForAgent(
      snapshot,
      selectedAgent,
      agentReplyHeadline(selectedAgent),
      messageToModel,
      attachments,
    );

    const invokes = gameApi.expandHermesInvokesForSender(
      selectedAgent,
      snapshot?.agents ?? [],
      gameApi.parseHermesBungalowInvokes(acc),
    );
    if (invokes.length > 0) {
      await dispatchInvokes(selectedAgent, invokes, 0, acc);
    }

    void loadState();
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
