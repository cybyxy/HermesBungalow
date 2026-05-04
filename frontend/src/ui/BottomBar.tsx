import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  clearCollabWalkFootOverride,
  runApproachWalkBeforePeerInvoke,
  runCollabWalkReturnToSpawn,
} from '../collab/studioCollabWalkBridge';
import * as gameApi from '../services/gameApi';
import type { ClarifySsePayload } from '../services/gameApi';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import type { Agent, GameWorldSnapshot } from '../types/game';
import { MAIN_MENUS } from './menuConfig';
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

/** 将 SSE event_type 映射为中文气泡文案（末尾不接 "..."，调用方自行追加） */
function _eventTypeToChinese(eventType: string): string {
  if (eventType === 'tool.started') return '工具使用中';
  if (eventType === 'tool.completed') return '工具已完成';
  if (eventType === 'approval.required') return '等待确认';
  if (eventType === 'reasoning.available') return '推理中';
  if (eventType === '_thinking') return '思考中';
  if (eventType === 'error') return '出错了';
  return '工具使用中';
}

/** 右侧推理与对话区：Agent 回复行标题为「名称 · 职业」。 */
function agentReplyHeadline(agent: Agent): string {
  const p = (agent.profession || '').trim();
  return p ? `${agent.name} · ${p}` : agent.name;
}

/** Prepend 同伴 @ 转交说明，使每轮（任意 Agent）都能点名其他人。 */
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
  const ctx = `\n\n──────── 同伴本轮对用户输出的正文（@ 转交行已剥离，供你衔接上下文）────────\n${gameApi.truncateHandoffContext(stripped)}\n\n──────── 对方点名要你处理的任务 ────────\n${task}`;
  return withPeerHintForMessage(snapshot, ctx);
}

function clipboardFileKey(f: File): string {
  return `${f.size}\0${f.lastModified}\0${f.name}`;
}

function hasImageMime(type: string): boolean {
  const t = (type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  return (
    t.includes('png') ||
    t.includes('jpeg') ||
    t.includes('jpg') ||
    t.includes('gif') ||
    t.includes('webp') ||
    t.includes('tiff') ||
    t.includes('heic') ||
    t === 'image/x-png' ||
    t === 'image/pjpeg'
  );
}

function fileLooksLikeImageByMeta(f: File): boolean {
  if (hasImageMime(f.type)) return true;
  if (f.name && /\.(png|jpe?g|gif|webp|bmp|tif|tiff|heic|heif)$/i.test(f.name)) return true;
  return false;
}

async function sniffImageFormat(blob: Blob): Promise<'png' | 'jpeg' | 'gif' | 'webp' | null> {
  const buf = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf.length >= 12 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50)
    return 'webp';
  return null;
}

/** 剪贴板未带 image/* MIME 时，按魔数补全类型，便于 /api/upload 与模型识别。 */
async function normalizePastedImageFile(f: File): Promise<File | null> {
  if (f.type.startsWith('image/')) return f;
  const sig = await sniffImageFormat(f);
  if (!sig) return null;
  const mime = sig === 'jpeg' ? 'image/jpeg' : `image/${sig}`;
  const ext = sig === 'jpeg' ? 'jpg' : sig;
  const base = (f.name && /\.[a-z0-9]+$/i.test(f.name) ? f.name.replace(/\.[^/.]+$/, '') : f.name) || 'paste';
  return new File([f], `${base}.${ext}`, { type: mime, lastModified: f.lastModified });
}

/** 同步可判定的图片：item / files 上已有 image/* 或扩展名。 */
function syncCollectPastedImages(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (f: File | null) => {
    if (!f || f.size < 16) return;
    if (!fileLooksLikeImageByMeta(f)) return;
    const k = clipboardFileKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (!f) continue;
    if (!hasImageMime(item.type || '') && !fileLooksLikeImageByMeta(f)) continue;
    add(f);
  }
  for (const f of Array.from(dt.files ?? [])) {
    add(f);
  }
  return out;
}

