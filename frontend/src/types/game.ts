export type AgentRole = '城主' | '设计师' | '程序员' | '测试员' | '分析师';
export type AgentStatus = 'idle' | 'working' | 'social' | 'slacking' | 'offline';

export interface TeamAgent {
  id: string;
  name: string;
  role: AgentRole;
  status: AgentStatus;
  energy: number;
  quota: number;
  socialNeed: number;
  roleMatch: number;
}

export interface ActivityEvent {
  id: string;
  title: string;
  detail: string;
  type: 'challenge' | 'opportunity' | 'info';
  timestamp: number;
}

export type TaskType = 'design' | 'code' | 'test' | 'analyze' | 'review';

export interface TaskItem {
  id: string;
  agentId: string;
  taskType: TaskType;
  progress: number;
  status: 'queued' | 'in_progress' | 'done' | 'cancelled' | 'failed';
  priority: 1 | 2 | 3;
  rewardPoints: number;
  rewardWeek: number;
  etaSec: number;
  qualityScore: number;
  qualityBreakdown?: {
    roleMatchWeight: number;
    energyWeight: number;
    roleMatchPart: number;
    energyPart: number;
  };
}
