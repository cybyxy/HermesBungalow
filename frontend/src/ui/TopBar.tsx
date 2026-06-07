import { type CSSProperties, useCallback, useEffect, useState } from 'react';
import type { Agent, TaskWorldSnapshot } from '../types/game';
import { AgentAvatar } from './AgentAvatar';
import { colors, layoutPx } from './theme';

const STUDIO_NAME_KEY = 'hermes-bungalow-studio-name';

function loadStudioName(): string {
  try {
    const v = localStorage.getItem(STUDIO_NAME_KEY);
    return v || 'Hermes 数字工作室';
  } catch {
    return 'Hermes 数字工作室';
  }
}

const bar: CSSProperties = {
  height: layoutPx.topBar,
  flexShrink: 0,
  display: 'grid',
  gridTemplateColumns: '1fr auto 1fr',
  alignItems: 'center',
  padding: '0 16px',
  background: '#151525',
  borderBottom: `2px solid ${colors.border}`,
  gap: 8,
};

export function TopBar(props: {
  snapshot: TaskWorldSnapshot | null;
  gatewayStatus: string;
  loading: boolean;
  onRefresh: () => void;
  selectedAgentId: string | null;
  onOpenAgentDetail: (agentId: string) => void;
}) {
  const { snapshot, gatewayStatus, loading, onRefresh, selectedAgentId, onOpenAgentDetail } = props;
  const [studioName, setStudioName] = useState(loadStudioName);
  const [editing, setEditing] = useState(false);

  const saveStudioName = useCallback((name: string) => {
    const v = name.trim();
    if (v) {
      setStudioName(v);
      try { localStorage.setItem(STUDIO_NAME_KEY, v); } catch { /* ignore */ }
    }
    setEditing(false);
  }, []);

  // Sync across tabs
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STUDIO_NAME_KEY && e.newValue) setStudioName(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return (
    <header style={bar}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        {editing ? (
          <input
            type="text"
            defaultValue={studioName}
            onBlur={(e) => saveStudioName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') saveStudioName(e.currentTarget.value); }}
            autoFocus
            style={{
              background: '#1a1a30',
              color: colors.gold,
              border: `1px solid ${colors.gold}`,
              borderRadius: 4,
              fontSize: 16,
              fontWeight: 600,
              padding: '2px 6px',
              fontFamily: 'inherit',
              maxWidth: 280,
            }}
          />
        ) : (
          <strong
            style={{ color: colors.gold, fontSize: 16, cursor: 'pointer' }}
            onClick={() => setEditing(true)}
            title="点击修改工作室名称"
          >
            {studioName}
          </strong>
        )}
        {snapshot && (
          <span style={{ color: colors.text, fontSize: 12 }}>
            👥 {snapshot.agents.length} · 📋 {snapshot.tasks.length}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 0, overflowX: 'auto', gap: 6, padding: '0 6px' }}>
        {snapshot?.agents.map((a: Agent) => {
          const isSel = a.id === selectedAgentId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onOpenAgentDetail(a.id)}
              title={`${a.name} (${a.profession})`}
              style={{
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                borderRadius: 20,
                outline: isSel ? `2px solid ${colors.gold}` : 'none',
                outlineOffset: 2,
                flexShrink: 0,
              }}
            >
              <AgentAvatar agent={a} size={36} />
            </button>
          );
        })}
      </div>
      <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ color: '#555', fontSize: 10 }} title="开发用">GW:{gatewayStatus}</span>
        <button type="button" onClick={() => onRefresh()} disabled={loading} style={{ fontSize: 11, padding: '6px 10px' }}>
          {loading ? '…' : '刷新'}
        </button>
      </div>
    </header>
  );
}
