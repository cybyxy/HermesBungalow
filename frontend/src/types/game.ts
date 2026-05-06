/** Mirrors backend `api.game.models.Agent.to_dict()`; extras optional for older saves. */
export interface Agent {
  id: string;
  name: string;
  display_name?: string;
  profession: string;
  profile?: string;
  gender?: string;
  status: string;
  location: string;
  energy: number;
  mood: number;
  affection?: number;
  relation?: number;
  focus?: number;
  sleepiness?: number;
  satiety?: number;
  speed?: number;
  catchphrase?: string;
  personality?: string;
  memes?: string[];
  reasoning_model?: string;
  current_task_id?: number | null;
  /** Agent skills [{name, level}] */
  skills?: { name: string; level: number }[];
  /** Server-pooled Hermes chat session for this game agent (see GET /api/game/agents). */
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
}

export interface GameTask {
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
}

export interface GameRoom {
  id: string;
  name: string;
  type: string;
  agent_ids?: string[];
}

export interface GameWorldSnapshot {
  day: number;
  time: string;
  money: number;
  lord_level: number;
  lord_xp: number;
  agents: Agent[];
  tasks: GameTask[];
  rooms: GameRoom[];
  competition_history: Record<string, unknown>[];
  event_log?: Record<string, unknown>[];
}
