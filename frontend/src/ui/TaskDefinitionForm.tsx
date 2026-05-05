import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { colors } from './theme';

const inputBase: CSSProperties = {
  width: '100%',
  padding: 8,
  background: '#0a0a15',
  color: '#fff',
  border: `1px solid ${colors.border}`,
  borderRadius: 4,
  boxSizing: 'border-box',
  fontFamily: 'inherit',
};

const labelStyle: CSSProperties = {
  display: 'block',
  color: colors.text,
  fontSize: 12,
  marginBottom: 6,
};

export type TaskFormValue = {
  name: string;
  catalog: string;
  description: string;
  due_at: string;
  estimated_hours: number;
  deliverables: string;
  acceptance_criteria: string;
};

const DEFAULT_FORM: TaskFormValue = {
  name: '',
  catalog: '',
  description: '',
  due_at: '',
  estimated_hours: 2,
  deliverables: '',
  acceptance_criteria: '',
};

type Props = {
  /** Increment when opening sheet so fields reset */
  resetKey: number;
  submitLabel?: string;
  onSubmit: (v: TaskFormValue) => Promise<void>;
};

export function TaskDefinitionForm({ resetKey, submitLabel = '创建', onSubmit }: Props) {
  const [v, setV] = useState<TaskFormValue>(DEFAULT_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setV({ ...DEFAULT_FORM });
    setErr(null);
  }, [resetKey]);

  const patch = useCallback((p: Partial<TaskFormValue>) => {
    setV((prev) => ({ ...prev, ...p }));
  }, []);

  const handleSubmit = async () => {
    setErr(null);
    const name = v.name.trim();
    if (!name) {
      setErr('请填写任务标题');
      return;
    }
    setBusy(true);
    try {
      await onSubmit({ ...v, name });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxHeight: '70vh', overflowY: 'auto', paddingRight: 4 }}>
      {err && (
        <div style={{ color: '#f88', fontSize: 12, marginBottom: 10 }}>{err}</div>
      )}
      <label style={labelStyle}>标题</label>
      <input
        value={v.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="任务名称"
        style={{ ...inputBase, marginBottom: 12 }}
      />

      <label style={labelStyle}>任务目录</label>
      <input
        value={v.catalog}
        onChange={(e) => patch({ catalog: e.target.value })}
        placeholder="如 产品/需求、研发/后端、2025Q1"
        style={{ ...inputBase, marginBottom: 12 }}
      />

      <label style={labelStyle}>目标 / 背景</label>
      <textarea
        value={v.description}
        onChange={(e) => patch({ description: e.target.value })}
        rows={3}
        placeholder="要解决什么问题、范围与约束"
        style={{ ...inputBase, marginBottom: 12, resize: 'vertical', minHeight: 56 }}
      />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <div>
          <label style={labelStyle}>完成日期</label>
          <input
            type="date"
            value={v.due_at}
            onChange={(e) => patch({ due_at: e.target.value })}
            style={inputBase}
          />
        </div>
        <div>
          <label style={labelStyle}>预计工时（小时）</label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={Number.isFinite(v.estimated_hours) ? v.estimated_hours : 0}
            onChange={(e) => patch({ estimated_hours: parseFloat(e.target.value) || 0 })}
            style={inputBase}
          />
        </div>
      </div>

      <label style={labelStyle}>产物（可多行）</label>
      <textarea
        value={v.deliverables}
        onChange={(e) => patch({ deliverables: e.target.value })}
        rows={2}
        placeholder="交付物类型、数量、格式等"
        style={{ ...inputBase, marginBottom: 12, resize: 'vertical' }}
      />

      <label style={labelStyle}>验收标准</label>
      <textarea
        value={v.acceptance_criteria}
        onChange={(e) => patch({ acceptance_criteria: e.target.value })}
        rows={2}
        placeholder="怎样算完成"
        style={{ ...inputBase, marginBottom: 12, resize: 'vertical' }}
      />

      <button type="button" disabled={busy} onClick={() => void handleSubmit()} style={{ marginTop: 8 }}>
        {busy ? '提交中…' : submitLabel}
      </button>
    </div>
  );
}
