import { JSON_HDR, parseJson } from './gameApi';

// ── Types ──────────────────────────────────────────────────────────────────

export type MultiRoundStartResponse = {
  ok: boolean;
  session_id?: string;
  rounds?: Record<string, unknown>[];
  status?: string;
  error?: string;
  detail?: string;
};

export type MultiRoundContinueResponse = {
  ok: boolean;
  session_id?: string;
  round_count?: number;
  latest_round?: Record<string, unknown>;
  status?: string;
  error?: string;
};

export type MultiRoundRunResponse = {
  ok: boolean;
  run_id?: string;
  session_id?: string;
  work_order_id?: string;
  error?: string;
};

export type MultiRoundSessionResponse = {
  ok: boolean;
  session_id?: string;
  primary_agent_id?: string;
  round_count?: number;
  rounds?: Record<string, unknown>[];
  status?: string;
  error?: string;
};

export type MultiRoundListResponse = {
  ok: boolean;
  sessions?: Array<{
    session_id: string;
    primary_agent_id: string;
    round_count: number;
    status: string;
  }>;
};

// ── Functions ──────────────────────────────────────────────────────────────

/** Start a multi-round orchestrated discussion (sync -- blocks until round 1 completes). */
export async function postMultiRoundStart(payload: {
  agent_id?: string;
  message: string;
}): Promise<MultiRoundStartResponse> {
  const res = await fetch('/api/task/multi-round/start', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

/** Inject a user continuation message into an active multi-round discussion (sync). */
export async function postMultiRoundContinue(payload: {
  session_id: string;
  message: string;
}): Promise<MultiRoundContinueResponse> {
  const res = await fetch('/api/task/multi-round/continue', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

/** Start (or continue) a multi-round round via SSE. Returns run_id + session_id immediately. */
export async function postMultiRoundRun(payload: {
  agent_id?: string;
  message: string;
  session_id?: string;
}): Promise<MultiRoundRunResponse> {
  const res = await fetch('/api/task/multi-round/run', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

/** Stop a multi-round discussion (mark as completed or cancelled). */
export async function postMultiRoundStop(payload: {
  session_id: string;
  status?: 'completed' | 'cancelled';
}): Promise<{ ok: boolean; session_id?: string; status?: string; round_count?: number }> {
  const res = await fetch('/api/task/multi-round/stop', {
    method: 'POST',
    headers: JSON_HDR,
    credentials: 'same-origin',
    body: JSON.stringify(payload),
  });
  return parseJson(res);
}

/** Get a multi-round session's full state. */
export async function fetchMultiRoundSession(sessionId: string): Promise<MultiRoundSessionResponse> {
  const res = await fetch(`/api/task/multi-round/${encodeURIComponent(sessionId)}`, {
    credentials: 'same-origin',
  });
  return parseJson(res);
}

/** List active multi-round sessions. */
export async function fetchMultiRoundList(): Promise<MultiRoundListResponse> {
  const res = await fetch('/api/task/multi-round/list', {
    credentials: 'same-origin',
  });
  return parseJson(res);
}
