import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTaskOrchestrationUserMessage, firstLocalAgentId } from '../chat/taskOrchestrationPrompt';
import { runOrchestratedAndFlushUi } from '../chat/studioChatActions';
import * as gameApi from '../services/gameApi';
import type {
  MonitorArtifactIndexRow,
  MonitorTimelineRow,
  MonitorWorkOrderDetail,
  MonitorWorkOrderRow,
} from '../services/gameApi';
import type { CSSProperties } from 'react';
import type { GameTask, GameWorldSnapshot, TaskWorkflowStep } from '../types/game';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { isPeerVisitorAgent } from './buildingLayout';
import { InferenceMarkdownBody } from './inferenceMarkdown';
import { buildTaskWorkflowTimeline, workflowKindColor } from './taskWorkflowTimeline';
import { colors, layoutPx, studioGlass } from './theme';

const blockTitle: CSSProperties = {
  color: colors.gold,
  fontSize: 12,
  fontWeight: 'bold',
  marginBottom: 8,
};

function formatTs(t: number | string): string {
  const n = typeof t === 'string' ? Number(t) : t;
  if (!Number.isFinite(n)) return '';
  return new Date(n * 1000).toLocaleString();
}

function agentLabel(snapshot: GameWorldSnapshot | null, agentId: string | null): string {
  if (!agentId) return '—';
  const a = snapshot?.agents.find((x) => x.id === agentId);
  return a ? `${a.name}` : agentId.slice(0, 8);
}

function taskAssigneeName(snapshot: GameWorldSnapshot | null, assigneeId: string | null | undefined): string {
  if (!assigneeId) return '未分配';
  const a = snapshot?.agents.find((x) => x.id === assigneeId);
  return a?.name ?? assigneeId.slice(0, 8);
}

