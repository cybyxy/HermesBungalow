import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { CSSProperties } from 'react';
import * as gameApi from '../services/gameApi';
import type { ClarifySsePayload } from '../services/gameApi';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import type { Agent, GameWorldSnapshot } from '../types/game';
import { MAIN_MENUS } from './menuConfig';
import { AddAgentModal } from './AddAgentModal';
import { MenuPopup } from './MenuPopup';
import { Modal } from './Modal';
import { colors, layoutPx } from './theme';

const MENU_BTN_W = 70;
const MAX_INVOKE_DEPTH = 8;
/** 与左侧主菜单按钮同高，保证底栏一行内所有按钮水平对齐 */
const FOOTER_BTN_H = 34;
/** 底栏输入行占位高度（多行时输入框由此向上浮出，不撑高底栏主行） */
const INPUT_ROW_H = FOOTER_BTN_H;
const TEXTAREA_MAX_H = 220;

/** 与「新建」及左侧菜单同高、同一条基线对齐 */
const footerBarBtn: CSSProperties = {
  fontSize: 10,
  height: FOOTER_BTN_H,
  padding: '0 10px',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

function resolveAgent(snapshot: GameWorldSnapshot | null, token: string): Agent | undefined {
  if (!snapshot) return undefined;
  const t = token.trim();
  return snapshot.agents.find((a) => a.id === t || a.profile === t || a.name === t);
}

/** 右侧推理与对话区：Agent 回复行标题为「名称 · 职业」。 */
function agentReplyHeadline(agent: Agent): string {
  const p = (agent.profession || '').trim();
  return p ? `${agent.name} · ${p}` : agent.name;
}

/** Prepend the same peer handoff instructions (@ / legacy XML) so every turn (any agent) can reach others. */
function withPeerHintForMessage(snapshot: GameWorldSnapshot | null, core: string): string {
  if (!snapshot || snapshot.agents.length < 2) return core;
  return (
    gameApi.buildPeerInvokeHint(
      snapshot.agents.map((a) => ({ name: a.name, profile: a.profile, id: a.id })),
    ) + core
  );
}

/** 发给同伴 Hermes 的 user 文本：含同伴全文（去掉 @/invoke 转交行）+ 子任务正文。 */
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
  const ctx = `\n\n──────── 同伴本轮对用户输出的正文（@/invoke 转交行已剥离，供你衔接上下文）────────\n${gameApi.truncateHandoffContext(stripped)}\n\n──────── 对方点名要你处理的任务 ────────\n${task}`;
  return withPeerHintForMessage(snapshot, ctx);
}

const bar: CSSProperties = {
  minHeight: layoutPx.bottomBar,
  flexShrink: 0,
  borderTop: `2px solid ${colors.border}`,
  background: '#151525',
  display: 'flex',
  alignItems: 'flex-end',
  gap: 8,
  padding: '8px 10px',
  position: 'relative',
  zIndex: 30,
  overflow: 'visible',
  minWidth: 0,
};

