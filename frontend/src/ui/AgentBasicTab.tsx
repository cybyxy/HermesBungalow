import type { Agent } from '../types/game';
import { colors, studioGlass } from './theme';

export function AgentBasicTab(props: { agent: Agent }) {
  const { agent } = props;

  return (
    <div>
      <div
        style={{
          ...studioGlass.inset,
          padding: 8,
          borderRadius: 4,
          marginBottom: 6,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>💬 口头禅</div>
        <div style={{ color: '#fff', fontSize: 11, fontStyle: 'italic' }}>&quot;{agent.catchphrase || '暂无口头禅'}&quot;</div>
      </div>
      <div
        style={{
          ...studioGlass.inset,
          padding: 8,
          borderRadius: 4,
          marginBottom: 6,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>🧠 性格</div>
        <div style={{ color: '#aaa', fontSize: 10, lineHeight: 1.45 }}>{agent.personality || '暂无描述'}</div>
      </div>
      <div
        style={{
          ...studioGlass.inset,
          padding: 8,
          borderRadius: 4,
          marginBottom: 6,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ color: '#666', fontSize: 9, marginBottom: 4 }}>🎭 梗语</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(agent.memes ?? ['暂无梗']).map((m, i) => (
            <span key={i} style={{ background: '#2a2a40', color: '#aaa', padding: '2px 6px', borderRadius: 8, fontSize: 9 }}>
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
