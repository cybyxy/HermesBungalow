import { useEffect, useState } from 'react';
import { InferenceMarkdownBody, inferenceMono } from './inferenceMarkdown';
import { colors } from './theme';

const paneBase = {
  minHeight: 100,
  maxHeight: 280,
  borderRadius: 6,
  border: `1px solid ${colors.border}`,
  background: 'rgba(0,0,0,0.25)',
  boxSizing: 'border-box' as const,
};

/** 分栏 Markdown：可编辑源码 + 实时预览（与推理区 Markdown 样式一致）。 */
export function MarkdownWorkspace(props: { body: string }) {
  const [draft, setDraft] = useState(props.body);

  useEffect(() => {
    setDraft(props.body);
  }, [props.body]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        width: '100%',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 9, color: '#6a7588', userSelect: 'none' }}>Markdown · 可编辑 · 右侧预览</div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 8,
          minWidth: 0,
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          style={{
            ...paneBase,
            flex: '1 1 160px',
            minWidth: 0,
            padding: 8,
            color: '#d8e4f0',
            fontFamily: inferenceMono,
            fontSize: 10,
            lineHeight: 1.45,
            resize: 'vertical',
            outline: 'none',
          }}
        />
        <div
          style={{
            ...paneBase,
            flex: '1 1 160px',
            minWidth: 0,
            padding: '6px 8px',
            overflow: 'auto',
          }}
        >
          <InferenceMarkdownBody body={draft} />
        </div>
      </div>
    </div>
  );
}
