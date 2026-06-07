import type { TaskWorldSnapshot, TaskItem } from '../types/game';
import { colors } from './theme';
import { blockTitle, taskAssigneeName } from './TaskMonitorPanelUtils';

interface StudioTaskListProps {
  snapshot: TaskWorldSnapshot | null;
  selectedTaskId: number | null;
  onSelectTask: (id: number) => void;
  onDeleteTask: (taskId: number) => Promise<void>;
  onToggleCollapse: () => void;
  onOpenNewTask: () => void;
}

export function StudioTaskList(props: StudioTaskListProps) {
  const { snapshot, selectedTaskId, onSelectTask, onDeleteTask, onToggleCollapse, onOpenNewTask } = props;

  return (
    <div
      style={{
        flexShrink: 0,
        maxHeight: '44%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        borderBottom: `1px solid ${colors.border}`,
      }}
    >
      {/* ── 头部：标题 + 按钮 ── */}
      <div
        style={{
          padding: '8px 10px 4px',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ ...blockTitle, marginBottom: 0 }}>📋 工作室任务</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            title="收起"
            onClick={onToggleCollapse}
            style={{
              fontSize: 10,
              padding: '2px 6px',
              cursor: 'pointer',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'rgba(42,58,90,0.6)',
              color: colors.bright,
              fontFamily: 'inherit',
            }}
          >
            ◀
          </button>
          <button
            type="button"
            title="与底栏「新建任务」相同表单"
            onClick={onOpenNewTask}
            style={{
              fontSize: 10,
              padding: '4px 8px',
              cursor: 'pointer',
              borderRadius: 4,
              border: `1px solid ${colors.border}`,
              background: 'rgba(42,58,90,0.6)',
              color: colors.bright,
              fontFamily: 'inherit',
            }}
          >
            + 新建
          </button>
        </div>
      </div>

      {/* ── 任务列表 ── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '0 10px 8px',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
        }}
      >
        {!snapshot || snapshot.tasks.length === 0 ? (
          <p style={{ margin: 0, fontSize: 11, color: '#555', lineHeight: 1.45 }}>暂无任务。</p>
        ) : (
          snapshot.tasks.filter((t: TaskItem) => !t.parent_task_id || t.parent_task_id === 0).map((t: TaskItem) => {
            const sel = selectedTaskId === t.id;
            return (
              <div
                key={t.id}
                style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  gap: 6,
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                {/* ── 任务卡片（选择） ── */}
                <button
                  type="button"
                  onClick={() => onSelectTask(t.id)}
                  title={t.description || t.name}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: `1px solid ${sel ? colors.gold : colors.border}`,
                    background: sel ? 'rgba(212,175,55,0.12)' : 'rgba(26,26,48,0.55)',
                    color: colors.bright,
                    fontSize: 11,
                    lineHeight: 1.35,
                    boxSizing: 'border-box',
                    fontFamily: 'inherit',
                  }}
                >
                  <div style={{ fontWeight: 'bold', color: sel ? colors.gold : colors.bright }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: '#7a8498', marginTop: 2 }}>
                    #{t.id} · {t.status} · {Math.round(t.progress)}% · {taskAssigneeName(snapshot, t.assignee_id)}
                  </div>
                </button>

                {/* ── 删除按钮 ── */}
                <button
                  type="button"
                  title="删除此任务"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (
                      !window.confirm(
                        `确定删除任务「${t.name}」(#${t.id})？已分配给 Agent 的关联会一并清除。`,
                      )
                    ) {
                      return;
                    }
                    void onDeleteTask(t.id);
                  }}
                  style={{
                    flexShrink: 0,
                    alignSelf: 'stretch',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    borderRadius: 6,
                    border: '1px solid #844',
                    background: 'rgba(90,30,30,0.45)',
                    color: '#faa',
                    fontSize: 10,
                    fontFamily: 'inherit',
                    lineHeight: 1.2,
                  }}
                >
                  删除
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
