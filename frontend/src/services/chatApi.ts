import { JSON_HDR, parseJson } from './gameApi';

// ── types ──────────────────────────────────────────────────────────────────

/**
 * Backend-orchestrated chat: injects peer hint (if >=2 agents), runs primary turn,
 * parses @ handoff lines, runs peer relays. Sessions come from the server pool.
 */
/** 后端编排时从 Hermes 流式队列收集的「过程」条目（推理 / 工具起止）。 */
export type OrchestrationTraceRow =
  | { type: 'reasoning'; text: string }
  | {
      type: 'tool';
      name?: string;
      preview?: string;
      event_type?: string;
      args?: Record<string, string>;
    }
  | {
      type: 'tool_complete';
      name?: string;
      preview?: string;
      event_type?: string;
      duration?: unknown;
      is_error?: boolean;
    };

export type OrchestrationDelegationRow = {
  target: string;
  profile?: string;
  ok?: boolean;
  reply?: string;
  error?: string | null;
  trace?: OrchestrationTraceRow[];
  nested?: OrchestrationDelegationRow[];
};

export type AgentChatOrchestratedResult = {
  ok: boolean;
  work_order_id?: string;
  primary?: {
    ok: boolean;
    reply?: string;
    error?: string | null;
    profile?: string;
    internal_session_id?: string;
    user_handoff?: string;
    trace?: OrchestrationTraceRow[];
  };
  delegations?: OrchestrationDelegationRow[];
  error?: string;
  detail?: string;
};

export async function agentChatOrchestrated(payload: {
  agent_id: string;
  message: string;
  auto_peer?: boolean;
  attachments?: string[];
}): Promise<AgentChatOrchestratedResult> {
  const res = await fetch('/api/task/agent-chat-orchestrated', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({
      agent_id: payload.agent_id,
      message: payload.message,
      auto_peer: payload.auto_peer !== false,
      attachments: payload.attachments?.length ? payload.attachments : undefined,
    }),
  });
  return parseJson(res);
}

export type AgentChatOrchestratedRunResponse = {
  ok: boolean;
  run_id?: string;
  work_order_id?: string;
  error?: string;
};

/** 启动编排一轮（随后用 EventSource GET …/stream?run_id= 收 SSE）。 */
export async function postAgentChatOrchestratedRun(payload: {
  agent_id: string;
  message: string;
  auto_peer?: boolean;
  attachments?: string[];
}): Promise<AgentChatOrchestratedRunResponse> {
  const res = await fetch('/api/task/agent-chat-orchestrated/run', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify({
      agent_id: payload.agent_id,
      message: payload.message,
      auto_peer: payload.auto_peer !== false,
      attachments: payload.attachments?.length ? payload.attachments : undefined,
    }),
  });
  return parseJson(res);
}

export async function cancelGameAgentStream(stream_id: string): Promise<{ ok: boolean; cancelled?: boolean }> {
  const res = await fetch('/api/task/agent-stream/cancel', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify({ stream_id }),
  });
  return parseJson(res);
}

// ─ Lord chat & agent social chat ─

export async function postLordCreateTask(payload: {
  name: string;
  description: string;
  required_profession: string;
  difficulty: number;
  reward: number;
  estimated_hours?: number;
  due_at?: string;
  user_skill_excerpt?: string;
}): Promise<AgentChatOrchestratedResult> {
  const res = await fetch('/api/task/lord/create-task', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

export async function postLordChat(message: string): Promise<AgentChatOrchestratedResult> {
  const res = await fetch('/api/task/lord/chat', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ message }),
  });
  return parseJson(res);
}

export async function postAgentSocialChat(
  agentId: string,
  message: string,
): Promise<{ ok: boolean; reply?: string; agent_id?: string; error?: string }> {
  const res = await fetch('/api/task/agent/social-chat', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ agent_id: agentId, message }),
  });
  return parseJson(res);
}

/** One-shot LLM turn as another game agent（Hermes profile）；与 UI 里 `@对方 | 消息` 手动点名一致。 */
export async function relayChatToAgent(
  toToken: string,
  message: string,
): Promise<{
  ok: boolean;
  reply?: string;
  error?: string | null;
  profile?: string;
  detail?: string;
  token?: string;
  work_order_id?: string;
}> {
  const res = await fetch('/api/task/agent-relay', {
    method: 'POST',
    headers: JSON_HDR,
    body: JSON.stringify({ to_agent_id: toToken.trim(), message: message.trim() }),
  });
  return parseJson(res);
}
