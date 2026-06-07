import type { TaskItem } from '../types/game';
import { colors, studioGlass, taskStatusLabelCn } from './theme';

export function AgentTaskTab(props: { tasks: TaskItem[] }) {
  const { tasks } = props;

  return (
    <div>
      {tasks.length === 0 && <div style={{ color: '#888', fontSize: 11 }}>当前无分配任务</div>}
      {tasks.map((t) => {
        const st = taskStatusLabelCn(t.status);
        return (
          <div
            key={t.id}
            style={{
              ...studioGlass.inset,
              borderRadius: 6,
              padding: 8,
              marginBottom: 6,
              border: `1px solid ${colors.border}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ color: '#fff', fontSize: 11 }}>{t.name}</span>
              <span style={{ color: st.color, fontSize: 9 }}>{st.text}</span>
            </div>
            <div style={{ height: 5, background: 'rgba(26,26,46,0.85)', borderRadius: 3, border: `1px solid ${colors.border}` }}>
              <div style={{ width: `${Math.max(0, Math.min(100, t.progress))}%`, height: '100%', background: '#FFD700', borderRadius: 3 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
