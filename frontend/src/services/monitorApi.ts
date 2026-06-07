import { JSON_HDR, parseJson } from './gameApi';

// ── Types ──────────────────────────────────────────────────────────────────

export type MonitorWorkOrderRow = {
  id: string;
  user_prompt: string;
  primary_agent_id: string;
  status: string;
  created_at: number;
  updated_at: number;
};

export type MonitorTimelineRow = {
  id: string;
  seq: number;
  kind: string;
  agent_id: string | null;
  label: string;
  snippet: string | null;
  artifact_id: string | null;
  created_at: number;
};

export type MonitorArtifactIndexRow = {
  id: string;
  agent_id: string | null;
  kind: string;
  title: string;
  created_at: number;
};

export type MonitorWorkOrderDetail = MonitorWorkOrderRow & {
  timeline: MonitorTimelineRow[];
  artifacts_index: MonitorArtifactIndexRow[];
};

// ── Functions ──────────────────────────────────────────────────────────────

export async function fetchMonitorWorkOrders(): Promise<{ ok: boolean; work_orders: MonitorWorkOrderRow[] }> {
  const res = await fetch('/api/task/monitor/work-orders');
  return parseJson(res);
}

export async function fetchMonitorWorkOrder(woId: string): Promise<{ ok: boolean; work_order: MonitorWorkOrderDetail }> {
  const res = await fetch(`/api/task/monitor/work-orders/${encodeURIComponent(woId)}`);
  return parseJson(res);
}

export async function fetchMonitorArtifact(
  artifactId: string,
): Promise<{ ok: boolean; artifact: { id: string; content: string; title: string; kind: string; agent_id: string | null } }> {
  const res = await fetch(`/api/task/monitor/artifacts/${encodeURIComponent(artifactId)}`);
  return parseJson(res);
}
