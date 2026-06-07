import { memo } from 'react';
import type { Agent } from '../types/game';
import { AgentAvatar } from './AgentAvatar';
import { professionColor, studioGlass } from './theme';
import { isPeerVisitorAgent } from './buildingLayout';

export const AgentCard = memo(function AgentCard(props: {
  agent: Agent;
  selected: boolean;
  isPeerVisitor: boolean;
  onSelect: (id: string) => void;
  onChat: (id: string) => void;
  onDetail: (id: string) => void;
}) {
  const { agent, selected, isPeerVisitor, onSelect, onChat, onDetail } = props;

  const pcolor = professionColor(agent.profession);

  return (
    <div
      onClick={() => onSelect(agent.id)}
      title={`${agent.display_name || agent.name}（${agent.profession}）`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: 8,
        borderRadius: 6,
        border: `1.5px solid ${selected ? '#FFD700' : 'transparent'}`,
        background: selected ? 'rgba(255,215,0,0.06)' : studioGlass.inset.background,
        cursor: 'pointer',
        opacity: isPeerVisitor ? 0.5 : 1,
        transition: 'border-color 0.15s ease',
        width: 160,
        flexShrink: 0,
      }}
    >
      {/* 头像行 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <AgentAvatar agent={agent} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent.display_name || agent.name}
          </div>
          <div style={{ fontSize: 10, color: pcolor }}>{agent.profession}</div>
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onChat(agent.id); }}
          disabled={isPeerVisitor}
          style={{
            flex: 1,
            fontSize: 10,
            padding: '2px 0',
            borderRadius: 3,
            border: '1px solid #333',
            background: '#1a2a4a',
            color: '#ccc',
            cursor: isPeerVisitor ? 'not-allowed' : 'pointer',
          }}
        >
          对话
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDetail(agent.id); }}
          style={{
            flex: 1,
            fontSize: 10,
            padding: '2px 0',
            borderRadius: 3,
            border: '1px solid #333',
            background: '#1a2a4a',
            color: '#ccc',
            cursor: 'pointer',
          }}
        >
          详情
        </button>
      </div>
    </div>
  );
});