/** 左侧：上为游戏内「工作室任务」列表，下为任务详情 / 任务流程（存档 event_log）/ 编排产物等；可折叠。 */
export function LeftStudioPanel(props: { snapshot: GameWorldSnapshot | null }) {
  const { snapshot } = props;
  const studioLeftPanelCollapsed = useUiStore((s) => s.studioLeftPanelCollapsed);
  const toggleStudioLeftPanelCollapsed = useUiStore((s) => s.toggleStudioLeftPanelCollapsed);
  const selectedTaskId = useUiStore((s) => s.selectedTaskId);
  const setSelectedTask = useUiStore((s) => s.setSelectedTask);
  const openBottomSheet = useUiStore((s) => s.openBottomSheet);
  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const deleteTask = useGameStore((s) => s.deleteTask);

  const selectedTask = useMemo(() => {
    if (!snapshot || selectedTaskId == null) return null;
    return snapshot.tasks.find((x) => x.id === selectedTaskId) ?? null;
  }, [snapshot, selectedTaskId]);

  const taskWorkflowRows = useMemo(() => {
    if (!selectedTask || !snapshot?.event_log) return [];
    return buildTaskWorkflowTimeline(snapshot.event_log, selectedTask.id, snapshot);
  }, [selectedTask, snapshot]);

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
  const [tab, setTab] = useState<'timeline' | 'artifacts' | 'body' | 'detail'>('detail');
  const [reExecuteBusy, setReExecuteBusy] = useState(false);

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
    const loadSilent = () => void useGameStore.getState().loadState({ silent: true });
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

  const tabBtn = (id: typeof tab, label: string) => (
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
        position: 'absolute',
        left: 0,
        top: layoutPx.topBar,
        bottom: layoutPx.bottomBar,
        width: panelW,
        zIndex: 70,
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
                    onClick={() => toggleStudioLeftPanelCollapsed()}
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
                    onClick={() => openBottomSheet({ kind: 'newTask' })}
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
                  snapshot.tasks.map((t: GameTask) => {
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
                        <button
                          type="button"
                          onClick={() => setSelectedTask(t.id)}
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
                            void (async () => {
                              try {
                                await deleteTask(t.id);
                                if (selectedTaskId === t.id) setSelectedTask(null);
                              } catch (err) {
                                window.alert(err instanceof Error ? err.message : String(err));
                              }
                            })();
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

      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {tabBtn('detail', '详情')}
        {tabBtn('timeline', '任务流程')}
        {tabBtn('artifacts', '产物')}
        {tabBtn('body', '全文')}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {tab === 'timeline' && (
          <div style={{ padding: '10px 10px 10px 16px' }}>
            {!selectedTask && (
              <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
                请在上方选择一个任务
              </div>
            )}
            {selectedTask && plannedSteps.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: colors.gold, fontSize: 11, fontWeight: 'bold', marginBottom: 8 }}>
                  规划步骤（Agent + SKILL 落库）
                </div>
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
                      <div style={{ color: '#999', fontSize: 9 }}>
                        第 {row.order} 步 · {row.kind}
                        {row.estimated_minutes != null ? ` · 约 ${row.estimated_minutes} 分钟` : ''}
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
              </div>
            )}
            {selectedTask && (
              <div style={{ color: '#5a6278', fontSize: 9, marginBottom: 10, lineHeight: 1.45 }}>
                {plannedSteps.length > 0
                  ? '以下为存档内任务状态事件（创建、分配、进度等），与上列「规划步骤」来源不同。'
                  : '以下为存档内「任务生命周期」事件（创建、更新、分配、进度、完成等）；新建任务并走完编排后，可在此看到 SKILL 写入的规划步骤。'}
              </div>
            )}
            {selectedTask && plannedSteps.length === 0 && taskWorkflowRows.length === 0 && (
              <div style={{ color: '#555', fontSize: 11, lineHeight: 1.5, marginTop: 4 }}>
                <div>暂无规划步骤与流程事件（新建任务后会自动请求 Agent 生成流程）。</div>
                <div style={{ marginTop: 8, color: '#7a8498' }}>
                  当前快照：<strong>{selectedTask.status}</strong> · {taskAssigneeName(snapshot, selectedTask.assignee_id)} · 进度{' '}
                  {Math.round(selectedTask.progress)}%
                </div>
              </div>
            )}
            {taskWorkflowRows.length > 0 && (
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
                {taskWorkflowRows.map((row) => (
                  <div
                    key={row.id}
                    style={{
                      position: 'relative',
                      paddingLeft: 22,
                      marginBottom: 12,
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
                    <div style={{ color: '#999', fontSize: 9 }}>{formatTs(row.at)}</div>
                    <div style={{ color: colors.bright, fontSize: 11, fontWeight: 'bold' }}>{row.title}</div>
                    <div style={{ color: '#7a8', fontSize: 9 }}>{row.kind}</div>
                    {row.detail ? (
                      <div style={{ color: '#999', fontSize: 10, marginTop: 3, whiteSpace: 'pre-wrap' }}>{row.detail}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'artifacts' && (
          <div style={{ padding: 10 }}>
            {selectedTask && (
              <div style={{ color: '#5a6278', fontSize: 9, marginBottom: 8, lineHeight: 1.45 }}>
                编排会话中的 Markdown 产物（与「任务流程」无关）；需匹配任务标题的 monitor 工作单。
              </div>
            )}
            {!selectedTask && (
              <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>请在上方选择一个任务</div>
            )}
            {selectedTask && detailsLoading && (
              <div style={{ color: '#888', fontSize: 11 }}>加载编排产物…</div>
            )}
            {detailsErr && <div style={{ color: '#f88', fontSize: 10, marginBottom: 6 }}>{detailsErr}</div>}
            {selectedTask && !detailsLoading && allArtifacts.length === 0 && (
              <div style={{ color: '#777', fontSize: 11 }}>（无产物或尚未打开本 tab 拉取 monitor）</div>
            )}
            {allArtifacts.map((a, idx) => (
              <button
                key={a.id ?? idx}
                type="button"
                onClick={() => void openArtifact(a.id, a.title)}
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
                  {formatTs(a.created_at)}{a._woId ? ` · WO#${a._woId.slice(0, 6)}` : ''}
                </div>
                <div style={{ fontWeight: 'bold' }}>{a.title}</div>
                <div style={{ color: '#8a8', fontSize: 9 }}>{agentLabel(snapshot, a.agent_id)}</div>
              </button>
            ))}
          </div>
        )}

        {tab === 'body' && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', padding: 10 }}>
            <div style={{ color: '#9aa', fontSize: 10, marginBottom: 6 }}>{artifactTitle || '（选产物或时间线条目）'}</div>
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
              {!selectedTask && <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>请在上方选择一个任务</div>}
              {selectedTask && !detailsLoading && allTimelineEvents.length === 0 && (
                <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>该任务暂无关联的编排记录</div>
              )}
              {artifactLoading && selectedTask && <div style={{ color: '#888' }}>加载中…</div>}
              {!artifactLoading && artifactBody != null && <InferenceMarkdownBody body={artifactBody} />}
              {!artifactLoading && artifactBody == null && selectedTask && allTimelineEvents.length > 0 && (
                <div style={{ color: '#666' }}>在「产物」或「任务流程」中点击带产物的项。</div>
              )}
            </div>
          </div>
        )}

        {tab === 'detail' && selectedTask && (
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
            {selectedTask.catalog ? (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: '#7a8498' }}>任务目录：</span>
                {selectedTask.catalog}
              </div>
            ) : null}
            {selectedTask.description ? (
              <div style={{ marginTop: 6 }}><span style={{ color: '#7a8498' }}>目标：</span><span style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.description}</span></div>
            ) : null}
            {selectedTask.deliverables ? (
              <div style={{ marginTop: 4 }}><span style={{ color: '#7a8498' }}>产物：</span><span style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.deliverables}</span></div>
            ) : null}
            {selectedTask.acceptance_criteria ? (
              <div style={{ marginTop: 4 }}><span style={{ color: '#7a8498' }}>验收：</span><span style={{ whiteSpace: 'pre-wrap' }}>{selectedTask.acceptance_criteria}</span></div>
            ) : null}
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                disabled={reExecuteBusy}
                onClick={() => void reExecuteSelectedTask()}
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
        )}
        {tab === 'detail' && !selectedTask && (
          <div style={{ color: '#555', fontSize: 11, textAlign: 'center', marginTop: 12 }}>
            请在上方选择一个任务
          </div>
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
