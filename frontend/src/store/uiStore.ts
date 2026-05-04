import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

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
  /** SSE ``done.display.markdown_editor``：右侧用分栏 Markdown 编辑+预览展示本条回复。 */
  markdownEditor?: boolean;
}

/** Clarify modal payload — shared between SSE callback and modal renderer. */
export interface ClarifyPrompt {
  question: string;
  choices_offered: string[];
  resolve: (answer: string) => void;
}

/** 底部统一弹窗容器：根据 kind 切换内容（仅 × 关闭，见 PopupSheet 默认）。 */
export type BottomSheetState =
  | { kind: 'closed' }
  | { kind: 'menu'; menuKey: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'newTask' }
  | { kind: 'addAgent' }
  | { kind: 'skills' };

/** 单个 Agent 在中央画布上的推理状态 */
export interface AgentInferenceState {
  phase: 'idle' | 'thinking' | 'tool' | 'done';
  /** 结束时展示在头顶，最多 10 个 Unicode 字符 */
  doneSnippet: string;
  /** tool 阶段的文案，如 "搜索中..." */
  toolSnippet: string;
  doneExpiresAt: number;
}

const INITIAL_STATE: AgentInferenceState = {
  phase: 'idle',
  doneSnippet: '',
  toolSnippet: '',
  doneExpiresAt: 0,
};

interface UiStore {
  selectedAgentId: string | null;
  selectedTaskId: number | null;
  /** 右侧「会话 / 过程」折叠为窄条，中央区变宽 */
  studioRightPanelCollapsed: boolean;
  toggleStudioRightPanelCollapsed: () => void;
  /** 编排返回的 monitor 工作单 id：左栏任务监视对该单高频轮询直至终态 */
  monitorFocusWorkOrderId: string | null;
  setMonitorFocusWorkOrderId: (id: string | null) => void;
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
  patchInference: (id: string, partial: Partial<Omit<InferenceEntry, 'id' | 'at'>>) => void;
  /** After a round ends: keep the user row at `userMessageIndex` and tail rows for this round (reply/error + 过程轨迹). */
  finalizeInferenceRound: (userMessageIndex: number) => void;
  beginCenterAgentThinking: (agentId: string) => void;
  /** 展示回复前 10 字（或错误摘要），5 秒内由画布侧定时清理。 */
  finishCenterAgentInference: (agentId: string, replyOrErrorText: string) => void;
  /** 中央画布：工具进行中气泡文案（如「搜索中…」）。 */
  setCenterAgentTool: (agentId: string, toolName: string) => void;
  clearCenterAgentInference: (agentId: string) => void;
  clearInferenceLog: () => void;
  setAgentStream: (agentId: string, streamId: string) => void;
  clearAgentStream: (agentId: string) => void;
  /** Clarify modal — set when SSE sends a clarify event, cleared when user answers. */
  clarifyPrompt: ClarifyPrompt | null;
  setClarifyPrompt: (p: ClarifyPrompt | null) => void;
  bottomSheet: BottomSheetState;
  openBottomSheet: (p: Exclude<BottomSheetState, { kind: 'closed' }>) => void;
  closeBottomSheet: () => void;
}

const MAX_INFERENCE = 200;

type PersistedInferenceSlice = Pick<
  UiStore,
  'inferenceLog' | 'agentInferState' | 'studioRightPanelCollapsed'
>;

