/**
 * 整页 Phaser：顶栏 / 左右栏 / 底栏为 React DOM；中央仅 Phaser 画布（底栏菜单与输入见 BottomBar）。
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Agent, GameWorldSnapshot } from '../types/game';
import { useGameStore } from '../store/gameStore';
import { STUDIO_CENTER_ZOOM_LEVELS, useUiStore } from '../store/uiStore';
import { syncHermesSessionsFromSnapshot } from '../chat/studioChatActions';
import { registerStudioCollabWalk } from '../collab/studioCollabWalkBridge';
import { C, computeBuildingLayout, getRoomGridCell } from './buildingLayout';
import { BottomBar } from './BottomBar';
import { computePhaserParentLayout } from './fullPageLayout';
import { TaskMonitorPanel } from './TaskMonitorPanel';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { colors, layoutPx, studioGlass } from './theme';
import {
  mountStudioGame,
  STUDIO_GAME_BASE_HEIGHT,
  STUDIO_GAME_BASE_WIDTH,
  type AgentSpriteVisual,
  type StudioCtxBridge,
  type StudioGameApi,
} from '../phaser/studioGame';
import type { Direction } from './spriteMap';

const FRAME_MS = 150;
const FRAME_COUNT = 3;
const IDLE_DOWN_FRAME_MS = 240;

interface AgentSpriteState {
  dir: Direction;
  frame: number;
  isMoving: boolean;
}

function dirFromDelta(dx: number, dy: number): Direction {
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function CenterStage(props: {
  snapshot: GameWorldSnapshot;
  selectedAgentId: string | null;
  gatewayStatus: string;
  loading: boolean;
  onSelectAgent: (id: string) => void;
  onMoveAgent: (agentId: string, roomName: string) => void;
  onOpenAgentDetail: (id: string) => void;
  onRefresh: () => void;
}) {
  const {
    snapshot,
    selectedAgentId,
    gatewayStatus,
    loading,
    onSelectAgent,
    onMoveAgent,
    onOpenAgentDetail,
    onRefresh,
  } = props;
  const studioRightPanelCollapsed = useUiStore((s) => s.studioRightPanelCollapsed);
  const studioLeftPanelCollapsed = useUiStore((s) => s.studioLeftPanelCollapsed);
  const toggleStudioRightPanelCollapsed = useUiStore((s) => s.toggleStudioRightPanelCollapsed);
  const studioCenterPixelZoom = useUiStore((s) => s.studioCenterPixelZoom);
  const bumpStudioCenterPixelZoom = useUiStore((s) => s.bumpStudioCenterPixelZoom);
  const resetStudioCenterPixelZoom = useUiStore((s) => s.resetStudioCenterPixelZoom);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<StudioGameApi | null>(null);

  const walkTickRef = useRef(0);
  const spriteStateRef = useRef<Record<string, AgentSpriteState>>({});
  const prevLocationRef = useRef<Record<string, string>>({});
  const snapshotRef = useRef(snapshot);
  const selectedIdRef = useRef(selectedAgentId);
  const gatewayRef = useRef(gatewayStatus);
  const loadingRef = useRef(loading);
  const handlersRef = useRef({
    onSelectAgent,
    onMoveAgent,
    onOpenAgentDetail,
    onRefresh,
  });
  const studioCtxRef = useRef<StudioCtxBridge | null>(null);
  snapshotRef.current = snapshot;
  selectedIdRef.current = selectedAgentId;
  gatewayRef.current = gatewayStatus;
  loadingRef.current = loading;
  handlersRef.current = { onSelectAgent, onMoveAgent, onOpenAgentDetail, onRefresh };

  if (!studioCtxRef.current) {
    studioCtxRef.current = {
      getPack: () => {
        const W = Math.max(32, STUDIO_GAME_BASE_WIDTH);
        const H = Math.max(32, STUDIO_GAME_BASE_HEIGHT);
        const ui = useUiStore.getState();
        const rightPanelCollapsed = ui.studioRightPanelCollapsed;
        const fullLayout = computePhaserParentLayout(W, H);
        const cw = fullLayout.center.w;
        const ch = fullLayout.center.h;
        const snap = snapshotRef.current;
        const sel = selectedIdRef.current;
        /** 读 store 而非 ref，避免编排 SSE / WS 在同一帧内多次更新时 Phaser 仍用旧头顶态 */
        const centerInference = ui.agentInferState;
        const walkFrame = walkTickRef.current % FRAME_COUNT;
        const now = performance.now();
        const L = computeBuildingLayout(cw, ch);
        const { roomSlots } = L;
        const agentVisuals: Record<string, AgentSpriteVisual> = {};
        snap.agents.forEach((agent: Agent) => {
          const pos = roomSlots[agent.location];
          if (!pos) return;
          const state = spriteStateRef.current[agent.id] ?? { dir: 'down' as Direction, frame: 0, isMoving: false };
          const renderDir: Direction = state.isMoving ? state.dir : 'down';
          const phaseOff = (agent.id.charCodeAt(0) % 17) * IDLE_DOWN_FRAME_MS;
          const idleDownFrame = Math.floor((now + phaseOff) / IDLE_DOWN_FRAME_MS) % FRAME_COUNT;
          const renderFrame = state.isMoving ? walkFrame : idleDownFrame;
          agentVisuals[agent.id] = { dir: renderDir, frame: renderFrame };
        });

        return {
          w: W,
          h: H,
          fullLayout,
          rightPanelCollapsed,
          snapshot: snap,
          selectedAgentId: sel,
          selectedTaskId: ui.selectedTaskId,
          centerInference,
          agentVisuals,
          gatewayStatus: gatewayRef.current,
          loading: loadingRef.current,
          bottomSheet: ui.bottomSheet,
        };
      },
      handlers: {
        onSelectAgent: (id: string) => handlersRef.current.onSelectAgent(id),
        onMoveAgent: (agentId: string, roomName: string) =>
          void handlersRef.current.onMoveAgent(agentId, roomName),
        onOpenAgentDetail: (id: string) => handlersRef.current.onOpenAgentDetail(id),
        onRefresh: () => handlersRef.current.onRefresh(),
        onToggleMenu: (key: string) => {
          const ui = useUiStore.getState();
          if (ui.bottomSheet.kind === 'menu' && ui.bottomSheet.menuKey === key) ui.closeBottomSheet();
          else ui.openBottomSheet({ kind: 'menu', menuKey: key });
        },
        onQuickNewTask: () => useUiStore.getState().openNewTaskModal(),
        onQuickAssign: () => {
          const tid = useUiStore.getState().selectedTaskId;
          const aid = useUiStore.getState().selectedAgentId;
          if (tid == null || !aid) return;
          void useGameStore.getState().assignTask(tid, aid).then(() => useGameStore.getState().loadState());
        },
        onQuickSkills: () => useUiStore.getState().openBottomSheet({ kind: 'skills' }),
      },
    };
  }

  useEffect(() => {
    syncHermesSessionsFromSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    snapshot.agents.forEach((agent: Agent) => {
      if (!spriteStateRef.current[agent.id]) {
        spriteStateRef.current[agent.id] = { dir: 'down', frame: 0, isMoving: false };
      }
    });

    snapshot.agents.forEach((agent: Agent) => {
      const prev = prevLocationRef.current[agent.id];
      if (prev !== undefined && prev !== agent.location) {
        const from = getRoomGridCell(prev);
        const to = getRoomGridCell(agent.location);
        let dir: Direction = spriteStateRef.current[agent.id]?.dir ?? 'down';
        if (from && to) {
          const dx = to.col - from.col;
          const dy = to.row - from.row;
          if (dx !== 0 || dy !== 0) dir = dirFromDelta(dx, dy);
        }
        spriteStateRef.current[agent.id] = {
          ...spriteStateRef.current[agent.id],
          dir,
          isMoving: true,
        };
      }
      prevLocationRef.current[agent.id] = agent.location;
    });
  }, [snapshot.agents]);

  useEffect(() => {
    const id = setInterval(() => {
      walkTickRef.current = (walkTickRef.current + 1) % (FRAME_COUNT * 16);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, []);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const ctx = studioCtxRef.current;
    if (!wrap || !ctx) return;

    const mount = () => {
      if (gameRef.current) {
        gameRef.current.layoutToHost();
        gameRef.current.sync(ctx.getPack());
      } else {
        gameRef.current = mountStudioGame(wrap, ctx);
        gameRef.current.sync(ctx.getPack());
      }
      registerStudioCollabWalk(
        (fromId, peerId, opts) =>
          gameRef.current?.runCollabApproachWalk(fromId, peerId, opts) ?? Promise.resolve(false),
        (fromId) => gameRef.current?.runCollabWalkReturnToSpawn(fromId) ?? Promise.resolve(false),
        (fromId) => gameRef.current?.clearCollabWalkFootOverride(fromId),
      );
    };

    mount();

    let raf = 0;
    const loop = () => {
      if (gameRef.current && ctx) gameRef.current.sync(ctx.getPack());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    const ro = new ResizeObserver(() => {
      mount();
    });
    ro.observe(wrap);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      registerStudioCollabWalk(null, null, null);
      gameRef.current?.destroy();
      gameRef.current = null;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      Object.keys(spriteStateRef.current).forEach((id) => {
        if (spriteStateRef.current[id].isMoving) {
          spriteStateRef.current[id] = { ...spriteStateRef.current[id], isMoving: false };
        }
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [snapshot.agents]);

  useEffect(() => {
    gameRef.current?.layoutToHost();
  }, [studioCenterPixelZoom]);

  const rightPanelW = studioRightPanelCollapsed ? layoutPx.sidePanelCollapsed : layoutPx.sidePanel;
  const leftPanelW = studioLeftPanelCollapsed ? layoutPx.sidePanelCollapsed : layoutPx.sidePanel;
  const zoomMin = studioCenterPixelZoom <= STUDIO_CENTER_ZOOM_LEVELS[0];
  const zoomMax = studioCenterPixelZoom >= STUDIO_CENTER_ZOOM_LEVELS[STUDIO_CENTER_ZOOM_LEVELS.length - 1]!;

  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        width: '100%',
        height: '100%',
        position: 'relative',
      }}
    >
      {/* 全宽铺底（含侧栏下方），侧栏 `studioGlass` 的 backdrop-filter 才能叠在画布上；勿再 left/right 内缩洞区 */}
      <div
        ref={wrapRef}
        style={{
          position: 'absolute',
          top: layoutPx.topBar,
          bottom: layoutPx.bottomBar,
          left: 0,
          right: 0,
          zIndex: 0,
          background: C.bg,
          overflow: 'auto',
          display: 'block',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          height: layoutPx.topBar,
          zIndex: 75,
          pointerEvents: 'auto',
          overflow: 'visible',
        }}
      >
        <TopBar
          snapshot={snapshot}
          gatewayStatus={gatewayStatus}
          loading={loading}
          onRefresh={onRefresh}
          selectedAgentId={selectedAgentId}
          onOpenAgentDetail={onOpenAgentDetail}
        />
      </div>
      <div
        aria-label="画布缩放"
        style={{
          position: 'absolute',
          right: rightPanelW + 6,
          top: layoutPx.topBar + 8,
          zIndex: 58,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          pointerEvents: 'auto',
          ...studioGlass.muted,
          borderRadius: 8,
          padding: 6,
          border: `1px solid ${colors.border}`,
        }}
      >
        <button
          type="button"
          title="缩小画布"
          disabled={zoomMin}
          onClick={() => bumpStudioCenterPixelZoom(-1)}
          style={{
            width: 30,
            height: 28,
            padding: 0,
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: zoomMin ? 'rgba(40,40,60,0.5)' : 'rgba(42,58,90,0.75)',
            color: zoomMin ? '#555' : colors.bright,
            cursor: zoomMin ? 'default' : 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          −
        </button>
        <button
          type="button"
          title="恢复 100% 显示"
          onClick={() => resetStudioCenterPixelZoom()}
          style={{
            width: 30,
            height: 26,
            padding: 0,
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: 'rgba(42,58,90,0.6)',
            color: studioCenterPixelZoom === 1 ? colors.gold : colors.bright,
            cursor: 'pointer',
            fontSize: 10,
            fontWeight: 'bold',
          }}
        >
          {studioCenterPixelZoom === 1 ? '1∶1' : `${Math.round(studioCenterPixelZoom * 100)}%`}
        </button>
        <button
          type="button"
          title="放大画布"
          disabled={zoomMax}
          onClick={() => bumpStudioCenterPixelZoom(1)}
          style={{
            width: 30,
            height: 28,
            padding: 0,
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            background: zoomMax ? 'rgba(40,40,60,0.5)' : 'rgba(42,58,90,0.75)',
            color: zoomMax ? '#555' : colors.bright,
            cursor: zoomMax ? 'default' : 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>
      <TaskMonitorPanel snapshot={snapshot} />
      <div
        aria-label="会话与过程"
        style={{
          position: 'absolute',
          right: 0,
          top: layoutPx.topBar,
          bottom: layoutPx.bottomBar,
          width: studioRightPanelCollapsed ? layoutPx.sidePanelCollapsed : layoutPx.sidePanel,
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
            borderLeft: `2px solid ${colors.border}`,
            boxSizing: 'border-box',
          }}
        >
          {studioRightPanelCollapsed ? (
            <button
              type="button"
              title="展开会话与过程"
              onClick={() => toggleStudioRightPanelCollapsed()}
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
              ◀
            </button>
          ) : (
            <RightPanel snapshot={snapshot} />
          )}
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 85,
          pointerEvents: 'auto',
        }}
      >
        <BottomBar snapshot={snapshot} gatewayStatus={gatewayStatus} />
      </div>
    </div>
  );
}
