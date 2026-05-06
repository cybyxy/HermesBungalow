/**
 * 整页 Phaser：顶栏为 React DOM；中央游戏区 + 底栏壳层在 Phaser（+ DOM textarea）。
 */
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { Agent, GameWorldSnapshot } from '../types/game';
import type { AgentInferenceState } from '../store/uiStore';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { syncHermesSessionsFromSnapshot } from '../chat/studioChatActions';
import { registerStudioCollabWalk } from '../collab/studioCollabWalkBridge';
import { C, computeBuildingLayout, getRoomGridCell } from './buildingLayout';
import { computeFullPageLayout } from './fullPageLayout';
import { TaskMonitorPanel } from './TaskMonitorPanel';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { colors, layoutPx, studioGlass } from './theme';
import {
  mountStudioGame,
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
  centerInference: Record<string, AgentInferenceState>;
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
    centerInference,
    gatewayStatus,
    loading,
    onSelectAgent,
    onMoveAgent,
    onOpenAgentDetail,
    onRefresh,
  } = props;
  const studioRightPanelCollapsed = useUiStore((s) => s.studioRightPanelCollapsed);
  const toggleStudioRightPanelCollapsed = useUiStore((s) => s.toggleStudioRightPanelCollapsed);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<StudioGameApi | null>(null);

  const walkTickRef = useRef(0);
  const spriteStateRef = useRef<Record<string, AgentSpriteState>>({});
  const prevLocationRef = useRef<Record<string, string>>({});
  const snapshotRef = useRef(snapshot);
  const selectedIdRef = useRef(selectedAgentId);
  const inferenceRef = useRef(centerInference);
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
  inferenceRef.current = centerInference;
  gatewayRef.current = gatewayStatus;
  loadingRef.current = loading;
  handlersRef.current = { onSelectAgent, onMoveAgent, onOpenAgentDetail, onRefresh };

  if (!studioCtxRef.current) {
    studioCtxRef.current = {
      getPack: () => {
        const wrap = wrapRef.current;
        const W = Math.max(32, wrap?.clientWidth ?? 0);
        const H = Math.max(32, wrap?.clientHeight ?? 0);
        const ui = useUiStore.getState();
        const rightPanelCollapsed = ui.studioRightPanelCollapsed;
        const fullLayout = computeFullPageLayout(W, H, { rightPanelCollapsed });
        const cw = fullLayout.center.w;
        const ch = fullLayout.center.h;
        const snap = snapshotRef.current;
        const sel = selectedIdRef.current;
        const centerInference = inferenceRef.current;
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
        onQuickNewTask: () => useUiStore.getState().openBottomSheet({ kind: 'newTask' }),
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
      <div
        ref={wrapRef}
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 1,
          background: C.bg,
          overflow: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
      <TaskMonitorPanel snapshot={snapshot} />
      <div
        aria-label="会话与过程"
        style={{
          position: 'absolute',
          right: 0,
          top: layoutPx.topBar,
          bottom: layoutPx.bottomBar,
          width: studioRightPanelCollapsed ? layoutPx.sidePanelCollapsed : layoutPx.sidePanel,
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
    </div>
  );
}
