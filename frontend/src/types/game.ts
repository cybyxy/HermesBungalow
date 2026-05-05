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
  /** When set with `peer_relay_agent_id`, relay runs on the peer instance (cross-machine visitor). */
  peer_relay_base_url?: string;
  peer_relay_agent_id?: string;
  /** Present on merged peer-visitor rows from another HermesBungalow. */
  bungalow_peer_api?: number;
}

export interface GameTask {
  id: number;
  name: string;
  description?: string;
  progress: number;
  status: string;
  assignee_id?: string | null;
  is_collaborative?: boolean;
  estimated_hours?: number;
  due_at?: string;
  deliverables?: string;
  acceptance_criteria?: string;
  /** 任务目录 / 分类路径 */
  catalog?: string;
}

export interface GameRoom {
  id: string;
  name: string;
  type: string;
  agent_ids?: string[];
}

export interface PeerPresetInfo {
  id: string;
  label: string;
  base_url: string;
  relay_agent_id: string;
  has_peer_token: boolean;
}

/** PUT /api/game/peers/presets body item; omit peer_token to keep existing secret for that id. */
export type PeerPresetPayload = {
  id: string;
  label: string;
  base_url: string;
  relay_agent_id?: string;
  peer_token?: string;
};

export interface ActivePeerVisitInfo {
  preset_id: string;
  label: string;
  target_base_url: string;
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
  peer_presets?: PeerPresetInfo[];
  active_peer_visit?: ActivePeerVisitInfo | null;
}
