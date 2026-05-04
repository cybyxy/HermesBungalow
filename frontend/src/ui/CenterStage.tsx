/**
 * 整页 Phaser：顶栏 / 中央游戏区 / 右侧会话 / 底栏输入与菜单（壳层绘制 + DOM textarea）。
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
          inferenceLog: ui.inferenceLog,
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
      ref={wrapRef}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        width: '100%',
        height: '100%',
        position: 'relative',
        background: C.bg,
        overflow: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  );
}
