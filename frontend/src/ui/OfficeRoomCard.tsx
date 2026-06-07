import { memo, useState } from 'react';
import type { Agent } from '../types/game';
import { AgentDeskCard } from './AgentDeskCard';
import type { OfficeRoom } from './officeLayout';

export const OfficeRoomCard = memo(function OfficeRoomCard(props: {
  room: OfficeRoom & { agents: Agent[] };
  allRooms: OfficeRoom[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
  onChatAgent: (id: string) => void;
  onDetailAgent: (id: string) => void;
  onMoveAgent: (agentId: string, roomId: string) => void;
  onRenameRoom?: (roomId: string, name: string) => void;
}) {
  const { room, allRooms, selectedAgentId, onSelectAgent, onChatAgent, onDetailAgent, onMoveAgent, onRenameRoom } = props;
  const [editing, setEditing] = useState(false);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 12,
        border: `2px solid ${room.color}33`,
        background: `linear-gradient(180deg, ${room.color}08 0%, #12121f 100%)`,
        overflow: 'hidden',
        flexShrink: 0,
        minWidth: 240,
      }}
    >
      {/* 房间门牌 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 14px',
          background: `${room.color}15`,
          borderBottom: `1px solid ${room.color}22`,
        }}
      >
        <span style={{ fontSize: 18 }}>{room.icon}</span>
        {editing ? (
          <input
            type="text"
            defaultValue={room.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v) onRenameRoom?.(room.id, v);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const v = e.currentTarget.value.trim();
                if (v) onRenameRoom?.(room.id, v);
                setEditing(false);
              } else if (e.key === 'Escape') {
                setEditing(false);
              }
            }}
            autoFocus
            style={{
              background: '#1a1a30',
              color: room.color,
              border: `1px solid ${room.color}`,
              borderRadius: 4,
              fontSize: 13,
              fontWeight: 600,
              padding: '2px 6px',
              fontFamily: 'inherit',
              width: 120,
            }}
          />
        ) : (
          <span
            style={{ color: room.color, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            onClick={() => onRenameRoom && setEditing(true)}
            title={onRenameRoom ? '点击修改房间名称' : undefined}
          >
            {room.name}
          </span>
        )}
        <span style={{ color: '#555', fontSize: 10, marginLeft: 'auto' }}>
          {room.agents.length} 人
        </span>
      </div>

      {/* 房间内工位 */}
      <div
        style={{
          padding: 12,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          minHeight: 60,
          background: `
            linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)
          `,
          backgroundSize: '30px 30px',
        }}
      >
        {room.agents.map((agent) => (
          <AgentDeskCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedAgentId}
            isPeerVisitor={false}
            currentRoomId={room.id}
            allRooms={allRooms}
            onSelect={onSelectAgent}
            onChat={onChatAgent}
            onDetail={onDetailAgent}
            onMoveToRoom={onMoveAgent}
          />
        ))}
        {room.agents.length === 0 && (
          <div style={{ color: '#444', fontSize: 11, padding: 20 }}>
            空闲 — 等待成员加入
          </div>
        )}
      </div>
    </div>
  );
});
