import { create } from 'zustand';

export type InferenceVariant =
  | 'user'
  | 'status'
  | 'reply'
  | 'error'
  | 'reasoning'
  | 'tool_start'
  | 'tool_done'
  | 'tool_failed';

export interface InferenceEntry {
  id: string;
  at: number;
  variant: InferenceVariant;
  agentId: string | null;
  headline: string;
  body: string;
}

/** Clarify modal payload — shared between SSE callback and modal renderer. */
export interface ClarifyPrompt {
  question: string;
  choices_offered: string[];
  resolve: (answer: string) => void;
}

/** 单个 Agent 在中央画布上的推理状态 */
export interface AgentInferenceState {
  phase: 'idle' | 'thinking' | 'done';
  /** 结束时展示在头顶，最多 10 个 Unicode 字符 */
  doneSnippet: string;
  doneExpiresAt: number;
}

const INITIAL_STATE: AgentInferenceState = {
  phase: 'idle',
  doneSnippet: '',
  doneExpiresAt: 0,
};

interface UiStore {
  selectedAgentId: string | null;
  selectedTaskId: number | null;
  inferenceLog: InferenceEntry[];
  /** 支持多 Agent 并行推理：key = agentId */
  agentInferState: Record<string, AgentInferenceState>;
  /** Per-agent Hermes SSE stream_id (multiple agents may infer concurrently). */
  agentStreamIds: Record<string, string>;
  setSelectedAgent: (id: string | null) => void;
  setSelectedTask: (id: number | null) => void;
  clearSelection: () => void;
  appendInference: (e: Omit<InferenceEntry, 'id' | 'at'> & { id?: string }) => string;
  appendToInference: (id: string, chunk: string) => void;
  /** After a round ends: keep the user row at `userMessageIndex` and only `reply` / `error` rows after it. */
  finalizeInferenceRound: (userMessageIndex: number) => void;
  beginCenterAgentThinking: (agentId: string) => void;
  /** 展示回复前 10 字（或错误摘要），5 秒内由画布侧定时清理。 */
  finishCenterAgentInference: (agentId: string, replyOrErrorText: string) => void;
  clearCenterAgentInference: (agentId: string) => void;
  clearInferenceLog: () => void;
  setAgentStream: (agentId: string, streamId: string) => void;
  clearAgentStream: (agentId: string) => void;
  /** Clarify modal — set when SSE sends a clarify event, cleared when user answers. */
  clarifyPrompt: ClarifyPrompt | null;
  setClarifyPrompt: (p: ClarifyPrompt | null) => void;
}

const MAX_INFERENCE = 200;

function newEntryId(): string {
  return `inf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const useUiStore = create<UiStore>((set) => ({
  selectedAgentId: null,
  selectedTaskId: null,
  inferenceLog: [],
  agentInferState: {},
  agentStreamIds: {},
  setSelectedAgent: (id) => set({ selectedAgentId: id }),
  setSelectedTask: (id) => set({ selectedTaskId: id }),
  clearSelection: () => set({ selectedAgentId: null, selectedTaskId: null }),
  appendInference: (partial) => {
    const id = partial.id ?? newEntryId();
    set((s) => ({
      inferenceLog: [
        ...s.inferenceLog,
        {
          id,
          at: Date.now(),
          variant: partial.variant,
          agentId: partial.agentId ?? null,
          headline: partial.headline,
          body: partial.body,
        },
      ].slice(-MAX_INFERENCE),
    }));
    return id;
  },
  appendToInference: (id, chunk) =>
    set((s) => ({
      inferenceLog: s.inferenceLog.map((e) => (e.id === id ? { ...e, body: e.body + chunk } : e)),
    })),
  finalizeInferenceRound: (userMessageIndex) =>
    set((s) => {
      const log = s.inferenceLog;
      if (userMessageIndex < 0 || userMessageIndex >= log.length) return s;
      if (log[userMessageIndex]?.variant !== 'user') return s;
      const head = log.slice(0, userMessageIndex + 1);
      const tail = log.slice(userMessageIndex + 1);
      const keptTail = tail.filter((e) => e.variant === 'reply' || e.variant === 'error');
      return { inferenceLog: [...head, ...keptTail].slice(-MAX_INFERENCE) };
    }),
  beginCenterAgentThinking: (agentId) =>
    set((s) => ({
      agentInferState: {
        ...s.agentInferState,
        [agentId]: { phase: 'thinking', doneSnippet: '', doneExpiresAt: 0 },
      },
    })),
  finishCenterAgentInference: (agentId, replyOrErrorText) => {
    const raw = (replyOrErrorText || '').trim();
    const snippet = raw ? [...raw].slice(0, 10).join('') : '推理已完成';
    set((s) => ({
      agentInferState: {
        ...s.agentInferState,
        [agentId]: { phase: 'done', doneSnippet: snippet, doneExpiresAt: Date.now() + 5000 },
      },
    }));
  },
  clearCenterAgentInference: (agentId) =>
    set((s) => {
      const next = { ...s.agentInferState };
      delete next[agentId];
      return { agentInferState: next };
    }),
  setAgentStream: (agentId, streamId) =>
    set((s) => ({
      agentStreamIds: { ...s.agentStreamIds, [agentId]: streamId },
    })),
  clearAgentStream: (agentId) =>
    set((s) => {
      const next = { ...s.agentStreamIds };
      delete next[agentId];
      return { agentStreamIds: next };
    }),
  clearInferenceLog: () =>
    set({ inferenceLog: [], agentInferState: {} }),
  clarifyPrompt: null,
  setClarifyPrompt: (p) => set({ clarifyPrompt: p }),
}));
