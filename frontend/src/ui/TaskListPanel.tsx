import { useMemo } from 'react';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { colors, taskStatusLabelCn } from './theme';

const cardBorder = `1px solid ${colors.border}`;

const ACTIVE_ORDER: Record<string, number> = { pending: 0, in_progress: 1, locked: 2, completed: 3, failed: 4 };

export function TaskListPanel() {
  const snapshot = useTaskStore((s) => s.snapshot);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);
  const setDockedPanel = useUiStore((s) => s.setDockedPanel);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTask = useUiStore((s) => s.setSelectedTask);
  const toggleStudioLeftPanelCollapsed = useUiStore((s) => s.toggleStudioLeftPanelCollapsed);

  const tasks = useMemo(() => {
    const list = snapshot?.tasks ?? [];
    return [...list].sort((a, b) => (ACTIVE_ORDER[a.status] ?? 9) - (ACTIVE_ORDER[b.status] ?? 9));
  }, [snapshot?.tasks]);

  const handleTaskClick = (taskId: number) => {
    setSelectedTask(taskId);
    // ensure left panel is open
    const uiState = useUiStore.getState();
    if (uiState.studioLeftPanelCollapsed) {
      toggleStudioLeftPanelCollapsed();
    }
    // close dock
    setDockedPanel({ kind: 'taskList' }); // will toggle closed since already open
  };

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 360, overflowY: 'auto', alignContent: 'flex-start' }}>
      {/* 添加卡片 */}
      <div
        onClick={() => openFloatingWindow({ kind: 'newTask' })}
        style={{
          width: 220, padding: '12px', borderRadius: 6, cursor: 'pointer',
          border: `1px dashed ${colors.gold}`,
          background: 'rgba(255,215,0,0.03)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          color: colors.gold, fontSize: 13, flex: '0 0 auto',
        }}
      >
        <span style={{ fontSize: 18, lineHeight: 1 }}>＋</span>
        <span>新建任务</span>
      </div>

      {tasks.map((t) => {
        const isSelected = selectedTaskId === t.id;
        const st = taskStatusLabelCn(t.status);
        const assignee = t.assignee_id
          ? snapshot?.agents.find((a) => a.id === t.assignee_id)
          : null;
        return (
          <div
            key={t.id}
            onClick={() => handleTaskClick(t.id)}
            style={{
              width: 220, flex: '0 0 auto',
              padding: '10px 12px', borderRadius: 6,
              background: isSelected ? '#0a0a18' : '#0d0d20',
              border: isSelected ? `1px solid ${colors.gold}` : cardBorder,
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column', gap: 4,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: colors.bright, fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                {t.name}
              </span>
              <span style={{ color: st.color, fontSize: 9, background: `${st.color}22`, padding: '1px 5px', borderRadius: 3, flexShrink: 0, marginLeft: 6 }}>
                {st.text}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#888' }}>
              <span>难度: {'★'.repeat(t.difficulty)}{'☆'.repeat(5 - t.difficulty)}</span>
              {assignee && <span>{assignee.display_name || assignee.name}</span>}
            </div>
            {t.progress != null && t.progress > 0 && (
              <div style={{ height: 3, background: '#222', borderRadius: 2, marginTop: 2 }}>
                <div style={{ height: '100%', width: `${Math.min(100, t.progress)}%`, background: colors.gold, borderRadius: 2 }} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
