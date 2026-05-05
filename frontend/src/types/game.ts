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