export function BottomBar(props: { snapshot: GameWorldSnapshot | null; gatewayStatus: string }) {
  const { snapshot, gatewayStatus } = props;
  const loadState = useGameStore((s) => s.loadState);
  const assignTask = useGameStore((s) => s.assignTask);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);

  const agentStreamIds = useUiStore((s) => s.agentStreamIds);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sessionsRef = useRef<Record<string, string>>({});

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${INPUT_ROW_H}px`;
    const h = Math.min(TEXTAREA_MAX_H, Math.max(INPUT_ROW_H, el.scrollHeight));
    el.style.height = `${h}px`;
  }, []);

  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [input, syncTextareaHeight]);

  useEffect(() => {
    const onResize = () => syncTextareaHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [syncTextareaHeight]);

  const selectedAgentStreaming = Boolean(selectedAgentId && agentStreamIds[selectedAgentId]);
  const selectedStreamId =
    selectedAgentId && agentStreamIds[selectedAgentId] ? agentStreamIds[selectedAgentId] : null;

  const handleStop = useCallback(async () => {
    const aid = useUiStore.getState().selectedAgentId;
    if (!aid) return;
    const sid = useUiStore.getState().agentStreamIds[aid];
    if (!sid) return;
    try {
      await gameApi.cancelStream(sid);
    } catch {
      // best-effort
    } finally {
      useUiStore.getState().clearAgentStream(aid);
    }
  }, []);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [newTaskName, setNewTaskName] = useState('新任务');
  const [newTaskProf, setNewTaskProf] = useState('程序员');
  const [toast, setToast] = useState<string | null>(null);
  /** Open clarify modal: Hermes wire payload + Promise resolver (same keys as SSE ``clarify``). */
  const [clarifyPrompt, setClarifyPrompt] = useState<(ClarifySsePayload & { resolve: (s: string) => void }) | null>(
    null,
  );
  const [clarifyOther, setClarifyOther] = useState('');

  const selectedAgent = snapshot?.agents.find((a) => a.id === selectedAgentId) ?? null;

  useEffect(() => {
    if (!snapshot) return;
    const valid = new Set(snapshot.agents.map((a) => a.id));
    for (const k of Object.keys(sessionsRef.current)) {
      if (!valid.has(k)) delete sessionsRef.current[k];
    }
    for (const a of snapshot.agents) {
      if (a.hermes_session_id) sessionsRef.current[a.id] = a.hermes_session_id;
    }
  }, [snapshot]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const runSseForAgent = useCallback(async (agent: Agent, headline: string, messageToModel: string, attachments?: string[]) => {
    const append = useUiStore.getState().appendInference;
    const appendTo = useUiStore.getState().appendToInference;
    let sid = agent.hermes_session_id ?? sessionsRef.current[agent.id];
    if (!sid) {
      const created = await gameApi.createHermesSession(agent.profile);
      sid = created.session_id;
      sessionsRef.current[agent.id] = sid;
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
    useUiStore.getState().beginCenterAgentThinking(agent.id);
    try {
      await gameApi.streamChatSse(
        messageToModel,
        sid,
        (chunk, done, fullText) => {
          if (done) {
            const fromDone = fullText != null && fullText !== '' ? fullText : '';
            // Hermes `done` 里持久化的 assistant 常会去掉 @/invoke 转交，不能用来覆盖流式 acc，否则无法解析同伴转交
            acc = gameApi.mergeAssistantTextForOrchestration(acc, fromDone || null);
            const finalized = acc;
            if (finalized) {
              const id = replyEntryId ?? ensureReplyEntry();
              const cur = useUiStore.getState().inferenceLog.find((e) => e.id === id);
              if (cur && cur.body.length === 0) {
                appendTo(id, finalized);
              }
            }
            return;
          }
          if (chunk) {
            appendTo(ensureReplyEntry(), chunk);
            acc += chunk;
          }
        },
        undefined,
        {
          bungalowAgentId: agent.id,
          onHermesSessionId: (id) => {
            if (id) {
              sessionsRef.current[agent.id] = id;
              latestSid = id;
            }
          },
          onStreamId: (streamId) => {
            useUiStore.getState().setAgentStream(agent.id, streamId);
          },
          attachments,
          onClarifyRequest: (p) =>
            new Promise<string>((resolve) => {
              flushSync(() => {
                setClarifyOther('');
                setClarifyPrompt({ ...p, resolve });
              });
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
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    const finalizeRound = useUiStore.getState().finalizeInferenceRound;

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
      const selfSet = new Set(
        [fromAgent.id, fromAgent.profile ?? '', fromAgent.name].filter(Boolean) as string[],
      );
      for (const iv of invokeList) {
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
        const msg = buildHandoffPeerUserMessage(snapshot, invokerFullReply, iv.message);
        try {
          const { text: reply } = await runSseForAgent(peer, agentReplyHeadline(peer), msg);
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
    };

    const relayM = text.match(/^\/relay\s+(\S+)\s*\|\s*([\s\S]+)$/i);
    const atRelayM = relayM ? null : text.match(/^@(\S+)\s*[|｜]\s*([\s\S]+)$/);
    if (relayM || atRelayM) {
      const token = String(relayM?.[1] ?? atRelayM?.[1] ?? '').trim();
      const sub = String(relayM?.[2] ?? atRelayM?.[2] ?? '').trim();
      if (!sub) {
        setToast('转发内容不能为空（`/relay 目标 | 消息` 或 `@目标 | 消息`）');
        return;
      }
      const append = useUiStore.getState().appendInference;
      const peer = resolveAgent(snapshot, token);
      if (peer && useUiStore.getState().agentStreamIds[peer.id]) {
        setToast(`${peer.name} 正在推理中，请稍后再试或切换到其他 Agent`);
        return;
      }
      const relayRoundUserIdx = useUiStore.getState().inferenceLog.length;
      append({
        variant: 'user',
        headline: '你 · 手动转发',
        body: relayM ? `/relay ${token} | ${sub}` : `@${token} | ${sub}`,
        agentId: selectedAgent?.id ?? peer?.id ?? null,
      });
      if (!peer) {
        append({
          variant: 'error',
          headline: '系统',
          body: `未找到目标「${token}」。请使用当前存档里 Agent 的 id、profile 或姓名。`,
          agentId: selectedAgent?.id ?? null,
        });
        finalizeRound(relayRoundUserIdx);
        setInput('');
        return;
      }
      try {
        const { text: relayAcc } = await runSseForAgent(
          peer,
          agentReplyHeadline(peer),
          withPeerHintForMessage(snapshot, sub),
        );
        const relayInvokes = gameApi.parseHermesBungalowInvokes(relayAcc);
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
        setInput('');
      }
      return;
    }

    if (!selectedAgent) {
      setToast(
        '请先在顶部选一个 Agent 作为本轮对话入口（各 Agent 独立会话、地位对等）；点名另一名请用 `/relay id或profile或姓名 | 消息` 或 `@id或profile或姓名 | 消息`',
      );
      return;
    }
    const append = useUiStore.getState().appendInference;

    if (useUiStore.getState().agentStreamIds[selectedAgent.id]) {
      setToast(`${selectedAgent.name} 正在推理中，请稍候或点击「停止」`);
      return;
    }

    const mainRoundUserIdx = useUiStore.getState().inferenceLog.length;
    append({ variant: 'user', headline: '你', body: text, agentId: selectedAgent.id });
    try {
      // Ensure session exists before uploading images
      let sid = sessionsRef.current[selectedAgent.id] ?? '';
      if (!sid && pendingImages.length > 0) {
        sid = (await gameApi.createHermesSession(selectedAgent.profile)).session_id;
        sessionsRef.current[selectedAgent.id] = sid;
      }

      // Upload pending images
      let attachments: string[] = [];
      if (pendingImages.length > 0) {
        const uploadResults = await Promise.all(
          pendingImages.map((f) =>
            gameApi.uploadImage(f, sid).catch((err) => {
              setToast(`图片上传失败: ${(err as Error).message}`);
              return null;
            }),
          ),
        );
        const succeeded = uploadResults.filter((r): r is { filename: string; path: string; size: number } => r !== null);
        attachments = succeeded.map((r) => r.path);
        if (succeeded.length < pendingImages.length) {
          setToast(`图片上传部分失败（${succeeded.length}/${pendingImages.length}）`);
        }
      }

      const peerHint =
        snapshot && snapshot.agents.length > 1
          ? gameApi.buildPeerInvokeHint(
              snapshot.agents.map((a) => ({ name: a.name, profile: a.profile, id: a.id })),
            )
          : '';
      const messageToModel = peerHint + text;

      const { text: acc } = await runSseForAgent(selectedAgent, agentReplyHeadline(selectedAgent), messageToModel, attachments);

      const invokes = gameApi.parseHermesBungalowInvokes(acc);
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
      setInput('');
      setPendingImages([]);
    }
  }, [input, loadState, pendingImages, runSseForAgent, selectedAgent, snapshot]);

  const openMenu = (key: string, el: HTMLElement) => {
    if (openMenuKey === key) {
      setOpenMenuKey(null);
      setMenuAnchor(null);
    } else {
      setOpenMenuKey(key);
      setMenuAnchor(el.getBoundingClientRect());
    }
  };

  const activeMenu = MAIN_MENUS.find((m) => m.key === openMenuKey) ?? null;

  const onMenuItemClick = (menuKey: string, itemId: string) => {
    if (itemId === 'showNewTask') setNewTaskOpen(true);
    else if (itemId === 'showAddAgent') setAddAgentOpen(true);
    else if (itemId === 'showAbout') window.alert('Hermes 数字工作室 — 原型对齐版');
    else if (itemId === 'showDevGateway') setToast(`Gateway: ${gatewayStatus}`);
    else if (itemId === 'showEventLog') setToast('事件日志在右侧面板');
    else if (itemId === 'showAgentList' || itemId === 'showTaskList') setToast('请在左/右栏查看列表');
    else window.alert(`占位: ${menuKey} / ${itemId}`);
  };

  const onQuickAssign = () => {
    if (selectedTaskId == null || !selectedAgentId) {
      setToast('请先选中右侧一个任务和左侧一个 Agent');
      return;
    }
    void assignTask(selectedTaskId, selectedAgentId).then(() => loadState());
  };

  const onCreateTask = async () => {
    try {
      await gameApi.postCreateTask({
        name: newTaskName.trim() || '新任务',
        required_profession: newTaskProf,
        difficulty: 2,
        reward: 100,
      });
      setNewTaskOpen(false);
      void loadState();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

  const selectedName = selectedAgent?.name;

  return (
    <>
      <footer style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-end', gap: 5, flexShrink: 0 }}>
          {MAIN_MENUS.map((m) => {
            const isOpen = openMenuKey === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={(e) => openMenu(m.key, e.currentTarget)}
                style={{
                  width: MENU_BTN_W,
                  height: 34,
                  padding: 0,
                  fontSize: 10,
                  background: isOpen ? '#3a4a6a' : colors.btn,
                  border: `1px solid ${isOpen ? colors.gold : colors.border}`,
                  color: isOpen ? colors.gold : colors.bright,
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {snapshot && (
          <div
            style={{
              flexShrink: 0,
              fontSize: 11,
              color: colors.text,
              display: 'flex',
              alignItems: 'center',
              alignSelf: 'flex-end',
              minHeight: FOOTER_BTN_H,
              gap: 10,
              whiteSpace: 'nowrap',
            }}
          >
            <span>
              第 {snapshot.day} 天
            </span>
            <span style={{ color: colors.gold, fontWeight: 'bold' }}>{snapshot.time}</span>
            <span style={{ color: colors.gold }}>💰 {snapshot.money}</span>
            {selectedName && <span style={{ color: colors.gold }}>对话入口: {selectedName}</span>}
          </div>
        )}

        <div
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            gap: 4,
            alignSelf: 'flex-end',
            position: 'relative',
            overflow: 'visible',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              minHeight: INPUT_ROW_H,
              flexShrink: 0,
            }}
          >
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (!files.length) return;
                setPendingImages((prev) => [...prev, ...files].slice(0, 4));
                e.target.value = '';
              }}
            />
            <button
              type="button"
              title="添加图片"
              style={{ ...footerBarBtn, flexShrink: 0 }}
              disabled={selectedAgentStreaming}
              onClick={() => imageInputRef.current?.click()}
            >
              🖼️
            </button>
            <div
              style={{
                flex: 1,
                minWidth: 120,
                height: INPUT_ROW_H,
                position: 'relative',
                overflow: 'visible',
                alignSelf: 'stretch',
              }}
            >
              <textarea
                ref={textareaRef}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  width: '100%',
                  minHeight: INPUT_ROW_H,
                  maxHeight: TEXTAREA_MAX_H,
                  resize: 'none',
                  overflowY: 'auto',
                  zIndex: 5,
                  background: '#1a1a30',
                  color: colors.bright,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  padding: '6px 10px',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  fontSize: 11,
                  lineHeight: 1.4,
                  boxSizing: 'border-box',
                  boxShadow: '0 -6px 20px rgba(0,0,0,0.35)',
                }}
                placeholder="支持 Markdown；Enter 发送，Shift+Enter 换行。`/relay 对方 | 消息` 或 `@对方 | 消息` 可点名另一名收件人"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!selectedStreamId) void send();
                  }
                }}
                onPaste={(e) => {
                  const items = Array.from(e.clipboardData.items);
                  const imageItems = items.filter((item) => item.kind === 'file' && item.type.startsWith('image/'));
                  if (!imageItems.length) return;
                  e.preventDefault();
                  imageItems.forEach((item) => {
                    const file = item.getAsFile();
                    if (file) setPendingImages((prev) => [...prev, file].slice(0, 4));
                  });
                }}
                disabled={selectedAgentStreaming}
                rows={1}
              />
            </div>
            <button
              type="button"
              style={{
                ...footerBarBtn,
                flexShrink: 0,
                color: selectedStreamId ? '#f88' : undefined,
                border: selectedStreamId ? '1px solid #a44' : undefined,
              }}
              onClick={() => (selectedStreamId ? void handleStop() : void send())}
            >
              {selectedStreamId ? '停止' : '发送'}
            </button>
          </div>

          {pendingImages.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0 0' }}>
              {pendingImages.map((f, i) => (
                <div key={i} style={{ position: 'relative', width: 48, height: 48 }}>
                  <img
                    src={URL.createObjectURL(f)}
                    alt={f.name}
                    style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 4, border: `1px solid ${colors.border}` }}
                  />
                  <button
                    type="button"
                    onClick={() => setPendingImages((prev) => prev.filter((_, idx) => idx !== i))}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 16,
                      height: 16,
                      borderRadius: '50%',
                      background: '#333',
                      border: '1px solid #555',
                      color: '#fff',
                      fontSize: 9,
                      lineHeight: 1,
                      padding: 0,
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-end', gap: 4, flexShrink: 0 }}>
          <button type="button" style={footerBarBtn} onClick={() => setNewTaskOpen(true)}>
            新建
          </button>
          <button type="button" style={footerBarBtn} onClick={onQuickAssign}>
            分配
          </button>
          <button type="button" style={footerBarBtn} onClick={() => setSkillOpen(true)}>
            技能
          </button>
        </div>
      </footer>

      <Modal
        title="推理模型需要你选择"
        open={clarifyPrompt != null}
        onClose={() => {
          if (!clarifyPrompt) return;
          const fb =
            clarifyPrompt.choices_offered[0] ||
            '请在不向用户追加提问的前提下自行判断并继续执行任务。';
          clarifyPrompt.resolve(fb);
          setClarifyPrompt(null);
          setClarifyOther('');
        }}
      >
        {clarifyPrompt && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 'min(52vh, 420px)' }}>
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: colors.bright,
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                overflowY: 'auto',
              }}
            >
              {clarifyPrompt.question}
            </p>
            {clarifyPrompt.choices_offered.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 11, color: colors.text }}>点选一项：</span>
                {clarifyPrompt.choices_offered.map((c, i) => (
                  <button
                    key={`${i}-${c.slice(0, 64)}`}
                    type="button"
                    onClick={() => {
                      clarifyPrompt.resolve(c);
                      setClarifyPrompt(null);
                      setClarifyOther('');
                    }}
                    style={{
                      textAlign: 'left',
                      fontSize: 12,
                      padding: '10px 12px',
                      background: colors.btn,
                      color: colors.bright,
                      border: `1px solid ${colors.border}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <label style={{ fontSize: 11, color: colors.text }}>或填写其他答复：</label>
            <textarea
              value={clarifyOther}
              onChange={(e) => setClarifyOther(e.target.value)}
              rows={3}
              style={{
                width: '100%',
                resize: 'vertical',
                minHeight: 64,
                boxSizing: 'border-box',
                background: '#0a0a15',
                color: colors.bright,
                border: `1px solid ${colors.border}`,
                borderRadius: 6,
                padding: 8,
                fontSize: 12,
                fontFamily: 'inherit',
              }}
            />
            <button
              type="button"
              onClick={() => {
                if (!clarifyPrompt) return;
                const t = clarifyOther.trim();
                const fb =
                  clarifyPrompt.choices_offered[0] ||
                  '请在不向用户追加提问的前提下自行判断并继续执行任务。';
                clarifyPrompt.resolve(t || fb);
                setClarifyPrompt(null);
                setClarifyOther('');
              }}
              style={{
                alignSelf: 'flex-start',
                fontSize: 12,
                padding: '8px 16px',
                background: colors.gold,
                color: '#1a1a1a',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 'bold',
              }}
            >
              提交自定义答复
            </button>
          </div>
        )}
      </Modal>

      <MenuPopup
        menu={activeMenu}
        anchor={menuAnchor}
        onClose={() => {
          setOpenMenuKey(null);
          setMenuAnchor(null);
        }}
        onItemClick={onMenuItemClick}
      />

      <Modal title="新建任务" open={newTaskOpen} onClose={() => setNewTaskOpen(false)}>
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>名称</label>
        <input
          value={newTaskName}
          onChange={(e) => setNewTaskName(e.target.value)}
          style={{ width: '100%', marginBottom: 12, padding: 8, background: '#0a0a15', color: '#fff', border: `1px solid ${colors.border}`, borderRadius: 4 }}
        />
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>职业要求</label>
        <select
          value={newTaskProf}
          onChange={(e) => setNewTaskProf(e.target.value)}
          style={{ width: '100%', marginBottom: 16, padding: 8, background: '#0a0a15', color: '#fff', border: `1px solid ${colors.border}`, borderRadius: 4 }}
        >
          {['程序员', '设计师', '测试员', '分析师'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void onCreateTask()}>
          创建
        </button>
      </Modal>

      <AddAgentModal
        open={addAgentOpen}
        snapshot={snapshot}
        onClose={() => setAddAgentOpen(false)}
        onCreated={() => void loadState()}
      />

      <Modal title="城主技能" open={skillOpen} onClose={() => setSkillOpen(false)}>
        <p style={{ color: colors.text, fontSize: 13, margin: 0 }}>占位：激励演说、灵感赐予等后续接入。</p>
      </Modal>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: layoutPx.bottomBar + 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(26,26,48,0.95)',
            border: `1px solid ${colors.gold}`,
            color: colors.bright,
            padding: '8px 16px',
            borderRadius: 8,
            zIndex: 1200,
            fontSize: 12,
            maxWidth: '80vw',
          }}
        >
          {toast}
        </div>
      )}

    </>
  );
}
