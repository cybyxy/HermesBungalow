import { useState } from 'react';
import { Modal } from './Modal';
import { colors } from './theme';
import { useUiStore } from '../store/uiStore';

export function ClarifyModal() {
  const clarifyPrompt = useUiStore((s) => s.clarifyPrompt);
  const setClarifyPrompt = useUiStore((s) => s.setClarifyPrompt);
  const [other, setOther] = useState('');

  if (!clarifyPrompt) return null;

  const fallback = clarifyPrompt.choices_offered[0] || '请在不向用户追加提问的前提下自行判断并继续执行任务。';

  const handleSelect = (choice: string) => {
    clarifyPrompt.resolve(choice);
    setClarifyPrompt(null);
    setOther('');
  };

  const handleSubmit = () => {
    const t = other.trim();
    clarifyPrompt.resolve(t || fallback);
    setClarifyPrompt(null);
    setOther('');
  };

  const handleClose = () => {
    // Default: use first choice (same as before — close button = reject)
    clarifyPrompt.resolve(fallback);
    setClarifyPrompt(null);
    setOther('');
  };

  return (
    <Modal
      title="推理模型需要你选择"
      zIndex={1000}
      open={true}
      onClose={handleClose}
      variant="overlay"
    >
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
                onClick={() => handleSelect(c)}
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
          value={other}
          onChange={(e) => setOther(e.target.value)}
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
          onClick={handleSubmit}
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
    </Modal>
  );
}
