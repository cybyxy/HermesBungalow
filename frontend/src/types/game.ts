/** Mirrors backend `api.game.models.Agent.to_dict()`; extras optional for older saves. */
export interface Agent {
  id: string;
  name: string;
  display_name?: string;
  profession: string;
  profile?: string;
  gender?: string;
  catchphrase?: string;
  personality?: string;
  memes?: string[];
  reasoning_model?: string;
  /** 外部渠道平台 key（feishu/discord/telegram/...），空 = 无 */
  channel?: string;
  current_task_id?: number | null;
  /** Agent skills [{name, level}] */
  skills?: { name: string; level: number }[];
  /** Server-pooled Hermes chat session for this game agent (see GET /api/task/agents). */
  hermes_session_id?: string;
  /** Direct sprite base name override (e.g. 'badboy', 'student_03'). If set, takes priority over gender/personality matching. */
  avatar?: string;
  /** 跨机串门访客（与编排入口选择一致） */
  peer_relay_base_url?: string;
  peer_relay_agent_id?: string;
  bungalow_peer_api?: number;
}

/** 与 SKILL / GAME_EVENT ``task_workflow_plan`` 的 ``steps`` 项一致（存任务 JSON）。 */
export interface TaskWorkflowStep {
  id: string;
  order: number;
  title: string;
  detail?: string;
  kind: 'analyze' | 'design' | 'implement' | 'test' | 'review' | 'deliver' | 'other';
  estimated_minutes?: number;
  depends_on?: string[];
  assignee?: string;
  status?: 'pending' | 'in_progress' | 'completed';
}

export interface TaskItem {
  id: number;
  name: string;
  description?: string;
  progress: number;
  status: string;
  assignee_id?: string | null;
  required_profession?: string;
  difficulty: number;
  reward: number;
  is_collaborative?: boolean;
  /** 以下字段较新后端/存档可能提供 */
  due_at?: string;
  estimated_hours?: number;
  deliverables?: string;
  acceptance_criteria?: string;
  catalog?: string;
  /** Agent+LLM 规划步骤（后端写入存档） */
  workflow_steps?: TaskWorkflowStep[];
  /** 任务级前置依赖：这些 ID 完前本任务 locked */
  depends_on?: number[];
  /** 父任务 ID（批量创建时自动设定，0=顶层） */
  parent_task_id?: number;
}

export interface TaskWorldSnapshot {
  agents: Agent[];
  tasks: TaskItem[];
  event_log?: Record<string, unknown>[];
}

/** A single round result from orchestrated peer turns. */
export interface OrchestrationRoundResult {
  ok: boolean;
  primary: Record<string, unknown>;
  delegations?: Record<string, unknown>[];
  termination_reason?: string | null;
  work_order_id?: string;
}

/** Multi-round orchestrated discussion session. */
export interface MultiRoundSession {
  session_id: string;
  primary_agent_id: string;
  rounds: OrchestrationRoundResult[];
  status: 'active' | 'completed' | 'cancelled';
  round_count?: number;
}

/** Summary item from GET /api/task/multi-round/list. */
export interface MultiRoundSessionSummary {
  session_id: string;
  primary_agent_id: string;
  round_count: number;
  status: string;
}
