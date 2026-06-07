import { memo, useState, useRef, useEffect } from 'react';
import type { Agent } from '../types/game';
import { AgentAvatar } from './AgentAvatar';
import { professionColor } from './theme';
import type { OfficeRoom } from './officeLayout';

export const AgentDeskCard = memo(function AgentDeskCard(props: {
  agent: Agent;
  selected: boolean;
  isPeerVisitor: boolean;
  currentRoomId: string;
  allRooms: OfficeRoom[];
  onSelect: (id: string) => void;
  onChat: (id: string) => void;
  onDetail: (id: string) => void;
  onMoveToRoom: (agentId: string, roomId: string) => void;
}) {
  const { agent, selected, isPeerVisitor, currentRoomId, allRooms, onSelect, onChat, onDetail, onMoveToRoom } = props;
  const pcolor = professionColor(agent.profession);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  if (isPeerVisitor) {
    return (
      <div
        onClick={() => onSelect(agent.id)}
        title={`${agent.display_name || agent.name}（${agent.profession}）访客`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          borderRadius: 6,
          border: `1.5px solid ${selected ? '#FFD700' : 'transparent'}`,
          background: selected ? 'rgba(255,215,0,0.06)' : '#1a1a2e',
          cursor: 'pointer',
          opacity: 0.5,
          width: 160,
          flexShrink: 0,
        }}
      >
        <AgentAvatar agent={agent} size={28} />
        <span style={{ fontSize: 11, color: '#888' }}>{agent.display_name || agent.name} (访客)</span>
      </div>
    );
  }

  return (
    <div
      onClick={() => onSelect(agent.id)}
      title={`${agent.display_name || agent.name}（${agent.profession}）`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 10,
        borderRadius: 8,
        border: `1.5px solid ${selected ? '#FFD700' : '#2a2a3a'}`,
        background: selected
          ? 'rgba(255,215,0,0.08)'
          : '#1a1a2e',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: selected ? '0 0 10px rgba(255,215,0,0.12)' : undefined,
        width: 180,
        flexShrink: 0,
      }}
    >
      {/* 头像 + 信息 + 移动按钮 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <AgentAvatar agent={agent} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#eee', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {agent.display_name || agent.name}
          </div>
          <div style={{ fontSize: 10, color: pcolor, fontWeight: 500 }}>
            {agent.profession}
          </div>
        </div>
        {/* 移动到其他房间 */}
        <div ref={menuRef} style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="移动到其他房间"
            style={{
              fontSize: 12,
              width: 22,
              height: 22,
              borderRadius: 4,
              border: '1px solid #444',
              background: '#1e1e32',
              color: '#888',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 1,
            }}
          >
            ⇄
          </button>
          {menuOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 2,
                background: '#1e1e32',
                border: '1px solid #444',
                borderRadius: 4,
                padding: '2px 0',
                zIndex: 10,
                minWidth: 120,
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
              }}
            >
              {allRooms
                .filter((r) => r.id !== currentRoomId)
                .map((r) => (
                  <button
                    key={r.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      onMoveToRoom(agent.id, r.id);
                      setMenuOpen(false);
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '4px 10px',
                      border: 'none',
                      background: 'transparent',
                      color: r.color,
                      fontSize: 10,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {r.icon} {r.name}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* 任务指示 */}
      {agent.current_task_id && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 9, color: '#666' }}>📋 任务中</span>
          <div style={{ flex: 1, height: 3, borderRadius: 2, background: '#111', border: '1px solid #333', overflow: 'hidden' }}>
            <div style={{ width: '35%', height: '100%', background: '#FFD700', borderRadius: 2 }} />
          </div>
        </div>
      )}

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: 4 }}>
        <button
          onClick={(e) => { e.stopPropagation(); onChat(agent.id); }}
          style={{
            flex: 1,
            fontSize: 10,
            padding: '3px 0',
            borderRadius: 3,
            border: '1px solid #444',
            background: '#1e2a40',
            color: '#ccc',
            cursor: 'pointer',
          }}
        >
          💬 对话
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDetail(agent.id); }}
          style={{
            flex: 1,
            fontSize: 10,
            padding: '3px 0',
            borderRadius: 3,
            border: '1px solid #444',
            background: '#1e2a40',
            color: '#ccc',
            cursor: 'pointer',
          }}
        >
          📋 详情
        </button>
      </div>
    </div>
  );
});
