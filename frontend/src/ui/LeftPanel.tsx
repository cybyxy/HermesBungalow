import type { CSSProperties } from 'react';
import type { Agent, GameRoom, GameWorldSnapshot } from '../types/game';
import { colors, layoutPx, professionColor, statusColor, statusLabelCn } from './theme';

const panel: CSSProperties = {
  width: layoutPx.sidePanel,
  flexShrink: 0,
  background: colors.panel,
  borderRight: `2px solid ${colors.border}`,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 0,
};

const scroll: CSSProperties = { overflow: 'auto', flex: 1, padding: '8px 12px' };

export function LeftPanel(props: {
  snapshot: GameWorldSnapshot;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onMoveAgent: (agentId: string, roomName: string) => void;
}) {
  const { snapshot, selectedAgentId, onSelectAgent, onMoveAgent } = props;
  const roomNames = snapshot.rooms.map((r: GameRoom) => r.name);
  const selected = snapshot.agents.find((a) => a.id === selectedAgentId) ?? null;

  return (
    <aside style={panel}>
      <div style={{ padding: '12px 12px 8px', color: colors.bright, fontWeight: 'bold', fontSize: 12 }}>◀ Agent列表</div>
      <div style={scroll}>
        {snapshot.agents.length === 0 && (
          <div style={{ color: colors.text, fontSize: 11, padding: '8px 0' }}>暂无 Agent（后端 /api/game/agents 为空）</div>
        )}
        {snapshot.agents.map((a: Agent) => {
          const isSel = a.id === selectedAgentId;
          const pc = professionColor(a.profession);
          const initial = (a.name && a.name[0]) || '?';
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAgent(a.id)}
              style={{
                display: 'flex',
                width: '100%',
                boxSizing: 'border-box',
                minHeight: 62,
                marginBottom: 8,
                padding: 8,
                gap: 10,
                background: isSel ? '#3a4a6a' : colors.btn,
                border: `1px solid ${isSel ? colors.gold : colors.border}`,
                borderRadius: 4,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  flexShrink: 0,
                  background: isSel ? '#5a7a9a' : colors.agent,
                  border: `1px solid ${isSel ? colors.gold : colors.border}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: colors.bright,
                  fontSize: 10,
                  fontWeight: 'bold',
                }}
              >
                {initial}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: colors.bright, fontWeight: 'bold', fontSize: 11 }}>{a.name || a.id}</div>
                <div style={{ color: pc, fontSize: 9, marginTop: 2 }}>{a.profession}</div>
                <div style={{ color: '#888', fontSize: 9, marginTop: 2 }}>📍 {a.location || '—'}</div>
                <div style={{ color: statusColor(a.status), fontSize: 9, marginTop: 2 }}>{statusLabelCn(a.status)}</div>
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <div style={{ flex: 1, height: 6, background: '#333', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${a.energy}%`, height: '100%', background: '#228B22' }} />
                  </div>
                  <div style={{ flex: 1, height: 6, background: '#333', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${a.mood}%`, height: '100%', background: '#FF8C00' }} />
                  </div>
                </div>
              </div>
            </button>
          );
        })}

        {selected && (
          <>
            <div style={{ color: colors.gold, fontSize: 11, margin: '12px 0 8px' }}>▶ 移动到</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '6px 8px',
              }}
            >
              {roomNames.map((room) => {
                const isHere = selected.location === room;
                return (
                  <button
                    key={room}
                    type="button"
                    onClick={() => onMoveAgent(selected.id, room)}
                    style={{
                      padding: '6px 8px',
                      fontSize: 9,
                      background: isHere ? '#2a4a4a' : colors.btn,
                      border: `1px solid ${colors.border}`,
                      color: isHere ? '#888' : colors.bright,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      borderRadius: 4,
                    }}
                  >
                    {isHere ? `● ${room}` : room}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
