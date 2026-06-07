import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { stopStudioChat, submitStudioChat } from '../chat/studioChatActions';
import * as gameApi from '../services/gameApi';
import { useTaskStore } from '../store/taskStore';
import { useUiStore, type DockedPanelKind } from '../store/uiStore';
import type { TaskWorldSnapshot } from '../types/game';
import { MAIN_MENUS } from './menuConfig';
import { colors, layoutPx } from './theme';
import {
  MENU_BTN_W,
  FOOTER_BTN_H,
  footerBarBtn,
  shouldDelegatePasteToFocusedField,
  syncCollectPastedImages,
  ambiguousPastedImageBlobs,
  normalizePastedImageFile,
  hasImageMime,
  fileLooksLikeImageByMeta,
} from './bottomBarUtils';
import { BottomBarInputArea } from './BottomBarInputArea';

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

export function BottomBar(props: { snapshot: TaskWorldSnapshot | null; gatewayStatus: string }) {
  const { snapshot, gatewayStatus } = props;
  const loadState = useTaskStore((s) => s.loadState);
  const assignTask = useTaskStore((s) => s.assignTask);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const dockedPanel = useUiStore((s) => s.dockedPanel);
  const setDockedPanel = useUiStore((s) => s.setDockedPanel);
  const closeDockedPanel = useUiStore((s) => s.closeDockedPanel);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);

  const agentStreamIds = useUiStore((s) => s.agentStreamIds);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  /** 与 pendingImages 同步的 object URL，发送清空 pending 时一并 revoke，避免缩略图残留。 */
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const urls = pendingImages.map((f) => URL.createObjectURL(f));
    setThumbUrls(urls);
    return () => {
      for (const u of urls) URL.revokeObjectURL(u);
    };
  }, [pendingImages]);

  const agentInferState = useUiStore((s) => s.agentInferState);
  const selectedStreamId =
    selectedAgentId && agentStreamIds[selectedAgentId] ? agentStreamIds[selectedAgentId] : null;
  const selectedOrchestrating = Boolean(
    selectedAgentId && agentInferState[selectedAgentId]?.phase === 'thinking' && !selectedStreamId,
  );
  const multiRoundSessionId = useUiStore((s) => s.multiRoundSessionId);
  const multiRoundCount = useUiStore((s) => s.multiRoundCount);
  const setMultiRoundSession = useUiStore((s) => s.setMultiRoundSession);
  const inputBlocked = Boolean(selectedStreamId || selectedOrchestrating);

  const handleStop = useCallback(async () => {
    if (multiRoundSessionId) {
      try {
        await gameApi.postMultiRoundStop({ session_id: multiRoundSessionId });
      } catch {
        /* ignore */
      }
      setMultiRoundSession(null);
    }
    await stopStudioChat();
  }, [multiRoundSessionId, setMultiRoundSession]);

  const handleFinishDiscussion = useCallback(async () => {
    if (multiRoundSessionId) {
      try {
        await gameApi.postMultiRoundStop({ session_id: multiRoundSessionId });
      } catch {
        /* ignore */
      }
      setMultiRoundSession(null);
    }
  }, [multiRoundSessionId, setMultiRoundSession]);

  const [toast, setToast] = useState<string | null>(null);

  const selectedAgent = snapshot?.agents.find((a) => a.id === selectedAgentId) ?? null;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  /** 焦点在游戏区等时，把剪贴板/拖放里的图片并入底栏待发送列表（与 textarea onPaste 逻辑对齐）。 */
  useEffect(() => {
    const chatStreaming = () => {
      const st = useUiStore.getState();
      const aid = st.selectedAgentId;
      if (!aid) return false;
      if (st.agentStreamIds[aid]) return true;
      return st.agentInferState[aid]?.phase === 'thinking';
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

  const send = useCallback(async () => {
    const msg = input.trim();
    if (!msg) return;
    await submitStudioChat({
      text: msg,
      pendingFiles: pendingImages,
      snapshot,
      onToast: (m) => setToast(m),
      clearInput: () => setInput(''),
      clearPendingFiles: () => setPendingImages([]),
    });
  }, [input, pendingImages, snapshot]);

  const MENU_TO_DOCK: Record<string, string> = {
    agent: 'agentList',
    task: 'taskList',
    models: 'modelList',
    channels: 'channelList',
    social: 'social',
    event: 'event',
    help: 'help',
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
            const dockKind = MENU_TO_DOCK[m.key];
            const isOpen = dockKind ? dockedPanel.kind === dockKind : false;
            return (
              <button
                key={m.key}
                type="button"
                onClick={() => {
                  const dk = MENU_TO_DOCK[m.key];
                  if (dk) setDockedPanel({ kind: dk as DockedPanelKind });
                }}
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
            {selectedName && <span style={{ color: colors.gold }}>对话入口: {selectedName}</span>}
          </div>
        )}

        <BottomBarInputArea
          input={input}
          setInput={setInput}
          inputBlocked={inputBlocked}
          pendingImages={pendingImages}
          setPendingImages={setPendingImages}
          thumbUrls={thumbUrls}
          multiRoundSessionId={multiRoundSessionId}
          multiRoundCount={multiRoundCount}
          send={send}
          handleStop={handleStop}
          handleFinishDiscussion={handleFinishDiscussion}
          textareaRef={textareaRef}
          imageInputRef={imageInputRef}
          selectedStreamId={selectedStreamId}
          selectedOrchestrating={selectedOrchestrating}
        />

        <div style={{ display: 'flex', alignItems: 'center', alignSelf: 'flex-end', gap: 4, flexShrink: 0 }}>
          <button type="button" style={footerBarBtn} onClick={() => openFloatingWindow({ kind: 'newTask' })}>
            新建
          </button>
          <button type="button" style={footerBarBtn} onClick={onQuickAssign}>
            分配
          </button>
          <button type="button" style={footerBarBtn} onClick={() => setDockedPanel({ kind: 'skills' })}>
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
