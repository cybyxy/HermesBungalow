import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as gameApi from '../services/gameApi';
import type {
  MonitorArtifactIndexRow,
  MonitorTimelineRow,
  MonitorWorkOrderDetail,
  MonitorWorkOrderRow,
} from '../services/gameApi';
import type { GameWorldSnapshot } from '../types/game';
import { InferenceMarkdownBody } from './inferenceMarkdown';
import { colors, layoutPx, studioGlass } from './theme';
import { useUiStore } from '../store/uiStore';

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

function kindColor(kind: string): string {
  if (kind === 'primary_reply' || kind === 'relay_reply') return '#6ecf9b';
  if (kind === 'delegation_reply') return '#8ab4f8';
  if (kind === 'error' || kind === 'delegation_error') return '#f88';
  if (kind === 'intake') return colors.gold;
  if (kind === 'user_handoff') return '#c9a8ff';
  if (kind === 'aborted') return '#888';
  return '#aaa';
}

function terminalStatus(st: string): boolean {
  return st === 'completed' || st === 'partial' || st === 'failed';
}

/** 浮于 Phaser 场景左侧：半透明任务监视（与右侧栏视觉一致），可折叠。 */
export function TaskMonitorPanel(props: { snapshot: GameWorldSnapshot | null }) {
  const { snapshot } = props;
  const monitorFocusWorkOrderId = useUiStore((s) => s.monitorFocusWorkOrderId);
  const setMonitorFocusWorkOrderId = useUiStore((s) => s.setMonitorFocusWorkOrderId);
  const studioLeftPanelCollapsed = useUiStore((s) => s.studioLeftPanelCollapsed);
  const toggleStudioLeftPanelCollapsed = useUiStore((s) => s.toggleStudioLeftPanelCollapsed);

  const [list, setList] = useState<MonitorWorkOrderRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<MonitorWorkOrderDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [artifactBody, setArtifactBody] = useState<string | null>(null);
  const [artifactTitle, setArtifactTitle] = useState<string>('');
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [tab, setTab] = useState<'timeline' | 'artifacts' | 'body'>('timeline');

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const refreshList = useCallback(async () => {
    setListErr(null);
    try {
      const r = await gameApi.fetchMonitorWorkOrders();
      setList(r.work_orders ?? []);
      setSelectedId((prev) => prev ?? (r.work_orders?.[0]?.id ?? null));
    } catch (e) {
      setListErr((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailErr(null);
    void (async () => {
      try {
        const r = await gameApi.fetchMonitorWorkOrder(selectedId);
        if (!cancelled) setDetail(r.work_order);
      } catch (e) {
        if (!cancelled) setDetailErr((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    const focus = monitorFocusWorkOrderId;
    if (!focus) return;
    setSelectedId(focus);
    let ticks = 0;
    const tick = () => {
      ticks += 1;
      void (async () => {
        try {
          await refreshList();
          const r = await gameApi.fetchMonitorWorkOrder(focus);
          const wo = r.work_order;
          const st = wo?.status ?? '';
          if (selectedIdRef.current === focus) setDetail(wo);
          if (terminalStatus(st) || ticks >= 60) setMonitorFocusWorkOrderId(null);
        } catch {
          if (ticks >= 8) setMonitorFocusWorkOrderId(null);
        }
      })();
    };
    tick();
    const iv = window.setInterval(tick, 2000);
    return () => window.clearInterval(iv);
  }, [monitorFocusWorkOrderId, refreshList, setMonitorFocusWorkOrderId]);

  const timeline = detail?.timeline ?? [];
  const artifacts = detail?.artifacts_index ?? [];

  const pipelineHint = useMemo(() => {
    if (!detail) return '';
    const st = detail.status;
    if (st === 'completed') return '已完成';
    if (st === 'partial') return '部分失败';
    if (st === 'failed') return '失败';
    return st;
  }, [detail]);

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
      aria-label="任务监视"
      style={{
        position: 'absolute',
        left: 0,
        top: layoutPx.topBar,
        bottom: layoutPx.bottomBar,
        width: panelW,
        zIndex: 60,
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
            title="展开任务监视"
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
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 8px',
                borderBottom: `1px solid ${colors.border}`,
                gap: 6,
              }}
            >
              <div style={{ color: colors.gold, fontWeight: 'bold', fontSize: 13 }}>任务监视</div>
              <span style={{ color: '#8a8', fontSize: 10, flex: 1, textAlign: 'center' }}>{pipelineHint}</span>
              <button
                type="button"
                title="收起"
                onClick={() => toggleStudioLeftPanelCollapsed()}
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  background: 'rgba(42,58,90,0.6)',
                  color: colors.bright,
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => void refreshList()}
                style={{
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  background: colors.btn,
                  color: colors.bright,
                  cursor: 'pointer',
                  fontSize: 10,
                }}
              >
                刷新
              </button>
            </div>

      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        <label style={{ color: '#9aa', fontSize: 10, display: 'block', marginBottom: 4 }}>工作单</label>
        <select
          value={selectedId ?? ''}
          onChange={(e) => setSelectedId(e.target.value || null)}
          style={{
            width: '100%',
            padding: '6px 8px',
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: '#1a1a30',
            color: colors.bright,
            fontSize: 11,
            boxSizing: 'border-box',
          }}
        >
          {list.length === 0 && <option value="">（暂无）</option>}
          {list.map((w) => (
            <option key={w.id} value={w.id}>
              {formatTs(w.created_at)} · {w.user_prompt.slice(0, 40)}
              {w.user_prompt.length > 40 ? '…' : ''}
            </option>
          ))}
        </select>
        {listErr && <div style={{ color: '#f88', fontSize: 10, marginTop: 4 }}>{listErr}</div>}
      </div>

      <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, flexShrink: 0 }}>
        {tabBtn('timeline', '时间线')}
        {tabBtn('artifacts', '产物')}
        {tabBtn('body', '全文')}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {tab === 'timeline' && (
          <div style={{ padding: '10px 10px 10px 16px' }}>
            {detailErr && <div style={{ color: '#f88', fontSize: 10 }}>{detailErr}</div>}
            {!detail && !detailErr && <div style={{ color: '#888', fontSize: 11 }}>加载中…</div>}
            {detail && (
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
                {timeline.map((ev: MonitorTimelineRow) => (
                  <div
                    key={ev.id}
                    style={{
                      position: 'relative',
                      paddingLeft: 22,
                      marginBottom: 12,
                      cursor: ev.artifact_id ? 'pointer' : 'default',
                    }}
                    onClick={() => {
                      if (ev.artifact_id) void openArtifact(ev.artifact_id, ev.label);
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
                        background: kindColor(ev.kind),
                        border: '2px solid #1a1a30',
                      }}
                    />
                    <div style={{ color: '#999', fontSize: 9 }}>{formatTs(ev.created_at)}</div>
                    <div style={{ color: colors.bright, fontSize: 11, fontWeight: 'bold' }}>{ev.label}</div>
                    <div style={{ color: '#7a8', fontSize: 9 }}>
                      {agentLabel(snapshot, ev.agent_id)} · {ev.kind}
                    </div>
                    {ev.snippet ? (
                      <div style={{ color: '#999', fontSize: 10, marginTop: 3, whiteSpace: 'pre-wrap' }}>{ev.snippet}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'artifacts' && (
          <div style={{ padding: 10 }}>
            {artifacts.length === 0 && <div style={{ color: '#777', fontSize: 11 }}>（无产物）</div>}
            {artifacts.map((a: MonitorArtifactIndexRow) => (
              <button
                key={a.id}
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
                <div style={{ color: '#9ab', fontSize: 9 }}>{formatTs(a.created_at)}</div>
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
              {artifactLoading && <div style={{ color: '#888' }}>加载中…</div>}
              {!artifactLoading && artifactBody != null && <InferenceMarkdownBody body={artifactBody} />}
              {!artifactLoading && artifactBody == null && <div style={{ color: '#666' }}>在「产物」或「时间线」中点击带产物的项。</div>}
            </div>
          </div>
        )}
      </div>
          </>
        )}
      </div>
    </div>
  );
}
