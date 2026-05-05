import { create } from 'zustand';
import type { GameWorldSnapshot } from '../types/game';
import { appendGatewayPeerRelayInference } from '../chat/orchestrationUi';
import * as gameApi from '../services/gameApi';
import { gameGateway, type GatewayStatus } from '../services/gameGateway';
import { useUiStore } from './uiStore';

let offStatus: (() => void) | null = null;
let offGame: (() => void) | null = null;
let _gwStatusTimer: ReturnType<typeof setTimeout> | null = null;
const GW_DEBOUNCE_MS = 300;

function _debouncedGwStatus(s: GameStore['gatewayStatus']) {
  if (_gwStatusTimer) clearTimeout(_gwStatusTimer);
  _gwStatusTimer = setTimeout(() => {
    useGameStore.setState({ gatewayStatus: s });
  }, GW_DEBOUNCE_MS);
}

interface GameStore {
  snapshot: GameWorldSnapshot | null;
  loading: boolean;
  error: string | null;
  gatewayStatus: GatewayStatus;
  lastEvents: { channel: string; data: Record<string, unknown>; at: number }[];
  /** `silent`: 不置 `loading: true`，用于编排/轮询后刷新，避免顶栏「刷新」与推理态被全局 loading 打断。 */
  loadState: (opts?: { silent?: boolean }) => Promise<void>;
  moveAgent: (agentId: string, roomId: string) => Promise<void>;
  assignTask: (taskId: number, agentId?: string | null) => Promise<void>;
  deleteTask: (taskId: number) => Promise<void>;
  applyLlmTags: (text: string) => Promise<void>;
  connectGateway: () => void;
  disconnectGateway: () => void;
}

const MAX_EVENTS = 30;

/** 后端或代理刚起来时首包常 5xx / 连接被拒，自动重试避免用户必须手动刷新 */
const LOAD_STATE_MAX_ATTEMPTS = 24;
function loadStateDelayMs(attempt: number): number {
  return Math.min(1600, 200 + attempt * 120);
}

function isTransientLoadFailure(err: unknown): boolean {
  const m = String(err instanceof Error ? err.message : err).toLowerCase();
  if (m.includes('failed to fetch')) return true;
  if (m.includes('networkerror')) return true;
  if (m.includes('load failed')) return true;
  return /^\s*5\d\d\s/.test(m);
}

export const useGameStore = create<GameStore>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  gatewayStatus: 'disconnected',
  lastEvents: [],

  loadState: async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) set({ loading: true, error: null });
    else set({ error: null });
    let lastErr: Error | null = null;
    for (let attempt = 0; attempt < LOAD_STATE_MAX_ATTEMPTS; attempt++) {
      try {
        const [snapshot, agents] = await Promise.all([gameApi.fetchGameState(), gameApi.fetchGameAgents()]);
        set({ snapshot: { ...snapshot, agents }, loading: false, error: null });
        return;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        const canRetry = isTransientLoadFailure(lastErr) && attempt < LOAD_STATE_MAX_ATTEMPTS - 1;
        if (!canRetry) {
          set({ error: lastErr.message, loading: false });
          return;
        }
        await new Promise((r) => setTimeout(r, loadStateDelayMs(attempt)));
      }
    }
    set({ error: lastErr?.message ?? '加载失败', loading: false });
  },

  moveAgent: async (agentId, roomId) => {
    await gameApi.postAgentMove(agentId, roomId);
    await get().loadState();
  },

  assignTask: async (taskId, agentId) => {
    await gameApi.postTaskAssign(taskId, agentId);
    await get().loadState();
  },

  deleteTask: async (taskId) => {
    const tid = Number(taskId);
    if (!Number.isFinite(tid)) throw new Error('无效的任务 ID');
    await gameApi.postDeleteTask(tid);
    set((s) => {
      if (!s.snapshot) return {};
      return { snapshot: gameApi.stripTaskFromWorldSnapshot(s.snapshot, tid) };
    });
    if (Number(useUiStore.getState().selectedTaskId) === tid) {
      useUiStore.getState().setSelectedTask(null);
    }
    try {
      await get().loadState({ silent: true });
    } catch {
      /* 乐观更新已生效；静默刷新失败时保留当前 UI */
    }
  },

  applyLlmTags: async (text) => {
    await gameApi.postLlmApplyTags(text);
    await get().loadState();
  },

  connectGateway: () => {
    offStatus?.();
    offGame?.();
    offStatus = gameGateway.onStatus((gatewayStatus) => _debouncedGwStatus(gatewayStatus));
    offGame = gameGateway.onGameEvent((channel, data) => {
      set((s) => ({
        lastEvents: [{ channel, data, at: Date.now() }, ...s.lastEvents].slice(0, MAX_EVENTS),
      }));
      // agent_status 事件直接 patch 到 snapshot，避免 loadState 拉不到最新 status
      if (channel === 'agent_status' && (data.action === 'update' || data.action === 'move') && data.agent) {
        const updatedAgent = data.agent as Partial<GameWorldSnapshot['agents'][number]>;
        set((s) => {
          if (!s.snapshot) return {};
          const agents = s.snapshot.agents.map((a) =>
            a.id === updatedAgent.id ? { ...a, ...updatedAgent } : a,
          );
          return { snapshot: { ...s.snapshot, agents } };
        });
        return;
      }
      if (channel === 'agent_status' && data.action === 'peer_relay_inference') {
        appendGatewayPeerRelayInference(get().snapshot, data);
        return;
      }
      void get().loadState();
    });
    gameGateway.connect();
  },

  disconnectGateway: () => {
    offStatus?.();
    offGame?.();
    offStatus = null;
    offGame = null;
    gameGateway.disconnect();
  },
}));