/** 疑似截图：无 MIME/无文件名，需异步读魔数（避免误把非图文件当图）。 */
function ambiguousPastedImageBlobs(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (f: File | null) => {
    if (!f || f.size < 32) return;
    if (fileLooksLikeImageByMeta(f)) return;
    const t = (f.type || '').trim();
    const name = (f.name || '').trim();
    if (t !== '' && t !== 'application/octet-stream') return;
    if (name && !/^image\.(png|jpe?g|gif|webp)$/i.test(name) && name.includes('.')) return;
    const k = clipboardFileKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const it = item.type || '';
    if (hasImageMime(it)) continue;
    add(item.getAsFile());
  }
  for (const f of Array.from(dt.files ?? [])) {
    add(f);
  }
  return out.slice(0, 4);
}

/** Phaser 画布等会抢走焦点，paste 到不到底栏 textarea；焦点不在其它表单控件时由全局捕获把图片交给会话输入。 */
function shouldDelegatePasteToFocusedField(target: EventTarget | null, chatTextarea: HTMLTextAreaElement | null): boolean {
  if (!(target instanceof Element)) return false;
  if (chatTextarea && (target === chatTextarea || chatTextarea.contains(target))) return true;
  const field = target.closest(
    'textarea, select, [contenteditable="true"], input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="password"], input[type="tel"], input[type="number"], input:not([type])',
  );
  if (field) return true;
  return Boolean(target.closest('input[type="file"]'));
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
  const bottomSheet = useUiStore((s) => s.bottomSheet);
  const openBottomSheet = useUiStore((s) => s.openBottomSheet);
  const closeBottomSheet = useUiStore((s) => s.closeBottomSheet);

  const agentStreamIds = useUiStore((s) => s.agentStreamIds);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  /** 与 pendingImages 同步的 object URL，发送清空 pending 时一并 revoke，避免缩略图残留。 */
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
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
  const [toast, setToast] = useState<string | null>(null);

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

  useLayoutEffect(() => {
    const urls = pendingImages.map((f) => URL.createObjectURL(f));
    setThumbUrls(urls);
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [pendingImages]);

  /** 焦点在游戏区等时，把剪贴板/拖放里的图片并入底栏待发送列表（与 textarea onPaste 逻辑对齐）。 */
  useEffect(() => {
    const chatStreaming = () => {
      const aid = useUiStore.getState().selectedAgentId;
      return Boolean(aid && useUiStore.getState().agentStreamIds[aid]);
    };

    const onPasteCapture = (e: ClipboardEvent) => {
      if (chatStreaming()) return;
      if (shouldDelegatePasteToFocusedField(e.target, textareaRef.current)) return;
      const dt = e.clipboardData;
      if (!dt) return;
      const sync = syncCollectPastedImages(dt);
      if (sync.length) {
        e.preventDefault();
        e.stopPropagation();
        setPendingImages((prev) => [...prev, ...sync].slice(0, 4));
        queueMicrotask(() => textareaRef.current?.focus());
        return;
      }
      const amb = ambiguousPastedImageBlobs(dt);
      if (!amb.length) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const ok: File[] = [];
        for (const f of amb) {
          const n = await normalizePastedImageFile(f);
          if (n) ok.push(n);
        }
        if (ok.length) {
          setPendingImages((prev) => [...prev, ...ok].slice(0, 4));
          queueMicrotask(() => textareaRef.current?.focus());
        }
      })();
    };

    const onDragOverCapture = (e: DragEvent) => {
      if (chatStreaming()) return;
      if (shouldDelegatePasteToFocusedField(e.target, textareaRef.current)) return;
      const types = e.dataTransfer?.types ?? [];
      if (![...types].includes('Files')) return;
      e.preventDefault();
    };

    const onDropCapture = (e: DragEvent) => {
      if (chatStreaming()) return;
      if (shouldDelegatePasteToFocusedField(e.target, textareaRef.current)) return;
      const fl = e.dataTransfer?.files;
      if (!fl?.length) return;
      const imgs = Array.from(fl).filter((f) => hasImageMime(f.type) || fileLooksLikeImageByMeta(f));
      if (!imgs.length) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingImages((prev) => [...prev, ...imgs].slice(0, 4));
      queueMicrotask(() => textareaRef.current?.focus());
    };

    document.addEventListener('paste', onPasteCapture, true);
    document.addEventListener('dragover', onDragOverCapture, true);
    document.addEventListener('drop', onDropCapture, true);
    return () => {
      document.removeEventListener('paste', onPasteCapture, true);
      document.removeEventListener('dragover', onDragOverCapture, true);
      document.removeEventListener('drop', onDropCapture, true);
    };
  }, []);

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
    let mergeReasoningId: string | null = null;
    useUiStore.getState().beginCenterAgentThinking(agent.id);
    try {
      await gameApi.streamChatSse(
        messageToModel,
        sid,
        (chunk, done, fullText, doneMeta) => {
          if (done) {
            const fromDone = fullText != null && fullText !== '' ? fullText : '';
            // Hermes `done` 里持久化的 assistant 常会去掉 @/invoke 转交，不能用来覆盖流式 acc，否则无法解析同伴转交
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
            // tool_complete 后保持 tool 状态，气泡显示 "xxx 完成..."，等下一个事件（thinking/tool）再更新
            useUiStore.getState().setCenterAgentTool(agent.id, doneText);
          }
        },
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
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text && pendingImages.length === 0) {
      setToast('请输入内容或添加图片');
      return;
    }
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
        const peer = gameApi.resolveGameAgent(snapshot?.agents, iv.target);
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
      await runCollabWalkReturnToSpawn(fromAgent.id);
    };

    const handoff = gameApi.parseUserHandoffPrefix(text);
    if (handoff) {
      const { token, message: sub } = handoff;
      if (!sub) {
        setToast(
          '转发内容不能为空。请使用：`@对方 profile/id/姓名/显示名 | 要说的话` 或 `@对方 要说的话`；群发：`@所有人 | …` 或 `@所有人 …`（竖线可用全角｜）',
        );
        setPendingImages([]);
        return;
      }
      const append = useUiStore.getState().appendInference;

      if (gameApi.isBroadcastAllHandoffToken(token)) {
        if (!selectedAgent) {
          setToast('请先在顶部选一个 Agent，再发 `@所有人 | …`（由当前 Agent 群发至其余同伴）');
          setPendingImages([]);
          return;
        }
        if (!snapshot || snapshot.agents.length < 2) {
          setToast('至少需要两名 Agent 才能使用 `@所有人`');
          setPendingImages([]);
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
          setInput('');
          setPendingImages([]);
        }
        return;
      }

      const peer = gameApi.resolveGameAgent(snapshot?.agents, token);
      if (peer && useUiStore.getState().agentStreamIds[peer.id]) {
        setToast(`${peer.name} 正在推理中，请稍后再试或切换到其他 Agent`);
        setPendingImages([]);
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
        setInput('');
        setPendingImages([]);
        return;
      }
      try {
        const { text: relayAcc } = await runSseForAgent(
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
        setInput('');
        setPendingImages([]);
      }
      return;
    }

    if (!selectedAgent) {
      setToast(
        '请先在顶部选一个 Agent 作为本轮对话入口（各 Agent 独立会话、地位对等）；点名另一名请单独发：`@对方的 profile / id / 姓名 / 显示名 | 消息`（竖线可用全角｜）',
      );
      setPendingImages([]);
      return;
    }
    const append = useUiStore.getState().appendInference;

    if (useUiStore.getState().agentStreamIds[selectedAgent.id]) {
      setToast(`${selectedAgent.name} 正在推理中，请稍候或点击「停止」`);
      setPendingImages([]);
      return;
    }

    const mainRoundUserIdx = useUiStore.getState().inferenceLog.length;
    const pendingCount = pendingImages.length;
    const pendingFilesSnapshot = [...pendingImages];
    setPendingImages([]);
    append({
      variant: 'user',
      headline: '你',
      body: text || `（已附加 ${pendingCount} 张图片）`,
      agentId: selectedAgent.id,
    });
    try {
      // Ensure session exists before uploading images
      let sid = sessionsRef.current[selectedAgent.id] ?? '';
      if (!sid && pendingFilesSnapshot.length > 0) {
        sid = (await gameApi.createHermesSession(selectedAgent.profile)).session_id;
        sessionsRef.current[selectedAgent.id] = sid;
      }

      // Upload pending images
      let attachments: string[] = [];
      if (pendingFilesSnapshot.length > 0) {
        const uploadResults = await Promise.all(
          pendingFilesSnapshot.map((f) =>
            gameApi.uploadImage(f, sid).catch((err) => {
              setToast(`图片上传失败: ${(err as Error).message}`);
              return null;
            }),
          ),
        );
        const succeeded = uploadResults.filter((r): r is { filename: string; path: string; size: number } => r !== null);
        attachments = succeeded.map((r) => r.path);
        if (succeeded.length < pendingFilesSnapshot.length) {
          setToast(`图片上传部分失败（${succeeded.length}/${pendingFilesSnapshot.length}）`);
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

      const { text: acc } = await runSseForAgent(selectedAgent, agentReplyHeadline(selectedAgent), messageToModel, attachments);

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
      setInput('');
    }
  }, [input, loadState, pendingImages, runSseForAgent, selectedAgent, snapshot]);

  const toggleMenuSheet = (key: string) => {
    if (bottomSheet.kind === 'menu' && bottomSheet.menuKey === key) {
      closeBottomSheet();
    } else {
      openBottomSheet({ kind: 'menu', menuKey: key });
    }
  };

  const onQuickAssign = () => {
    if (selectedTaskId == null || !selectedAgentId) {
      setToast('请先选中右侧一个任务和左侧一个 Agent');
      return;
    }
    void assignTask(selectedTaskId, selectedAgentId).then(() => loadState());
  };

  const selectedName = selectedAgent?.name;

  return (
    <>
      <footer style={bar}>
        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-end', gap: 5, flexShrink: 0 }}>
          {MAIN_MENUS.map((m) => {
            const isOpen = bottomSheet.kind === 'menu' && bottomSheet.menuKey === m.key;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => toggleMenuSheet(m.key)}
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
                placeholder="Markdown；Enter 发送。点名：`@对方profile或id或姓名|消息`；群发：`@所有人|同一消息`（全角｜亦可）"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    if (!selectedStreamId) void send();
                  }
                }}
                onPaste={(e) => {
                  const dt = e.clipboardData;
                  if (!dt) return;
                  const el = e.currentTarget;

                  const sync = syncCollectPastedImages(dt);
                  if (sync.length) {
                    e.preventDefault();
                    setPendingImages((prev) => [...prev, ...sync].slice(0, 4));
                    return;
                  }

                  const amb = ambiguousPastedImageBlobs(dt);
                  if (!amb.length) return;

                  e.preventDefault();
                  const start = el.selectionStart ?? 0;
                  const end = el.selectionEnd ?? start;

                  void (async () => {
                    const ok: File[] = [];
                    for (const f of amb) {
                      const n = await normalizePastedImageFile(f);
                      if (n) ok.push(n);
                    }
                    if (ok.length) {
                      setPendingImages((prev) => [...prev, ...ok].slice(0, 4));
                      return;
                    }
                    const t = dt.getData('text/plain');
                    if (!t) return;
                    setInput((prev) => prev.slice(0, start) + t + prev.slice(end));
                    queueMicrotask(() => {
                      el.setSelectionRange(start + t.length, start + t.length);
                    });
                  })();
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

          {thumbUrls.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 0 0' }}>
              {thumbUrls.map((url, i) => (
                <div key={url} style={{ position: 'relative', width: 48, height: 48 }}>
                  <img
                    src={url}
                    alt=""
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
          <button type="button" style={footerBarBtn} onClick={() => openBottomSheet({ kind: 'newTask' })}>
            新建
          </button>
          <button type="button" style={footerBarBtn} onClick={onQuickAssign}>
            分配
          </button>
          <button type="button" style={footerBarBtn} onClick={() => openBottomSheet({ kind: 'skills' })}>
            技能
          </button>
        </div>
      </footer>

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
