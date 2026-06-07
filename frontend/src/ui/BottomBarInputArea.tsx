import { useCallback, useEffect, useLayoutEffect } from 'react';
import type { RefObject } from 'react';
import {
  footerBarBtn,
  INPUT_ROW_H,
  TEXTAREA_MAX_H,
  syncCollectPastedImages,
  ambiguousPastedImageBlobs,
  normalizePastedImageFile,
} from './bottomBarUtils';
import { colors } from './theme';

interface BottomBarInputAreaProps {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  inputBlocked: boolean;
  pendingImages: File[];
  setPendingImages: (value: File[] | ((prev: File[]) => File[])) => void;
  thumbUrls: string[];
  multiRoundSessionId: string | null;
  multiRoundCount: number;
  send: () => void;
  handleStop: () => void;
  handleFinishDiscussion: () => void;
  textareaRef: RefObject<HTMLTextAreaElement>;
  imageInputRef: RefObject<HTMLInputElement>;
  selectedStreamId: string | null;
  selectedOrchestrating: boolean;
}

export function BottomBarInputArea(props: BottomBarInputAreaProps) {
  const {
    input,
    setInput,
    inputBlocked,
    pendingImages,
    setPendingImages,
    thumbUrls,
    multiRoundSessionId,
    multiRoundCount,
    send,
    handleStop,
    handleFinishDiscussion,
    textareaRef,
    imageInputRef,
    selectedStreamId,
    selectedOrchestrating,
  } = props;

  const syncTextareaHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = `${INPUT_ROW_H}px`;
    const h = Math.min(TEXTAREA_MAX_H, Math.max(INPUT_ROW_H, el.scrollHeight));
    el.style.height = `${h}px`;
  }, [textareaRef]);

  useLayoutEffect(() => {
    syncTextareaHeight();
  }, [input, syncTextareaHeight]);

  useEffect(() => {
    const onResize = () => syncTextareaHeight();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [syncTextareaHeight]);

  return (
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
            placeholder={
              multiRoundSessionId
                ? `Round ${multiRoundCount + 1} — 继续讨论，输入追加消息后 Enter 发送...`
                : 'Markdown；Enter 发送。点名：`@对方profile或id或姓名|消息`；群发：`@所有人|同一消息`（全角｜亦可）'
            }
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
        {multiRoundSessionId && (
          <button
            type="button"
            style={{
              ...footerBarBtn,
              flexShrink: 0,
              color: colors.gold,
              border: `1px solid ${colors.gold}`,
              fontSize: 10,
            }}
            onClick={() => {
              void handleFinishDiscussion();
            }}
          >
            完成
          </button>
        )}
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
                style={{
                  width: 48,
                  height: 48,
                  objectFit: 'cover',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                }}
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
  );
}
