import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { buildTaskOrchestrationUserMessage, firstLocalAgentId } from '../chat/taskOrchestrationPrompt';
import { runOrchestratedAndFlushUi } from '../chat/studioChatActions';
import * as gameApi from '../services/gameApi';
import type {
  MonitorArtifactIndexRow,
  MonitorTimelineRow,
  MonitorWorkOrderDetail,
  MonitorWorkOrderRow,
} from '../services/gameApi';
import type { TaskItem, TaskWorldSnapshot, TaskWorkflowStep } from '../types/game';
import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { isPeerVisitorAgent } from './buildingLayout';
import { colors, layoutPx, studioGlass } from './theme';
import { taskAssigneeName } from './TaskMonitorPanelUtils';
import { StudioTaskList } from './StudioTaskList';
import { TaskDetailTab, TaskTimelineTab } from './TaskDetailTabs';
import { TaskArtifactsTab, TaskBodyTab } from './TaskArtifactTabs';

type TabId = 'timeline' | 'artifacts' | 'body' | 'detail';

/** 左侧：上为游戏内「工作室任务」列表，下为任务详情 / 任务流程（存档 event_log）/ 编排产物等；可折叠。 */
export function LeftStudioPanel(props: { snapshot: TaskWorldSnapshot | null }) {
  const { snapshot } = props;
  const studioLeftPanelCollapsed = useUiStore((s) => s.studioLeftPanelCollapsed);
  const toggleStudioLeftPanelCollapsed = useUiStore((s) => s.toggleStudioLeftPanelCollapsed);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTask = useUiStore((s) => s.setSelectedTask);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const deleteTask = useTaskStore((s) => s.deleteTask);

  const selectedTask = useMemo(() => {
    if (!snapshot || selectedTaskId == null) return null;
    return snapshot.tasks.find((x) => x.id === selectedTaskId) ?? null;
  }, [snapshot, selectedTaskId]);

  const plannedSteps: TaskWorkflowStep[] = useMemo(() => {
    const raw = selectedTask?.workflow_steps;
    if (!Array.isArray(raw)) return [];
    return raw.filter((s): s is TaskWorkflowStep => s && typeof s.id === 'string' && typeof s.title === 'string');
  }, [selectedTask?.workflow_steps]);

  /** 全量编排记录。 */
  const [allWorkOrders, setAllWorkOrders] = useState<MonitorWorkOrderRow[]>([]);
  const [workOrdersErr, setWorkOrdersErr] = useState<string | null>(null);
  /** 当前选中任务关联的所有编排记录详情（每个 WO 独立加载）。 */
  const [workOrderDetails, setWorkOrderDetails] = useState<MonitorWorkOrderDetail[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsErr, setDetailsErr] = useState<string | null>(null);
  const [artifactBody, setArtifactBody] = useState<string | null>(null);
  const [artifactTitle, setArtifactTitle] = useState<string>('');
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [tab, setTab] = useState<TabId>('detail');
  const [reExecuteBusy, setReExecuteBusy] = useState(false);
  const [generateWorkflowBusy, setGenerateWorkflowBusy] = useState(false);

  /** 加载全部编排记录（仅一次）。 */
  const refreshWorkOrders = useCallback(async () => {
    setWorkOrdersErr(null);
    try {
      const r = await gameApi.fetchMonitorWorkOrders();
      setAllWorkOrders(r.work_orders ?? []);
    } catch (e) {
      setWorkOrdersErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshWorkOrders();
  }, [refreshWorkOrders]);

  /** 仅在「产物」「全文」时加载编排 monitor（与任务流程 tab 解耦）。 */
  useEffect(() => {
    if (!selectedTask) {
      setWorkOrderDetails([]);
      return;
    }
    if (tab !== 'artifacts' && tab !== 'body') {
      setWorkOrderDetails([]);
      return;
    }
    const taskName = selectedTask.name.trim();
    const matched = allWorkOrders.filter((wo) => wo.user_prompt.includes(taskName));
    if (matched.length === 0) {
      setWorkOrderDetails([]);
      return;
    }
    setDetailsLoading(true);
    setDetailsErr(null);
    let cancelled = false;
    void (async () => {
      try {
        const results = await Promise.all(matched.map((wo) => gameApi.fetchMonitorWorkOrder(wo.id)));
        if (!cancelled) setWorkOrderDetails(results.map((r) => r.work_order));
      } catch (e) {
        if (!cancelled) setDetailsErr((e as Error).message);
      } finally {
        if (!cancelled) setDetailsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedTask, allWorkOrders, tab]);

  /** 编排 monitor 时间线（仅产物/全文 tab 使用）。 */
  const allTimelineEvents = useMemo(() => {
    const events: (MonitorTimelineRow & { _woId: string; _seq: number })[] = [];
    workOrderDetails.forEach((wo) => {
      wo.timeline.forEach((ev) => {
        events.push({ ...ev, _woId: wo.id, _seq: ev.seq });
      });
    });
    return events.sort((a, b) => a.created_at - b.created_at);
  }, [workOrderDetails]);

  /** 全部产物。 */
  const allArtifacts = useMemo(() => {
    const items: (MonitorArtifactIndexRow & { _woId: string })[] = [];
    workOrderDetails.forEach((wo) => {
      wo.artifacts_index.forEach((a) => {
        items.push({ ...a, _woId: wo.id });
      });
    });
    return items;
  }, [workOrderDetails]);

  const pipelineHint = useMemo(() => {
    if (!selectedTask) return '';
    return `${selectedTask.status} · ${taskAssigneeName(snapshot, selectedTask.assignee_id)} · ${Math.round(selectedTask.progress)}%`;
  }, [selectedTask, snapshot]);

  const reExecuteSelectedTask = useCallback(async () => {
    if (!selectedTask || !snapshot || reExecuteBusy) return;
    const preview = buildTaskOrchestrationUserMessage(selectedTask);
    const selectedAgent = selectedAgentId
      ? snapshot.agents.find((a) => a.id === selectedAgentId) ?? null
      : null;
    let orchId = '';
    if (selectedAgentId && selectedAgent && !isPeerVisitorAgent(selectedAgent)) {
      orchId = selectedAgentId.trim();
    } else {
      if (selectedAgentId && selectedAgent && isPeerVisitorAgent(selectedAgent)) {
        useUiStore.getState().appendInference({
          variant: 'status',
          headline: '重新执行',
          body: '当前选中为串门访客，已改用本机 Agent 发起编排。',
          agentId: selectedAgentId,
        });
      }
      orchId = firstLocalAgentId(snapshot);
    }
    if (!orchId || !preview.trim()) {
      useUiStore.getState().appendInference({
        variant: 'status',
        headline: '重新执行',
        body: '没有可用的本机 Agent，无法重新提交该任务。',
        agentId: null,
      });
      return;
    }
    setReExecuteBusy(true);
    const userIdx = useUiStore.getState().inferenceLog.length;
    useUiStore.getState().appendInference({
      variant: 'user',
      headline: '你 · 重新执行任务',
      body: preview,
      agentId: orchId,
    });
    const loadSilent = () => void useTaskStore.getState().loadState({ silent: true });
    try {
      await runOrchestratedAndFlushUi(snapshot, orchId, preview, undefined, loadSilent);
      void refreshWorkOrders();
    } catch (e) {
      useUiStore.getState().appendInference({
        variant: 'error',
        headline: '系统',
        body: e instanceof Error ? e.message : String(e),
        agentId: orchId,
      });
    } finally {
      useUiStore.getState().finalizeInferenceRound(userIdx);
      setReExecuteBusy(false);
    }
  }, [selectedTask, snapshot, selectedAgentId, reExecuteBusy, refreshWorkOrders]);

  const openArtifact = async (id: string, title: string) => {
    setTab('body');
    setArtifactTitle(title);
    setArtifactLoading(true);
    setArtifactBody(null);
    try {
      const r = await gameApi.fetchMonitorArtifact(id);
      setArtifactBody(r.artifact?.content ?? '');
    } catch (e) {
      setArtifactBody(`（加载失败）${(e as Error).message}`);
    } finally {
      setArtifactLoading(false);
    }
  };

  /** 删除任务回调（确认由 StudioTaskList 处理）。 */
  const handleDeleteTask = useCallback(
    async (taskId: number) => {
      try {
        await deleteTask(taskId);
        if (selectedTaskId === taskId) setSelectedTask(null);
      } catch (err) {
        window.alert(err instanceof Error ? err.message : String(err));
      }
    },
    [deleteTask, selectedTaskId, setSelectedTask],
  );

  /** 为选中任务生成工作流时间轴（workflow_steps）。 */
  const handleGenerateWorkflow = useCallback(async () => {
    if (!selectedTask || !snapshot || generateWorkflowBusy) return;
    const agentId = selectedAgentId || firstLocalAgentId(snapshot);
    if (!agentId) return;
    setGenerateWorkflowBusy(true);
    try {
      await gameApi.postTaskWorkflowGenerate({
        task_id: selectedTask.id,
        agent_id: agentId,
      });
      await useTaskStore.getState().loadState({ silent: true });
    } catch (e) {
      console.error('generate workflow failed', e);
    } finally {
      setGenerateWorkflowBusy(false);
    }
  }, [selectedTask, snapshot, selectedAgentId, generateWorkflowBusy]);

  const tabBtn = (id: TabId, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      style={{
        flex: 1,
        padding: '6px 4px',
        fontSize: 10,
        border: 'none',
        borderBottom: tab === id ? `2px solid ${colors.gold}` : `2px solid transparent`,
        background: tab === id ? '#252540' : 'transparent',
        color: tab === id ? colors.bright : '#9aa',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  const panelW = studioLeftPanelCollapsed ? layoutPx.sidePanelCollapsed : layoutPx.sidePanel;

  return (
    <div
      aria-label="工作室与任务监测"
      style={{
        position: 'relative',
        width: panelW,
        height: '100%',
        flexShrink: 0,
        pointerEvents: 'none',
        transition: 'width 0.2s ease-out',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          pointerEvents: 'auto',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          ...studioGlass.panel,
          borderRight: `2px solid ${colors.border}`,
          boxSizing: 'border-box',
        }}
      >
        {studioLeftPanelCollapsed ? (
          <button
            type="button"
            title="展开编排监视"
            onClick={() => toggleStudioLeftPanelCollapsed()}
            style={{
              flex: 1,
              width: '100%',
              border: 'none',
              background: 'rgba(30,30,50,0.55)',
              color: colors.gold,
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
            }}
          >
            ▶
          </button>
        ) : (
          <>
            {/* ── 任务列表 ── */}
            <StudioTaskList
              snapshot={snapshot}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTask}
              onDeleteTask={handleDeleteTask}
              onToggleCollapse={() => toggleStudioLeftPanelCollapsed()}
              onOpenNewTask={() => openFloatingWindow({ kind: 'newTask' })}
            />

            {/* ── 下部：任务详情/流程/产物/全文 ── */}
            <div
              style={{
                flex: 1,
                minHeight: 0,
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  borderBottom: `1px solid ${colors.border}`,
                  padding: '8px 8px 6px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <div style={{ color: colors.gold, fontWeight: 'bold', fontSize: 13 }}>任务监测</div>
                  <span style={{ color: '#8a8', fontSize: 10, flex: 1, textAlign: 'center' }}>{pipelineHint}</span>
                </div>
              </div>

              {/* ── Tab 按钮栏 ── */}
              <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
                {tabBtn('detail', '详情')}
                {tabBtn('timeline', '任务流程')}
                {tabBtn('artifacts', '产物')}
                {tabBtn('body', '全文')}
              </div>

              {/* ── Tab 内容区 ── */}
              <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                {tab === 'timeline' && (
                  <TaskTimelineTab
                    selectedTask={selectedTask}
                    snapshot={snapshot}
                    plannedSteps={plannedSteps}
                    generateBusy={generateWorkflowBusy}
                    onGenerateWorkflow={handleGenerateWorkflow}
                  />
                )}

                {tab === 'artifacts' && (
                  <TaskArtifactsTab
                    selectedTask={selectedTask}
                    detailsLoading={detailsLoading}
                    detailsErr={detailsErr}
                    allArtifacts={allArtifacts}
                    snapshot={snapshot}
                    onOpenArtifact={openArtifact}
                  />
                )}

                {tab === 'body' && (
                  <TaskBodyTab
                    selectedTask={selectedTask}
                    detailsLoading={detailsLoading}
                    artifactLoading={artifactLoading}
                    artifactBody={artifactBody}
                    artifactTitle={artifactTitle}
                    allTimelineEvents={allTimelineEvents}
                  />
                )}

                {tab === 'detail' && (
                  <TaskDetailTab
                    task={selectedTask}
                    snapshot={snapshot}
                    reExecuteBusy={reExecuteBusy}
                    onReExecute={() => void reExecuteSelectedTask()}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export const TaskMonitorPanel = LeftStudioPanel;
