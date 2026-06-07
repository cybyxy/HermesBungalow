import type { TaskItem, TaskWorldSnapshot } from '../types/game';
import type { MonitorArtifactIndexRow, MonitorTimelineRow } from '../services/gameApi';
import { InferenceMarkdownBody } from './inferenceMarkdown';
import { colors } from './theme';
import { formatTs, agentLabel } from './TaskMonitorPanelUtils';

// ── TaskArtifactsTab ──

interface TaskArtifactsTabProps {
  selectedTask: TaskItem | null;
  detailsLoading: boolean;
  detailsErr: string | null;
  allArtifacts: (MonitorArtifactIndexRow & { _woId: string })[];
  snapshot: TaskWorldSnapshot | null;
  onOpenArtifact: (id: string, title: string) => void;
}

/** 产物 tab：展示 event_log 中按 task_id 关联的产物 + monitor 编排产物。 */
export function TaskArtifactsTab(props: TaskArtifactsTabProps) {
  const { selectedTask, detailsLoading, detailsErr, allArtifacts, snapshot, onOpenArtifact } = props;

  // 从 event_log 中提取按 task_id 匹配的产物（含子任务）
  const childTaskIds = new Set(
    (snapshot?.tasks || [])
      .filter((t) => t.parent_task_id === selectedTask?.id)
      .map((t) => t.id),
  );
  childTaskIds.add(selectedTask?.id ?? 0);

  const eventArtifacts = (snapshot?.event_log || []).filter(
    (e: Record<string, unknown>) =>
      e.kind === 'artifact' && childTaskIds.has(e.task_id as number),
  );

  const hasMonitorArtifacts = allArtifacts.length > 0;
  const hasEventArtifacts = eventArtifacts.length > 0;
  const hasAny = hasMonitorArtifacts || hasEventArtifacts;

  return (
    <div style={{ padding: 10 }}>
      {!selectedTask && (
        <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
          请在上方选择一个任务
        </div>
      )}
      {selectedTask && detailsLoading && (
        <div style={{ color: '#888', fontSize: 11 }}>加载编排产物…</div>
      )}
      {detailsErr && (
        <div style={{ color: '#f88', fontSize: 10, marginBottom: 6 }}>{detailsErr}</div>
      )}
      {selectedTask && !detailsLoading && !hasAny && (
        <div style={{ color: '#777', fontSize: 11 }}>（暂无产物）</div>
      )}

      {/* ── event_log 产物（按 task_id 关联）── */}
      {hasEventArtifacts && (
        <>
          <div style={{ color: colors.gold, fontSize: 9, marginBottom: 6, marginTop: 2 }}>
            任务交付物
          </div>
          {eventArtifacts.map((e: Record<string, unknown>, idx: number) => (
            <div
              key={`ev-${idx}`}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 6,
                padding: '8px 8px',
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                background: '#1a2a1a',
                color: colors.bright,
                fontSize: 10,
              }}
            >
              <div style={{ color: '#9ab', fontSize: 9 }}>
                {e.artifact_kind as string} · #{e.task_id as number}
              </div>
              <div style={{ fontWeight: 'bold' }}>{e.title as string}</div>
              <div style={{ color: '#8a8', fontSize: 9, wordBreak: 'break-all' }}>
                {e.content as string}
              </div>
            </div>
          ))}
        </>
      )}

      {/* ── Monitor 产物 ── */}
      {hasMonitorArtifacts && (
        <>
          {hasEventArtifacts && (
            <div style={{ color: '#5a6278', fontSize: 9, margin: '8px 0 6px' }}>
              编排会话产物
            </div>
          )}
          {allArtifacts.map((a, idx) => (
            <button
              key={a.id ?? idx}
              type="button"
              onClick={() => void onOpenArtifact(a.id, a.title)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                marginBottom: 6,
                padding: '8px 8px',
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                background: '#1e1e36',
                color: colors.bright,
                cursor: 'pointer',
                fontSize: 10,
              }}
            >
              <div style={{ color: '#9ab', fontSize: 9 }}>
                {formatTs(a.created_at)}
                {a._woId ? ` · WO#${a._woId.slice(0, 6)}` : ''}
              </div>
              <div style={{ fontWeight: 'bold' }}>{a.title}</div>
              <div style={{ color: '#8a8', fontSize: 9 }}>{agentLabel(snapshot, a.agent_id)}</div>
            </button>
          ))}
        </>
      )}
    </div>
  );
}

// ── TaskBodyTab ──

interface TaskBodyTabProps {
  selectedTask: TaskItem | null;
  detailsLoading: boolean;
  artifactLoading: boolean;
  artifactBody: string | null;
  artifactTitle: string;
  allTimelineEvents: (MonitorTimelineRow & { _woId: string; _seq: number })[];
}

/** 全文 tab：展示选中产物的 Markdown 正文。 */
export function TaskBodyTab(props: TaskBodyTabProps) {
  const { selectedTask, detailsLoading, artifactLoading, artifactBody, artifactTitle, allTimelineEvents } = props;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 10 }}>
      <div style={{ color: '#9aa', fontSize: 10, marginBottom: 6 }}>
        {artifactTitle || '（选产物或时间线条目）'}
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          border: `1px solid ${colors.border}`,
          borderRadius: 6,
          padding: 8,
          background: '#12121f',
          fontSize: 11,
          color: colors.bright,
        }}
      >
        {!selectedTask && (
          <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            请在上方选择一个任务
          </div>
        )}
        {selectedTask && !detailsLoading && allTimelineEvents.length === 0 && (
          <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            该任务暂无关联的编排记录
          </div>
        )}
        {artifactLoading && selectedTask && (
          <div style={{ color: '#888' }}>加载中…</div>
        )}
        {!artifactLoading && artifactBody != null && (
          <InferenceMarkdownBody body={artifactBody} />
        )}
        {!artifactLoading && artifactBody == null && selectedTask && allTimelineEvents.length > 0 && (
          <div style={{ color: '#666' }}>
            在「产物」或「任务流程」中点击带产物的项。
          </div>
        )}
      </div>
    </div>
  );
}
