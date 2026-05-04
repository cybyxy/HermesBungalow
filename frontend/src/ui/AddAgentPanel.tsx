import { useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import * as gameApi from '../services/gameApi';
import type { GameWorldSnapshot } from '../types/game';
import { colors } from './theme';

type AddAgentTab = 'basic' | 'config';

const DEFAULT_SOUL = `你是Hermes数字工作室的一员。
性格特点：热情、乐于助人
口头禅："一起加油吧！"
行为准则：主动帮助同事，积极参与团队协作`;

const DEFAULT_MEMORY = `## 重要经历
- 2024年加入Hermes数字工作室
- 完成了多个重要项目

## 技能特长
- 熟练掌握多种编程语言
- 良好的沟通能力`;

const professionSuggestions = ['程序员', '设计师', '测试员', '分析师', '产品经理', '运维工程师'];

export function AddAgentPanel(props: {
  snapshot: GameWorldSnapshot | null;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const { snapshot, onCancel, onCreated } = props;
  const [tab, setTab] = useState<AddAgentTab>('basic');
  const [name, setName] = useState('');
  const [profession, setProfession] = useState('程序员');
  const [gender, setGender] = useState('random');
  const [room, setRoom] = useState('');
  const [catchphrase, setCatchphrase] = useState('');
  const [soul, setSoul] = useState(DEFAULT_SOUL);
  const [memory, setMemory] = useState(DEFAULT_MEMORY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roomOptions = useMemo(() => snapshot?.rooms.map((r) => r.name) ?? [], [snapshot]);

  const exportMemory = () => {
    const blob = new Blob([memory], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'memory.md';
    a.click();
    URL.revokeObjectURL(url);
  };

  const slugifyProfileName = (v: string): string => {
    const s = v
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^[-_]+|[-_]+$/g, '');
    const safe = s || `agent-${Date.now().toString().slice(-6)}`;
    return /^[a-z0-9]/.test(safe) ? safe.slice(0, 64) : `a-${safe}`.slice(0, 64);
  };

  const submit = async () => {
    const n = name.trim();
    const p = profession.trim();
    if (!n || !p) {
      setError('请填写必填项：Agent名称、职业类型');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const profileName = slugifyProfileName(n);
      await gameApi.postCreateHermesProfileAgent({
        name: n,
        profile_name: profileName,
        gender: gender,
        soul: [soul.trim(), catchphrase.trim() ? `\n\n口头禅：${catchphrase.trim()}` : ''].join(''),
        memory: memory.trim(),
      });
      onCancel();
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ color: '#666', fontSize: 11, marginBottom: 10 }}>通过配置 Agent 基础信息与核心文件进行创建</div>

      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 12 }}>
        {[
          { k: 'basic' as const, label: '📋 基本信息' },
          { k: 'config' as const, label: '📄 核心文件' },
        ].map((it) => {
          const active = tab === it.k;
          return (
            <button
              key={it.k}
              type="button"
              onClick={() => setTab(it.k)}
              style={{
                padding: '8px 12px',
                border: 'none',
                background: active ? '#1a1a30' : 'transparent',
                color: active ? colors.gold : '#888',
                borderBottom: active ? `2px solid ${colors.gold}` : '2px solid transparent',
                cursor: 'pointer',
                fontSize: 11,
                fontFamily: 'inherit',
              }}
            >
              {it.label}
            </button>
          );
        })}
      </div>

      {tab === 'basic' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Agent名称 *">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="输入Agent名称" style={inputStyle} />
            </Field>
            <Field label="职业类型 *">
              <input value={profession} onChange={(e) => setProfession(e.target.value)} list="profession-list-add" placeholder="输入或选择职业" style={inputStyle} />
              <datalist id="profession-list-add">
                {professionSuggestions.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
            </Field>
            <Field label="性别">
              <select value={gender} onChange={(e) => setGender(e.target.value)} style={inputStyle}>
                <option value="random">随机</option>
                <option value="male">男</option>
                <option value="female">女</option>
              </select>
            </Field>
            <Field label="默认工作房间">
              <select value={room} onChange={(e) => setRoom(e.target.value)} style={inputStyle}>
                <option value="">不指定</option>
                {roomOptions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="口头禅">
            <input value={catchphrase} onChange={(e) => setCatchphrase(e.target.value)} placeholder="输入Agent口头禅" style={inputStyle} />
          </Field>
        </>
      )}

      {tab === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Field label="soul.md" rightAction={<button type="button" onClick={() => setSoul(DEFAULT_SOUL)} style={miniBtn}>重置</button>}>
            <textarea value={soul} onChange={(e) => setSoul(e.target.value)} rows={10} style={textareaStyle} />
          </Field>
          <Field label="memory.md" rightAction={<button type="button" onClick={exportMemory} style={miniBtn}>导出</button>}>
            <textarea value={memory} onChange={(e) => setMemory(e.target.value)} rows={10} style={textareaStyle} />
          </Field>
        </div>
      )}

      {error && <div style={{ color: '#ff6b6b', marginTop: 10, fontSize: 12 }}>{error}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
        <button type="button" onClick={onCancel} style={ghostBtn} disabled={busy}>
          取消
        </button>
        <button type="button" onClick={() => void submit()} style={primaryBtn} disabled={busy}>
          {busy ? '添加中…' : '添加'}
        </button>
      </div>
    </div>
  );
}

function Field(props: { label: string; children: ReactNode; rightAction?: ReactNode }) {
  const { label, children, rightAction } = props;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{ color: '#aaa', fontSize: 11 }}>{label}</label>
        {rightAction}
      </div>
      {children}
    </div>
  );
}

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  background: '#0a0a15',
  border: '1px solid #333',
  borderRadius: 4,
  color: '#fff',
  fontFamily: 'inherit',
  fontSize: 12,
  boxSizing: 'border-box',
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 160,
  resize: 'vertical',
};

const miniBtn: CSSProperties = {
  background: '#333',
  color: '#888',
  border: 'none',
  padding: '2px 8px',
  borderRadius: 3,
  fontSize: 10,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const ghostBtn: CSSProperties = {
  ...inputStyle,
  width: 'auto',
  padding: '8px 14px',
  background: '#2a3a5a',
  color: '#ccc',
  cursor: 'pointer',
};

const primaryBtn: CSSProperties = {
  ...inputStyle,
  width: 'auto',
  padding: '8px 14px',
  background: '#2a5a2a',
  borderColor: '#3a7a3a',
  color: '#fff',
  cursor: 'pointer',
};
