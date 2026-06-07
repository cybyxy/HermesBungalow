import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { AgentAvatar } from './AgentAvatar';
import { colors } from './theme';

const cardBorder = `1px solid ${colors.border}`;

export function AgentListPanel() {
  const snapshot = useTaskStore((s) => s.snapshot);
  const deleteAgent = useTaskStore((s) => s.deleteAgent);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);

  const agents = snapshot?.agents ?? [];

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 360, overflowY: 'auto', alignContent: 'flex-start' }}>
      {/* 添加卡片 */}
      <div
        onClick={() => openFloatingWindow({ kind: 'addAgent' })}
        style={{
          width: 220, padding: '12px', borderRadius: 6, cursor: 'pointer',
          border: `1px dashed ${colors.gold}`,
          background: 'rgba(255,215,0,0.03)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: colors.gold, fontSize: 13, flex: '0 0 auto',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
        <span>添加 Agent</span>
      </div>

      {agents.map((a) => {
        const isSelected = selectedAgentId === a.id;
        return (
          <div
            key={a.id}
            style={{
              width: 220, flex: '0 0 auto',
              padding: '10px 12px', borderRadius: 6,
              background: isSelected ? '#0a0a18' : '#0d0d20',
              border: isSelected ? `1px solid ${colors.gold}` : cardBorder,
              cursor: 'pointer',
              position: 'relative',
            }}
          >
            <div
              onClick={() => openFloatingWindow({ kind: 'agent', agentId: a.id })}
              style={{ cursor: 'pointer' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <AgentAvatar agent={a} size={32} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                  <span style={{ color: colors.bright, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.display_name || a.name}
                  </span>
                  <span style={{ color: '#888', fontSize: 10 }}>{a.profession}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                {a.reasoning_model && a.reasoning_model !== 'auto' && (
                  <span style={{ color: '#888', fontSize: 9 }} title={a.reasoning_model}>
                    {a.reasoning_model.length > 20 ? a.reasoning_model.slice(0, 18) + '…' : a.reasoning_model}
                  </span>
                )}
                {a.channel && (
                  <span style={{ color: '#87CEEB', fontSize: 9 }} title={`渠道: ${a.channel}`}>
                    {a.channel}
                  </span>
                )}
              </div>
            </div>

            {/* 删除按钮 — 默认 agent 不可删除 */}
            {a.name !== 'default' && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (!window.confirm(`确认删除 Agent「${a.display_name || a.name}」？\n\n此操作将同时删除该 Agent 的 profile 目录、会话记录和所有关联数据，不可撤销。`)) return;
                void deleteAgent(a.id);
              }}
              title="删除 Agent"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                background: 'transparent',
                color: '#ff6b6b',
                border: 'none',
                fontSize: 12,
                cursor: 'pointer',
                padding: '2px 4px',
                borderRadius: 3,
                lineHeight: 1,
                opacity: 0.5,
              }}
              onMouseEnter={(e) => { (e.target as HTMLButtonElement).style.opacity = '1'; }}
              onMouseLeave={(e) => { (e.target as HTMLButtonElement).style.opacity = '0.5'; }}
            >
              ✕
            </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
