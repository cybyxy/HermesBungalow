import { create } from 'zustand';
import type { TaskWorldSnapshot } from '../types/game';
import * as gameApi from '../services/gameApi';
import type { ChannelOption } from '../services/gameApi';
import { gameGateway, type GatewayStatus } from '../services/gameGateway';

export interface ModelOption {
  value: string;
  label: string;
  providerLabel: string;
}

let offStatus: (() => void) | null = null;
let offGame: (() => void) | null = null;
let _gwStatusTimer: ReturnType<typeof setTimeout> | null = null;
let _wsRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let _wsPendingRefresh = false;
const GW_DEBOUNCE_MS = 300;
const WS_REFRESH_THROTTLE_MS = 800;

function _debouncedGwStatus(s: TaskStore['gatewayStatus']) {
  if (_gwStatusTimer) clearTimeout(_gwStatusTimer);
  _gwStatusTimer = setTimeout(() => {
    useTaskStore.setState({ gatewayStatus: s });
  }, GW_DEBOUNCE_MS);
}

/** WebSocket 事件触发 loadState 的节流：合并短时间内的多次事件为一次刷新。 */
function _throttledWsRefresh() {
  if (_wsRefreshTimer) {
    _wsPendingRefresh = true;
    return;
  }
  _wsRefreshTimer = setTimeout(() => {
    _wsRefreshTimer = null;
    const hadPending = _wsPendingRefresh;
    _wsPendingRefresh = false;
    void useTaskStore.getState().loadState({ silent: true });
    if (hadPending) _throttledWsRefresh();
  }, WS_REFRESH_THROTTLE_MS);
}

interface TaskStore {
  snapshot: TaskWorldSnapshot | null;
  loading: boolean;
  error: string | null;
  gatewayStatus: GatewayStatus;
  lastEvents: { channel: string; data: Record<string, unknown>; at: number }[];
  configuredModels: ModelOption[];
  configuredChannels: ChannelOption[];
  /** `silent`: 不置 `loading: true`，用于编排/轮询后刷新，避免顶栏「刷新」与推理态被全局 loading 打断。 */
  loadState: (opts?: { silent?: boolean }) => Promise<void>;
  loadConfiguredModels: () => Promise<void>;
  loadConfiguredChannels: () => Promise<void>;
  assignTask: (taskId: number, agentId?: string | null) => Promise<void>;
  deleteTask: (taskId: number) => Promise<void>;
  deleteAgent: (agentId: string) => Promise<void>;
  applyLlmTags: (text: string) => Promise<void>;
  connectGateway: () => void;
  disconnectGateway: () => void;
}

const MAX_EVENTS = 30;

/** 后端或代理刚起来时首包常 5xx / 连接被拒，自动重试避免用户必须手动刷新 */
const LOAD_STATE_MAX_ATTEMPTS = 5;
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

export const useTaskStore = create<TaskStore>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  gatewayStatus: 'disconnected',
  lastEvents: [],
  configuredModels: [],
  configuredChannels: [],

  loadConfiguredModels: async () => {
    if (get().configuredModels.length > 0) return; // 已加载过
    try {
      const data = await gameApi.fetchConfiguredModels();
      const seen = new Set<string>();
      const opts: ModelOption[] = [{ value: 'auto', label: '自动选择', providerLabel: '' }];
      seen.add('auto');
      for (const m of data.models ?? []) {
        const val = `${m.provider_id}/${m.model_id}`;
        if (seen.has(val)) continue;
        seen.add(val);
        opts.push({
          value: val,
          label: m.model_label,
          providerLabel: m.provider_label,
        });
      }
      set({ configuredModels: opts });
    } catch {
      // 静默失败，用户可点刷新按钮重试
    }
  },

  loadConfiguredChannels: async () => {
    if (get().configuredChannels.length > 0) return;
    try {
      const data = await gameApi.fetchConfiguredChannels();
      const channels: ChannelOption[] = [{ channel_id: '', channel_label: '无', connected: true }];
      for (const ch of data.channels ?? []) {
        if (ch.connected) {
          channels.push(ch);
        }
      }
      set({ configuredChannels: channels });
    } catch {
      // 静默失败
    }
  },

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

  assignTask: async (taskId, agentId) => {
    await gameApi.postTaskAssign(taskId, agentId);
    await get().loadState();
  },

  deleteTask: async (taskId) => {
    await gameApi.postTaskDelete(taskId);
    // 乐观移除，避免与定时 tick / WebSocket 触发的 loadState 竞态导致列表「删不掉」
    set((s) => {
      if (!s.snapshot) return {};
      return {
        snapshot: { ...s.snapshot, tasks: s.snapshot.tasks.filter((t) => t.id !== taskId) },
      };
    });
    await get().loadState({ silent: true });
  },

  deleteAgent: async (agentId) => {
    const res = await gameApi.postDeleteAgent(agentId);
    if (!res.ok) {
      console.error('deleteAgent failed:', res.error);
      return;
    }
    set((s) => {
      if (!s.snapshot) return {};
      return {
        snapshot: { ...s.snapshot, agents: s.snapshot.agents.filter((a) => a.id !== agentId) },
      };
    });
    await get().loadState({ silent: true });
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
      // task 事件通过节流刷新来拉取最新状态
      if (channel === 'task') {
        _throttledWsRefresh();
        return;
      }
      _throttledWsRefresh();
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
