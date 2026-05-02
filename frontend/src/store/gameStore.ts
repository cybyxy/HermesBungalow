import { create } from 'zustand';
import type { GameWorldSnapshot } from '../types/game';
import * as gameApi from '../services/gameApi';
import { gameGateway, type GatewayStatus } from '../services/gameGateway';

let offStatus: (() => void) | null = null;
let offGame: (() => void) | null = null;

interface GameStore {
  snapshot: GameWorldSnapshot | null;
  loading: boolean;
  error: string | null;
  gatewayStatus: GatewayStatus;
  lastEvents: { channel: string; data: Record<string, unknown>; at: number }[];
  loadState: () => Promise<void>;
  moveAgent: (agentId: string, roomId: string) => Promise<void>;
  assignTask: (taskId: number, agentId?: string | null) => Promise<void>;
  applyLlmTags: (text: string) => Promise<void>;
  connectGateway: () => void;
  disconnectGateway: () => void;
}

const MAX_EVENTS = 30;

export const useGameStore = create<GameStore>((set, get) => ({
  snapshot: null,
  loading: false,
  error: null,
  gatewayStatus: 'disconnected',
  lastEvents: [],

  loadState: async () => {
    set({ loading: true, error: null });
    try {
      const [snapshot, agents] = await Promise.all([gameApi.fetchGameState(), gameApi.fetchGameAgents()]);
      set({ snapshot: { ...snapshot, agents }, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },

  moveAgent: async (agentId, roomId) => {
    await gameApi.postAgentMove(agentId, roomId);
    await get().loadState();
  },

  assignTask: async (taskId, agentId) => {
    await gameApi.postTaskAssign(taskId, agentId);
    await get().loadState();
  },

  applyLlmTags: async (text) => {
    await gameApi.postLlmApplyTags(text);
    await get().loadState();
  },

  connectGateway: () => {
    offStatus?.();
    offGame?.();
    offStatus = gameGateway.onStatus((gatewayStatus) => set({ gatewayStatus }));
    offGame = gameGateway.onGameEvent((channel, data) => {
      set((s) => ({
        lastEvents: [{ channel, data, at: Date.now() }, ...s.lastEvents].slice(0, MAX_EVENTS),
      }));
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
