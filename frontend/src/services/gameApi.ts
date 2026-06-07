import type { TaskWorldSnapshot } from '../types/game';

const JSON_HDR = { 'Content-Type': 'application/json' };

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  return res.json() as Promise<T>;
}

/** Build a display-safe Agent from backend `GET /api/task/agents` JSON. */
export function normalizeAgentFromApi(raw: unknown): import('../types/game').Agent {
  if (!raw || typeof raw !== 'object') {
    return {
      id: '',
      name: '?',
      profession: '',
    };
  }
  const r = raw as Record<string, unknown>;
  const taskId = r.current_task_id;
  let current_task_id: number | null = null;
  if (taskId != null && taskId !== '') {
    const t = Number(taskId);
    if (Number.isFinite(t)) current_task_id = t;
  }
  const memes = r.memes;
  return {
    id: String(r.id ?? ''),
    name: String(r.name ?? ''),
    display_name: r.display_name != null && String(r.display_name) !== '' ? String(r.display_name) : undefined,
    profession: String(r.profession ?? ''),
    profile: r.profile != null && String(r.profile) !== '' ? String(r.profile) : undefined,
    gender: r.gender != null && r.gender !== '' ? String(r.gender) : undefined,
    catchphrase: r.catchphrase != null && String(r.catchphrase) !== '' ? String(r.catchphrase) : undefined,
    personality: r.personality != null && String(r.personality) !== '' ? String(r.personality) : undefined,
    memes: Array.isArray(memes) ? memes.filter((x): x is string => typeof x === 'string') : undefined,
    reasoning_model:
      r.reasoning_model != null && String(r.reasoning_model) !== '' ? String(r.reasoning_model) : undefined,
    channel:
      r.channel != null && String(r.channel) !== '' ? String(r.channel) : undefined,
    current_task_id,
    hermes_session_id:
      r.hermes_session_id != null && String(r.hermes_session_id) !== ''
        ? String(r.hermes_session_id)
        : undefined,
  };
}

export async function fetchGameState(): Promise<TaskWorldSnapshot> {
  const res = await fetch('/api/task/state');
  return parseJson<TaskWorldSnapshot>(res);
}

export async function postLlmApplyTags(text: string): Promise<{ extracted: unknown[]; applied: unknown[] }> {
  const res = await fetch('/api/task/llm/apply-tags', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ text }),
  });
  return parseJson(res);
}

export async function putSaveSnapshot(snapshot: TaskWorldSnapshot): Promise<void> {
  const res = await fetch('/api/task/save', {
    method: 'PUT',
    headers: JSON_HDR,
    body: JSON.stringify({ slot: 'default', snapshot }),
  });
  await parseJson(res);
}

// ── Re-exports ─────────────────────────────────────────────────────────────
// Keep JSON_HDR & parseJson available internally and for sub-modules.
export { JSON_HDR, parseJson };

export {
  resolveGameAgent,
  isBroadcastAllHandoffToken,
  expandHermesInvokesForSender,
  parseUserHandoffPrefix,
  parseHermesBungalowInvokes,
  mergeAssistantTextForOrchestration,
  stripHermesBungalowInvokes,
  truncateHandoffContext,
  buildPeerInvokeHint,
} from '../utils/hermesHandoff';

export {
  fetchGameAgents,
  postCreateAgent,
  postCreateHermesProfileAgent,
  getAgentProfileFiles,
  saveAgentProfileFiles,
  updateAgentConfig,
  postDeleteAgent,
  ensureGameAgentSession,
  uploadGameAgentAttachment,
} from './agentApi';

export {
  postCreateTask,
  postTaskAssign,
  postTaskDelete,
  postTaskUpdate,
  postTaskWorkflowGenerate,
  postTaskDependency,
  postBatchCreateTasks,
  fetchTaskChain,
  postTaskClaim,
} from './taskApi';
export type { TaskChainNode, TaskChainData } from './taskApi';

export {
  agentChatOrchestrated,
  postAgentChatOrchestratedRun,
  cancelGameAgentStream,
  postLordChat,
  postAgentSocialChat,
  relayChatToAgent,
} from './chatApi';
export type {
  OrchestrationTraceRow,
  OrchestrationDelegationRow,
  AgentChatOrchestratedResult,
  AgentChatOrchestratedRunResponse,
} from './chatApi';

export {
  fetchModelConfig,
  updateModelConfig,
  fetchProviders,
  fetchProviderProfiles,
  fetchConfiguredModels,
  fetchConfiguredChannels,
  postChannelConfig,
  fetchRemoteModels,
  fetchModels,
  saveModelProvider,
} from './modelConfigApi';
export type { ModelConfigData, ChannelOption } from './modelConfigApi';

export {
  fetchMonitorWorkOrders,
  fetchMonitorWorkOrder,
  fetchMonitorArtifact,
} from './monitorApi';
export type {
  MonitorWorkOrderRow,
  MonitorTimelineRow,
  MonitorArtifactIndexRow,
  MonitorWorkOrderDetail,
} from './monitorApi';

export {
  postMultiRoundStart,
  postMultiRoundContinue,
  postMultiRoundRun,
  postMultiRoundStop,
  fetchMultiRoundSession,
  fetchMultiRoundList,
} from './multiRoundApi';
export type {
  MultiRoundStartResponse,
  MultiRoundContinueResponse,
  MultiRoundRunResponse,
  MultiRoundSessionResponse,
  MultiRoundListResponse,
} from './multiRoundApi';
