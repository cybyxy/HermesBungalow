import type { CSSProperties } from 'react';
import type { Agent, GameWorldSnapshot } from '../types/game';
import { AgentAvatar } from './AgentAvatar';
import { colors, layoutPx } from './theme';

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
  snapshot: GameWorldSnapshot | null;
  gatewayStatus: string;
  loading: boolean;
  onRefresh: () => void;
  selectedAgentId: string | null;
  onOpenAgentDetail: (agentId: string) => void;
}) {
  const { snapshot, gatewayStatus, loading, onRefresh, selectedAgentId, onOpenAgentDetail } = props;
  return (
    <header style={bar}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <strong style={{ color: colors.gold, fontSize: 16 }}>Hermes 数字工作室</strong>
        {snapshot && (
          <span style={{ color: colors.text, fontSize: 12 }}>
            第 {snapshot.day} 天 {snapshot.time} · 💰 {snapshot.money} · 👥 {snapshot.agents.length} · 📋 {snapshot.tasks.length}
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
        {snapshot && (
          <span style={{ color: colors.text, fontSize: 11, textAlign: 'right' }}>
            <span style={{ color: colors.gold }}>👑 Lv.{snapshot.lord_level}</span>
            <br />
            <span style={{ fontSize: 10 }}>XP: {snapshot.lord_xp}</span>
          </span>
        )}
        <span style={{ color: '#555', fontSize: 10 }} title="开发用">GW:{gatewayStatus}</span>
        <button type="button" onClick={() => onRefresh()} disabled={loading} style={{ fontSize: 11, padding: '6px 10px' }}>
          {loading ? '…' : '刷新'}
        </button>
      </div>
    </header>
  );
}
