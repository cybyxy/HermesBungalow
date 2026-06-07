import type { TaskItem, TaskWorldSnapshot, TaskWorkflowStep } from '../types/game';
import { workflowKindColor } from './taskWorkflowTimeline';
import { colors } from './theme';

const statusLabel: Record<string, string> = { pending: '待开始', in_progress: '进行中', completed: '已完成' };
const statusColor: Record<string, string> = { pending: '#6a7488', in_progress: '#4a9', completed: '#7a8' };

// ── TaskDetailTab ──

interface TaskDetailTabProps {
  task: TaskItem | null;
  snapshot: TaskWorldSnapshot | null;
  reExecuteBusy: boolean;
  onReExecute: () => void;
}

/** 任务详情 tab：名称/日期/时长/状态/进度/目录/描述/产物/验收 + 重新执行按钮。 */
export function TaskDetailTab(props: TaskDetailTabProps) {
  const { task: selectedTask, snapshot, reExecuteBusy, onReExecute } = props;

  if (!selectedTask) {
    return (
      <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
        请在上方选择一个任务
      </div>
    );
  }

  const childTasks = (snapshot?.tasks || []).filter(
    (t) => t.parent_task_id === selectedTask.id,
  );
  const completedChildren = childTasks.filter((t) => t.status === 'completed').length;
  const childProgress = childTasks.length > 0
    ? Math.round((completedChildren / childTasks.length) * 100)
    : null;

  return (
    <div style={{ padding: 12, overflow: 'auto', fontSize: 11, color: colors.bright, lineHeight: 1.6 }}>
      <span style={{ color: colors.gold, fontWeight: 'bold' }}>{selectedTask.name}</span>
      {selectedTask.due_at ? (
        <><span style={{ color: '#7a8498' }}> · 完成日期 </span>{selectedTask.due_at}</>
      ) : null}
      {selectedTask.estimated_hours != null ? (
        <><span style={{ color: '#7a8498' }}> · 预计 </span>{selectedTask.estimated_hours}h</>
      ) : null}
      {selectedTask.status ? (
        <><span style={{ color: '#7a8498' }}> · </span>{selectedTask.status}</>
      ) : null}
      {selectedTask.progress != null ? (
        <><span style={{ color: '#7a8498' }}> · 进度 </span>{Math.round(selectedTask.progress)}%</>
      ) : null}

      {/* ── 子任务进度条 ── */}
      {childTasks.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ color: '#7a8498', fontSize: 10 }}>子任务进度</span>
            <span style={{ color: colors.gold, fontSize: 10 }}>
              {completedChildren}/{childTasks.length} · {childProgress}%
            </span>
          </div>
          <div style={{
            height: 6, borderRadius: 3, background: '#1a1a30',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${childProgress ?? 0}%`,
              background: childProgress === 100
                ? 'linear-gradient(90deg, #4a9, #7c4)'
                : 'linear-gradient(90deg, #d4af37, #f0c060)',
              borderRadius: 3,
              transition: 'width 0.4s ease',
            }} />
          </div>
        </div>
      )}

      {selectedTask.catalog ? (
        <div style={{ marginTop: 6 }}>
          <span style={{ color: '#7a8498' }}>任务目录：</span>
          {selectedTask.catalog}
        </div>
      ) : null}
      {selectedTask.description ? (
        <div style={{ marginTop: 6 }}>
          <span style={{ color: '#7a8498' }}>目标：</span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.description}</span>
        </div>
      ) : null}
      {selectedTask.deliverables ? (
        <div style={{ marginTop: 4 }}>
          <span style={{ color: '#7a8498' }}>产物：</span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.deliverables}</span>
        </div>
      ) : null}
      {selectedTask.acceptance_criteria ? (
        <div style={{ marginTop: 4 }}>
          <span style={{ color: '#7a8498' }}>验收：</span>
          <span style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.acceptance_criteria}</span>
        </div>
      ) : null}
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          disabled={reExecuteBusy}
          onClick={onReExecute}
          title="用当前任务全文再次走主 Agent 编排（与新建任务后的推理相同）"
          style={{
            padding: '6px 12px',
            fontSize: 11,
            borderRadius: 4,
            border: `1px solid ${colors.gold}`,
            background: reExecuteBusy ? '#2a2a40' : 'rgba(212,175,55,0.12)',
            color: colors.bright,
            cursor: reExecuteBusy ? 'wait' : 'pointer',
            opacity: reExecuteBusy ? 0.65 : 1,
          }}
        >
          {reExecuteBusy ? '提交中…' : '↻ 重新执行'}
        </button>
        <span style={{ marginLeft: 8, color: '#6a7488', fontSize: 10 }}>
          使用顶栏所选本机 Agent；若为访客则自动换成本机第一位
        </span>
      </div>
    </div>
  );
}

// ── TaskTimelineTab ──

interface TaskTimelineTabProps {
  selectedTask: TaskItem | null;
  snapshot: TaskWorldSnapshot | null;
  plannedSteps: TaskWorkflowStep[];
  generateBusy: boolean;
  onGenerateWorkflow: () => void;
}

/** 任务流程 tab：子任务时间轴（有子任务时优先显示）或 workflow_steps。 */
export function TaskTimelineTab(props: TaskTimelineTabProps) {
  const { selectedTask, snapshot, plannedSteps, generateBusy, onGenerateWorkflow } = props;

  const childTasks = (snapshot?.tasks || []).filter(
    (t) => t.parent_task_id === selectedTask?.id,
  );

  // 子任务步骤映射（用于时间轴颜色）
  const stepKind = (ct: TaskItem, idx: number): string => {
    const prof = (ct.required_profession || '').toLowerCase();
    if (prof.includes('设计') || prof.includes('ui')) return 'design';
    if (prof.includes('测试') || prof.includes('qa')) return 'test';
    if (prof.includes('review') || prof.includes('审查')) return 'review';
    return idx === childTasks.length - 1 ? 'deliver' : 'implement';
  };

  return (
    <div style={{ padding: '10px 10px 10px 16px' }}>
      {!selectedTask && (
        <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
          请在上方选择一个任务
        </div>
      )}

      {/* ── 子任务时间轴（优先） ── */}
      {selectedTask && childTasks.length > 0 && (
        <div style={{ position: 'relative' }}>
          <div style={{ color: colors.gold, fontSize: 10, marginBottom: 10 }}>
            任务链 ({childTasks.length} 个子任务)
          </div>
          <div
            style={{
              position: 'absolute',
              left: 5,
              top: 28,
              bottom: 6,
              width: 2,
              background: '#3a3a55',
              borderRadius: 1,
            }}
          />
          {childTasks.map((ct, idx) => {
            const kind = stepKind(ct, idx);
            return (
              <div
                key={ct.id}
                style={{
                  position: 'relative',
                  paddingLeft: 22,
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 3,
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    background: workflowKindColor(kind),
                    border: '2px solid #1a1a30',
                    boxShadow: ct.status === 'completed'
                      ? '0 0 6px #4a9' : ct.status === 'in_progress'
                      ? '0 0 6px #d4af37' : 'none',
                  }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{ color: '#999', fontSize: 9 }}>
                    第 {idx + 1} 步 · {kind}
                  </span>
                  <span style={{
                    color: statusColor[ct.status] || '#888',
                    fontSize: 9,
                    background: ct.status === 'completed' ? 'rgba(80,200,100,0.15)'
                      : ct.status === 'in_progress' ? 'rgba(212,175,55,0.15)'
                      : 'rgba(255,255,255,0.06)',
                    padding: '1px 6px',
                    borderRadius: 3,
                  }}>
                    {statusLabel[ct.status] || ct.status}
                  </span>
                </div>
                <div style={{ color: colors.bright, fontSize: 11, fontWeight: 'bold' }}>
                  #{ct.id} {ct.name}
                </div>
                <div style={{ color: '#7a8498', fontSize: 9, marginTop: 2 }}>
                  {ct.required_profession || '待定'}
                  {ct.assignee_id ? ` · ${ct.assignee_id}` : ' · 未分配'}
                  {ct.difficulty ? ` · 难度 ${ct.difficulty}/5` : ''}
                </div>
                {ct.description ? (
                  <div style={{ color: '#999', fontSize: 10, marginTop: 3, whiteSpace: 'pre-wrap' }}>
                    {ct.description.length > 200 ? ct.description.slice(0, 200) + '…' : ct.description}
                  </div>
                ) : null}
                {ct.depends_on && ct.depends_on.length > 0 ? (
                  <div style={{ color: '#6a7488', fontSize: 9, marginTop: 2 }}>
                    依赖任务：{ct.depends_on.map((d) => `#${d}`).join('、')}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 无子任务时显示 workflow_steps ── */}
      {selectedTask && childTasks.length === 0 && (
        <>
          {/* ── 生成时间轴按钮 ── */}
          <div style={{ marginBottom: 10 }}>
            <button
              type="button"
              disabled={generateBusy}
              onClick={onGenerateWorkflow}
              title="调用 Agent 为当前任务拆解执行步骤与时间预估"
              style={{
                padding: '5px 12px',
                fontSize: 11,
                borderRadius: 4,
                border: `1px solid ${colors.gold}`,
                background: generateBusy ? '#2a2a40' : 'rgba(212,175,55,0.12)',
                color: colors.bright,
                cursor: generateBusy ? 'wait' : 'pointer',
                opacity: generateBusy ? 0.65 : 1,
              }}
            >
              {generateBusy ? '生成中…' : '🕐 生成时间轴'}
            </button>
            <span style={{ marginLeft: 8, color: '#6a7488', fontSize: 10 }}>
              Agent 拆解执行步骤与时间预估
            </span>
          </div>

          {plannedSteps.length === 0 && (
            <div style={{ color: '#5a6278', fontSize: 10, lineHeight: 1.5, marginTop: 4 }}>
              暂无规划步骤，点击上方「生成时间轴」让 Agent 拆解此任务。
            </div>
          )}

          {/* ── 规划步骤时间轴 ── */}
          {plannedSteps.length > 0 && (
            <div style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 6,
                  bottom: 6,
                  width: 2,
                  background: '#3a3a55',
                  borderRadius: 1,
                }}
              />
              {plannedSteps.map((row) => (
                <div
                  key={row.id}
                  style={{
                    position: 'relative',
                    paddingLeft: 22,
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 3,
                      width: 10,
                      height: 10,
                      borderRadius: 5,
                      background: workflowKindColor(row.kind),
                      border: '2px solid #1a1a30',
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span style={{ color: '#999', fontSize: 9 }}>
                      第 {row.order} 步 · {row.kind}
                      {row.estimated_minutes != null ? ` · 约 ${row.estimated_minutes} 分钟` : ''}
                    </span>
                    {row.assignee ? (
                      <span style={{ color: colors.gold, fontSize: 9, background: 'rgba(212,175,55,0.15)', padding: '1px 6px', borderRadius: 3 }}>{row.assignee}</span>
                    ) : null}
                    {row.status ? (
                      <span style={{ color: statusColor[row.status] || '#888', fontSize: 9, background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 3 }}>{statusLabel[row.status] || row.status}</span>
                    ) : null}
                  </div>
                  <div style={{ color: colors.bright, fontSize: 11, fontWeight: 'bold' }}>{row.title}</div>
                  {row.detail ? (
                    <div style={{ color: '#999', fontSize: 10, marginTop: 3, whiteSpace: 'pre-wrap' }}>{row.detail}</div>
                  ) : null}
                  {row.depends_on && row.depends_on.length > 0 ? (
                    <div style={{ color: '#6a7488', fontSize: 9, marginTop: 2 }}>依赖：{row.depends_on.join('、')}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
