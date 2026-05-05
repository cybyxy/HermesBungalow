import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { stopStudioChat, submitStudioChat } from '../chat/studioChatActions';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import type { GameWorldSnapshot } from '../types/game';
import { MAIN_MENUS } from './menuConfig';
import { colors, layoutPx } from './theme';

const MENU_BTN_W = 70;
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

/** 剪贴板未带 image/* MIME 时，按魔数补全类型，便于走游戏上传接口与模型识别。 */
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
  const openNewTaskModal = useUiStore((s) => s.openNewTaskModal);
  const closeBottomSheet = useUiStore((s) => s.closeBottomSheet);

  const agentStreamIds = useUiStore((s) => s.agentStreamIds);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  /** 与 pendingImages 同步的 object URL，发送清空 pending 时一并 revoke，避免缩略图残留。 */
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const agentInferState = useUiStore((s) => s.agentInferState);
  const selectedStreamId =
    selectedAgentId && agentStreamIds[selectedAgentId] ? agentStreamIds[selectedAgentId] : null;
  const selectedOrchestrating = Boolean(
    selectedAgentId && agentInferState[selectedAgentId]?.phase === 'thinking' && !selectedStreamId,
  );
  const inputBlocked = Boolean(selectedStreamId || selectedOrchestrating);

  const handleStop = useCallback(async () => {
    await stopStudioChat();
  }, []);
  const [toast, setToast] = useState<string | null>(null);

  const selectedAgent = snapshot?.agents.find((a) => a.id === selectedAgentId) ?? null;

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
    await submitStudioChat({
      text: input,
      pendingFiles: pendingImages,
      snapshot,
      onToast: (msg) => setToast(msg),
      clearInput: () => setInput(''),
      clearPendingFiles: () => setPendingImages([]),
    });
  }, [input, pendingImages, snapshot]);

  const toggleMenuSheet = (key: string) => {
    if (bottomSheet.kind === 'menu' && bottomSheet.menuKey === key) {
      closeBottomSheet();
    } else {
      openBottomSheet({ kind: 'menu', menuKey: key });
    }
  };

  const onQuickAssign = () => {
    if (selectedTaskId == null || !selectedAgentId) {
      setToast('请在左侧栏「工作室任务」中选一条任务，并在场景中选中一名 Agent');
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
              disabled={inputBlocked}
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
                    if (!inputBlocked) void send();
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
                disabled={inputBlocked}
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
                opacity: selectedOrchestrating ? 0.55 : undefined,
              }}
              onClick={() => {
                if (selectedStreamId) void handleStop();
                else if (!selectedOrchestrating) void send();
              }}
            >
              {selectedStreamId ? '停止' : selectedOrchestrating ? '…' : '发送'}
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
          <button type="button" style={footerBarBtn} onClick={() => openNewTaskModal()}>
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