function newEntryId(): string {
  return `inf-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeAgentInferAfterRefresh(
  state: Record<string, AgentInferenceState> | undefined,
): Record<string, AgentInferenceState> {
  if (!state) return {};
  const out: Record<string, AgentInferenceState> = {};
  for (const [k, v] of Object.entries(state)) {
    if (v?.phase === 'thinking') {
      out[k] = { ...INITIAL_STATE };
    } else {
      out[k] = { ...INITIAL_STATE, ...v };
    }
  }
  return out;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      selectedAgentId: null,
      selectedTaskId: null,
      studioRightPanelCollapsed: false,
      toggleStudioRightPanelCollapsed: () =>
        set((s) => ({ studioRightPanelCollapsed: !s.studioRightPanelCollapsed })),
      monitorFocusWorkOrderId: null,
      setMonitorFocusWorkOrderId: (id) => set({ monitorFocusWorkOrderId: id }),
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
              ...(partial.markdownEditor != null ? { markdownEditor: partial.markdownEditor } : {}),
            },
          ].slice(-MAX_INFERENCE),
        }));
        return id;
      },
      appendToInference: (id, chunk) =>
        set((s) => ({
          inferenceLog: s.inferenceLog.map((e) => (e.id === id ? { ...e, body: e.body + chunk } : e)),
        })),
      patchInference: (id, partial) =>
        set((s) => ({
          inferenceLog: s.inferenceLog.map((e) => (e.id === id ? { ...e, ...partial } : e)),
        })),
      finalizeInferenceRound: (userMessageIndex) =>
        set((s) => {
          const log = s.inferenceLog;
          if (userMessageIndex < 0 || userMessageIndex >= log.length) return s;
          if (log[userMessageIndex]?.variant !== 'user') return s;
          const head = log.slice(0, userMessageIndex + 1);
          const tail = log.slice(userMessageIndex + 1);
          const keptTail = tail.filter(
            (e) =>
              e.variant === 'reply' ||
              e.variant === 'error' ||
              e.variant === 'reasoning' ||
              e.variant === 'tool_start' ||
              e.variant === 'tool_done' ||
              e.variant === 'tool_failed' ||
              e.variant === 'status',
          );
          return { inferenceLog: [...head, ...keptTail].slice(-MAX_INFERENCE) };
        }),
      beginCenterAgentThinking: (agentId) =>
        set((s) => ({
          agentInferState: {
            ...s.agentInferState,
            [agentId]: { phase: 'thinking', doneSnippet: '', toolSnippet: '', doneExpiresAt: 0 },
          },
        })),
      finishCenterAgentInference: (agentId, replyOrErrorText) => {
        const raw = (replyOrErrorText || '').trim();
        const snippet = raw ? [...raw].slice(0, 10).join('') : '推理已完成';
        set((s) => ({
          agentInferState: {
            ...s.agentInferState,
            [agentId]: { phase: 'done', doneSnippet: snippet, toolSnippet: '', doneExpiresAt: Date.now() + 5000 },
          },
        }));
      },
      setCenterAgentTool: (agentId, toolName) =>
        set((s) => ({
          agentInferState: {
            ...s.agentInferState,
            [agentId]: { phase: 'tool', toolSnippet: toolName, doneSnippet: '', doneExpiresAt: 0 },
          },
        })),
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
        set({ inferenceLog: [], agentInferState: {}, agentStreamIds: {} }),
      clarifyPrompt: null,
      setClarifyPrompt: (p) => set({ clarifyPrompt: p }),
      bottomSheet: { kind: 'closed' },
      openBottomSheet: (p) => set({ bottomSheet: p }),
      closeBottomSheet: () => set({ bottomSheet: { kind: 'closed' } }),
    }),
    {
      name: 'hermes-bungalow-inference-v1',
      version: 1,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (s): PersistedInferenceSlice => ({
        inferenceLog: s.inferenceLog,
        agentInferState: s.agentInferState,
        studioRightPanelCollapsed: s.studioRightPanelCollapsed,
      }),
      merge: (persistedState, currentState) => {
        const p = (persistedState ?? {}) as Partial<PersistedInferenceSlice>;

        const baseLog = Array.isArray(p.inferenceLog) ? p.inferenceLog : currentState.inferenceLog;

        const hadThinkingInPersist =
          p.agentInferState &&
          Object.values(p.agentInferState).some((v) => v?.phase === 'thinking');

        let inferenceLog = baseLog;
        if (hadThinkingInPersist && baseLog.length > 0) {
          const entry: InferenceEntry = {
            id: newEntryId(),
            at: Date.now(),
            variant: 'status',
            agentId: null,
            headline: '系统',
            body: '与后端的流式连接已断开（例如整页刷新）；以下为刷新前已缓冲的推理与回复。可继续发送新消息开启新一轮。',
          };
          inferenceLog = [...baseLog, entry].slice(-MAX_INFERENCE);
        }

        return {
          ...currentState,
          inferenceLog,
          agentInferState: sanitizeAgentInferAfterRefresh(p.agentInferState),
          studioRightPanelCollapsed:
            typeof p.studioRightPanelCollapsed === 'boolean'
              ? p.studioRightPanelCollapsed
              : currentState.studioRightPanelCollapsed,
        };
      },
    },
  ),
);
