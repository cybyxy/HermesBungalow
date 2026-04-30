# 崽崽数字小屋 — 软件详细设计说明书

> **文档版本**：v1.0
> **项目名称**：崽崽数字小屋 UI 改造
> **关联需求文档**：`PRD-崽崽数字小屋Rimworld风格UI改造.md`（v1.0）
> **关联概要设计**：`SDD-崽崽数字小屋概要设计.md`（v1.0）
> **状态**：待开发

---

## 第一部分：核心模块

---

## 1. 游戏状态管理（Store）

### 1.1 模块概述

**文件路径**：`frontend/src/store/gameState.ts`

**职责**：作为全游戏状态的单一数据源（Single Source of Truth），管理所有游戏数据的增删改查，供 UI 组件订阅。

**技术选型**：Zustand（轻量、TypeScript 友好、Boilerplate 少）

### 1.2 Store 接口定义

```typescript
// ========== 基础类型 ==========

type AgentId = string;
type TaskId = string;
type RoomId = number | 'rest' | 'server' | 'archive' | 'meeting';
type EventId = string;
type PopupType = 'agent' | 'cityLord' | 'achievement' | 'event' | 'celebration' | 'meeting' | 'archive';

type AgentStatus = 'idle' | 'walking' | 'working' | 'reporting' | 'social' | 'chatting' | 'collaborating' | 'slacking' | 'error' | 'offline';
type Mood = 'excited' | 'positive' | 'neutral' | 'sad' | 'anxious';

interface Agent {
  id: AgentId;
  name: string;
  role: '城主' | '设计师' | '程序员' | '测试员' | '分析师';
  isMain: boolean;

  // 形象
  avatarUrl: string;
  pixelArtUrl: string;

  // 模型配置
  modelProvider: string;
  modelName: string;
  modelConfig: {
    temperature?: number;
    maxTokens?: number;
    topP?: number;
  };

  // 房间与状态
  color: string;
  status: AgentStatus;
  room: RoomId;
  homeRoom: number;
  currentTaskId: TaskId | null;

  // 养成属性
  xp: number;
  level: number;
  skillPoints: number;
  skills: {
    efficiency: number;  // 0-3
    quality: number;     // 0-3
    social: number;      // 0-3
  };

  // 需求状态 (0-100)
  energy: number;         // 饱食度
  quota: number;         // Token配额
  socialNeed: number;   // 社交需求

  // 职业匹配度 (0-100)
  roleMatch: number;

  // 关系 (agentId → 关系度)
  relationships: Record<AgentId, number>;

  // 自主交流
  dailyTokenQuota: number;
  dailyTokenUsed: number;
  isAutoChatEnabled: boolean;

  // 协作
  collaborationCount: number;
  lastCollaborationPartner: AgentId | null;

  // 情绪
  mood: Mood;
  moodValue: number;  // 0-100

  // 工作属性
  workMorale: number;  // 0-100
  confidence: number;  // 0-100

  // 杂项
  modelUsage: ModelUsage[];
  sessionId: string;
  summary: string;
}

interface CityLord {
  xp: number;
  level: number;
  skillPoints: number;
  skills: {
    incentiveSpeech: boolean;    // 激励演说
    preciseAssignment: boolean;  // 精准分配
    resourceDispatch: boolean;    // 资源调度
    inspirationGrant: boolean;   // 灵感赐予
    haloEffect: boolean;         // 光环效应
    omniscientView: boolean;     // 全知视角
  };
  skillCooldowns: Record<string, number>;  // 技能名 → 剩余冷却回合
  achievements: string[];  // 已解锁成就ID列表
}

interface Task {
  id: TaskId;
  title: string;
  description: string;
  taskType: 'design' | 'code' | 'test' | 'analyze' | 'review' | 'meeting' | 'other';
  assignedAgentId: AgentId;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  progress: number;  // 0-100
  xpReward: number;
  pointReward: number;
  createdAt: number;
  completedAt: number | null;
  parentTaskId: TaskId | null;  // 子任务关联父任务
  collaborationPartnerId: AgentId | null;  // 协作对象
}

interface GameEvent {
  id: EventId;
  eventType: 'challenge' | 'opportunity' | 'crisis';
  title: string;
  description: string;
  choices: { label: string; effect: string }[];
  triggeredAt: number;
  deadline: number | null;
  isActive: boolean;
  isResolved: boolean;
  result: 'pending' | 'accepted' | 'rejected' | 'success' | 'failed' | 'skipped';
}

interface Room {
  id: RoomId;
  name: string;
  type: 'office' | 'rest' | 'server' | 'archive' | 'meeting';
  level: number;  // 设施等级
  agentIds: AgentId[];
  isSpecialMode: boolean;  // 庆功模式/复盘模式
  specialModeType: 'celebration' | 'review' | null;
}

interface ModelUsage {
  timestamp: number;
  agentId: AgentId;
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  responseTime: number;  // ms
}

interface WeekProgress {
  weekNumber: number;
  dayOfWeek: number;  // 1-7
  tasksCompleted: number;
  tasksTarget: number;
  upgradesCompleted: number;
  upgradesTarget: number;
  reward: string;
}

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'success' | 'error' | 'auto_chat';
  title: string;
  content: string;
  agentId?: AgentId;
  timestamp: number;
  isRead: boolean;
}

interface Achievement {
  id: string;
  name: string;
  description: string;
  category: 'milestone' | 'collaboration' | 'efficiency' | 'social' | 'random' | 'cityLord';
  unlockedAt: number | null;
  progress: number;  // 0-100
}
```

### 1.3 Zustand Store 实现

```typescript
// frontend/src/store/gameState.ts

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface GameStore {
  // ===== 时间 =====
  currentTick: number;
  dayOfWeek: number;
  weekNumber: number;

  // ===== Agent 管理 =====
  agents: Record<AgentId, Agent>;
  currentAgentId: AgentId | null;
  currentSessionId: string;

  // ===== 城主 =====
  cityLord: CityLord;

  // ===== 房间 =====
  rooms: Room[];

  // ===== 任务 =====
  tasks: Record<TaskId, Task>;
  currentTaskId: TaskId | null;

  // ===== 事件 =====
  events: GameEvent[];
  activeEventId: EventId | null;

  // ===== 成就 =====
  achievements: Record<string, Achievement>;

  // ===== UI 状态 =====
  activePopup: PopupType | null;
  popupData: unknown;
  notifications: Notification[];

  // ===== 自主交流 =====
  autoChatEnabled: boolean;
  autoChatTokenLimit: number;

  // ===== 周目标 =====
  weekProgress: WeekProgress;

  // ===== 存档/读档 =====
  saveGame: () => void;
  loadGame: () => void;
  resetGame: () => void;

  // ===== Agent 操作 =====
  updateAgent: (id: AgentId, updates: Partial<Agent>) => void;
  setCurrentAgent: (id: AgentId | null) => void;
  moveAgent: (agentId: AgentId, targetRoom: RoomId) => void;

  // ===== 任务操作 =====
  createTask: (task: Omit<Task, 'id' | 'createdAt' | 'status' | 'progress'>) => TaskId;
  updateTask: (id: TaskId, updates: Partial<Task>) => void;
  completeTask: (id: TaskId) => void;

  // ===== 事件操作 =====
  triggerEvent: (event: Omit<GameEvent, 'id' | 'triggeredAt' | 'isActive' | 'isResolved' | 'result'>) => void;
  resolveEvent: (eventId: EventId, result: GameEvent['result']) => void;

  // ===== 城主操作 =====
  cityLordAddXP: (xp: number) => void;
  cityLordUseSkill: (skillName: string, targetAgentId?: AgentId) => boolean;
  cityLordUpgradeFacility: (roomId: RoomId) => boolean;

  // ===== 通知 =====
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp' | 'isRead'>) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;

  // ===== 游戏循环 =====
  tick: () => void;  // 每回合更新

  // ===== 自主交流 =====
  setAutoChatEnabled: (enabled: boolean) => void;
  setAutoChatTokenLimit: (limit: number) => void;

  // ===== 成就 =====
  unlockAchievement: (id: string) => void;
  updateAchievementProgress: (id: string, progress: number) => void;
}

const initialCityLord: CityLord = {
  xp: 0,
  level: 1,
  skillPoints: 0,
  skills: {
    incentiveSpeech: true,   // 默认解锁
    preciseAssignment: false,
    resourceDispatch: false,
    inspirationGrant: false,
    haloEffect: false,
    omniscientView: false,
  },
  skillCooldowns: {},
  achievements: [],
};

const initialWeekProgress: WeekProgress = {
  weekNumber: 1,
  dayOfWeek: 1,
  tasksCompleted: 0,
  tasksTarget: 5,
  upgradesCompleted: 0,
  upgradesTarget: 3,
  reward: '休息室L2解锁',
};

export const useGameStore = create<GameStore>()(
  subscribeWithSelector((set, get) => ({
    // ===== 初始状态 =====
    currentTick: 0,
    dayOfWeek: 1,
    weekNumber: 1,
    agents: {},
    currentAgentId: null,
    currentSessionId: '',
    cityLord: initialCityLord,
    rooms: [],
    tasks: {},
    currentTaskId: null,
    events: [],
    activeEventId: null,
    achievements: {},
    activePopup: null,
    popupData: null,
    notifications: [],
    autoChatEnabled: true,
    autoChatTokenLimit: 200,
    weekProgress: initialWeekProgress,

    // ... 方法实现见下一节
  }))
);
```

### 1.4 Store 方法实现细节

#### 1.4.1 Agent 状态更新

```typescript
updateAgent: (id, updates) => {
  set((state) => {
    const agent = state.agents[id];
    if (!agent) return state;

    const updatedAgent = { ...agent, ...updates };

    // 如果更新了能量，检查是否触发消极怠工
    if (updates.energy !== undefined && updatedAgent.energy < 20) {
      updatedAgent.status = 'slacking';
    }

    return {
      agents: { ...state.agents, [id]: updatedAgent },
    };
  });
},
```

#### 1.4.2 移动 Agent

```typescript
moveAgent: (agentId, targetRoom) => {
  set((state) => {
    const agent = state.agents[agentId];
    if (!agent) return state;

    const oldRoom = agent.room;

    // 从旧房间移除
    const updatedRooms = state.rooms.map((room) => {
      if (room.id === oldRoom) {
        return { ...room, agentIds: room.agentIds.filter((id) => id !== agentId) };
      }
      return room;
    });

    // 加入新房间
    const finalRooms = updatedRooms.map((room) => {
      if (room.id === targetRoom) {
        return { ...room, agentIds: [...room.agentIds, agentId] };
      }
      return room;
    });

    return {
      agents: {
        ...state.agents,
        [agentId]: { ...agent, room: targetRoom, status: 'idle' },
      },
      rooms: finalRooms,
    };
  });
},
```

#### 1.4.3 城主使用技能

```typescript
cityLordUseSkill: (skillName, targetAgentId) => {
  const state = get();
  const { cityLord, agents } = state;

  // 检查技能是否解锁
  if (!cityLord.skills[skillName as keyof typeof cityLord.skills]) {
    return false;
  }

  // 检查冷却
  const cooldown = cityLord.skillCooldowns[skillName];
  if (cooldown && cooldown > 0) {
    return false;
  }

  // 执行技能效果
  let newAgents = { ...agents };
  const newCooldowns = { ...cityLord.skillCooldowns };

  switch (skillName) {
    case 'incentiveSpeech':
      // 激励演说：恢复指定Agent饱食度+30
      if (targetAgentId && agents[targetAgentId]) {
        newAgents[targetAgentId] = {
          ...agents[targetAgentId],
          energy: Math.min(100, agents[targetAgentId].energy + 30),
          mood: 'positive',
          moodValue: Math.min(100, agents[targetAgentId].moodValue + 10),
        };
      }
      newCooldowns[skillName] = 3;
      break;

    case 'haloEffect':
      // 光环效应：周围Agent情绪+10，持续3回合
      Object.keys(newAgents).forEach((id) => {
        newAgents[id] = {
          ...newAgents[id],
          moodValue: Math.min(100, newAgents[id].moodValue + 10),
        };
      });
      newCooldowns[skillName] = 10;
      break;

    case 'resourceDispatch':
      // 资源调度：临时增加某Agent Token配额+50%
      if (targetAgentId && agents[targetAgentId]) {
        newAgents[targetAgentId] = {
          ...agents[targetAgentId],
          quota: Math.min(100, agents[targetAgentId].quota + 50),
        };
      }
      newCooldowns[skillName] = 5;
      break;

    case 'omniscientView':
      // 全知视角：无消耗，无冷却
      break;

    default:
      return false;
  }

  set({
    agents: newAgents,
    cityLord: {
      ...cityLord,
      skillCooldowns: newCooldowns,
    },
  });

  return true;
},
```

#### 1.4.4 游戏循环（tick）

```typescript
tick: () => {
  set((state) => {
    let newAgents = { ...state.agents };
    let newCityLord = { ...state.cityLord };
    let newNotifications = [...state.notifications];
    let newEvents = [...state.events];

    // 1. 更新技能冷却
    const newCooldowns = { ...newCityLord.skillCooldowns };
    Object.keys(newCooldowns).forEach((skill) => {
      if (newCooldowns[skill] > 0) {
        newCooldowns[skill] -= 1;
      }
    });
    newCityLord.skillCooldowns = newCooldowns;

    // 2. 遍历所有Agent，更新状态
    Object.keys(newAgents).forEach((agentId) => {
      const agent = newAgents[agentId];

      // 工作中消耗饱食度
      if (agent.status === 'working' || agent.status === 'collaborating') {
        newAgents[agentId] = {
          ...agent,
          energy: Math.max(0, agent.energy - 1),
          quota: Math.max(0, agent.quota - 2),
        };

        // 饱食度/电量耗尽检测
        if (agent.energy <= 0 || agent.quota <= 0) {
          newNotifications.push({
            id: `notif-${Date.now()}-${agentId}`,
            type: 'warning',
            title: 'Agent 能量告急',
            content: `${agent.name} 能量不足，需要休息！`,
            agentId,
            timestamp: Date.now(),
            isRead: false,
          });
        }
      }

      // 休息室恢复（每2回合恢复一次）
      if (agent.room === 'rest' && state.currentTick % 2 === 0) {
        newAgents[agentId] = {
          ...agent,
          energy: Math.min(100, agent.energy + 5),
          quota: Math.min(100, agent.quota + 3),
          socialNeed: Math.max(0, agent.socialNeed - 3),
        };
      }
    });

    // 3. 时间推进
    let newDayOfWeek = state.dayOfWeek;
    let newWeekNumber = state.weekNumber;
    if (state.currentTick > 0 && state.currentTick % 100 === 0) {
      // 每100tick代表1天
      newDayOfWeek = state.dayOfWeek + 1;
      if (newDayOfWeek > 7) {
        newDayOfWeek = 1;
        newWeekNumber += 1;
      }
    }

    // 4. 事件定时器检查
    newEvents = newEvents.map((evt) => {
      if (evt.isActive && !evt.isResolved && evt.deadline) {
        if (Date.now() > evt.deadline) {
          return { ...evt, isResolved: true, result: 'failed' as const };
        }
      }
      return evt;
    });

    return {
      currentTick: state.currentTick + 1,
      dayOfWeek: newDayOfWeek,
      weekNumber: newWeekNumber,
      agents: newAgents,
      cityLord: newCityLord,
      notifications: newNotifications,
      events: newEvents,
    };
  });
},
```

---

## 2. 游戏逻辑引擎（GameEngine）

### 2.1 模块概述

**文件路径**：`frontend/src/services/gameEngine.ts`

**职责**：封装所有游戏逻辑计算，包括效率计算、匹配度判定、情绪传染、奖励结算等。不直接操作 Store，通过返回计算结果由调用方更新 Store。

### 2.2 效率计算

```typescript
// frontend/src/services/gameEngine.ts

export interface EfficiencyResult {
  finalEfficiency: number;   // 最终效率倍率
  energyMod: number;          // 能量修正
  matchMod: number;           // 匹配度修正
  moodMod: number;            // 情绪修正
  skillMod: number;           // 技能修正
  breakdown: string;          // 详细说明
}

export function calcEfficiency(
  agent: Agent,
  task: Task
): EfficiencyResult {
  // 基础效率
  let finalEfficiency = 1.0;

  // 能量修正
  let energyMod = 1.0;
  if (agent.energy < 10) {
    energyMod = 0.3;
  } else if (agent.energy < 20) {
    energyMod = 0.5;
  } else if (agent.energy < 50) {
    energyMod = 0.8;
  }
  finalEfficiency *= energyMod;

  // 匹配度修正
  let matchMod = 1.0;
  if (agent.roleMatch >= 90) {
    matchMod = 1.3;  // +30%
  } else if (agent.roleMatch >= 60) {
    matchMod = 1.0;  // 正常
  } else if (agent.roleMatch >= 20) {
    matchMod = 0.7;  // -30%
  } else {
    matchMod = 0.4;  // -60%，触发消极怠工
  }
  finalEfficiency *= matchMod;

  // 情绪修正
  let moodMod = 1.0;
  switch (agent.mood) {
    case 'excited': moodMod = 1.2; break;
    case 'positive': moodMod = 1.1; break;
    case 'neutral': moodMod = 1.0; break;
    case 'sad': moodMod = 0.9; break;
    case 'anxious': moodMod = 0.8; break;
  }
  finalEfficiency *= moodMod;

  // 技能修正（效率型技能）
  let skillMod = 1.0;
  if (agent.skills.efficiency === 1) skillMod = 1.1;
  else if (agent.skills.efficiency === 2) skillMod = 1.2;
  else if (agent.skills.efficiency === 3) skillMod = 1.3;
  finalEfficiency *= skillMod;

  // 上限
  finalEfficiency = Math.min(finalEfficiency, 2.0);

  const breakdown = [
    `基础: ${(1.0).toFixed(1)}`,
    `能量(${agent.energy}): ${energyMod.toFixed(2)}`,
    `匹配度(${agent.roleMatch}%): ${matchMod.toFixed(2)}`,
    `情绪(${agent.mood}): ${moodMod.toFixed(2)}`,
    `技能: ${skillMod.toFixed(2)}`,
    `最终: ${finalEfficiency.toFixed(2)}`,
  ].join(' | ');

  return {
    finalEfficiency,
    energyMod,
    matchMod,
    moodMod,
    skillMod,
    breakdown,
  };
}
```

### 2.3 职业匹配度计算

```typescript
// frontend/src/services/gameEngine.ts

export type TaskType = 'design' | 'code' | 'test' | 'analyze' | 'review' | 'meeting' | 'other';
export type AgentRole = '城主' | '设计师' | '程序员' | '测试员' | '分析师';

// 任务类型与职业的匹配矩阵
const ROLE_TASK_MATCH_MATRIX: Record<AgentRole, Record<TaskType, number>> = {
  '城主': {
    design: 40, code: 30, test: 30, analyze: 50, review: 60, meeting: 80, other: 50,
  },
  '设计师': {
    design: 100, code: 20, test: 30, analyze: 40, review: 50, meeting: 50, other: 50,
  },
  '程序员': {
    design: 30, code: 100, test: 60, analyze: 50, review: 70, meeting: 50, other: 50,
  },
  '测试员': {
    design: 30, code: 50, test: 100, analyze: 60, review: 80, meeting: 50, other: 50,
  },
  '分析师': {
    design: 40, code: 30, test: 40, analyze: 100, review: 70, meeting: 60, other: 50,
  },
};

export function calcRoleMatch(
  agentRole: AgentRole,
  taskType: TaskType
): number {
  return ROLE_TASK_MATCH_MATRIX[agentRole]?.[taskType] ?? 50;
}

export function getMatchLevel(matchPercentage: number): {
  level: 'perfect' | 'good' | 'normal' | 'bad' | 'critical';
  label: string;
  efficiency: number;
  quality: number;
} {
  if (matchPercentage >= 90) {
    return { level: 'perfect', label: '完全匹配', efficiency: 1.3, quality: 1.2 };
  } else if (matchPercentage >= 60) {
    return { level: 'good', label: '基本匹配', efficiency: 1.0, quality: 1.0 };
  } else if (matchPercentage >= 20) {
    return { level: 'normal', label: '不匹配', efficiency: 0.7, quality: 0.8 };
  } else {
    return { level: 'critical', label: '严重不匹配', efficiency: 0.4, quality: 0.5 };
  }
}
```

### 2.4 情绪传染计算

```typescript
// frontend/src/services/gameEngine.ts

export interface MoodInfectionResult {
  agentId: string;
  oldMood: Mood;
  oldMoodValue: number;
  newMood: Mood;
  newMoodValue: number;
  infectionStrength: number;
  reason: string;
}

export function calcMoodInfection(
  agents: Record<string, Agent>,
  roomId: RoomId
): MoodInfectionResult[] {
  const results: MoodInfectionResult[] = [];
  const agentsInRoom = Object.values(agents).filter((a) => a.room === roomId);

  if (agentsInRoom.length < 2) return results;

  // 找出最低情绪的Agent作为"感染源"
  const sortedByMood = [...agentsInRoom].sort((a, b) => a.moodValue - b.moodValue);
  const sourceAgent = sortedByMood[0];
  const isNegativeMood = sourceAgent.mood === 'sad' || sourceAgent.mood === 'anxious';

  if (!isNegativeMood) return results;  // 只有负面情绪会传染

  // 其他Agent被传染
  for (let i = 1; i < sortedByMood.length; i++) {
    const targetAgent = sortedByMood[i];
    const infectionStrength = 0.8;  // 同房间80%传染

    const newMoodValue = Math.round(
      targetAgent.moodValue * (1 - infectionStrength) +
        sourceAgent.moodValue * infectionStrength
    );

    results.push({
      agentId: targetAgent.id,
      oldMood: targetAgent.mood,
      oldMoodValue: targetAgent.moodValue,
      newMood: sourceAgent.mood,
      newMoodValue,
      infectionStrength,
      reason: `与 ${sourceAgent.name} 同房间，情绪被传染`,
    });
  }

  return results;
}

export function determineMood(moodValue: number): Mood {
  if (moodValue >= 80) return 'excited';
  if (moodValue >= 60) return 'positive';
  if (moodValue >= 40) return 'neutral';
  if (moodValue >= 20) return 'sad';
  return 'anxious';
}
```

### 2.5 奖励结算

```typescript
// frontend/src/services/gameEngine.ts

export interface RewardResult {
  xpGained: number;
  pointGained: number;
  energyCost: number;
  quotaCost: number;
  messages: string[];
}

export function calcTaskReward(
  agent: Agent,
  task: Task,
  isCollaboration: boolean = false,
  collaborationPartnerId: string | null = null
): RewardResult {
  const efficiencyResult = calcEfficiency(agent, task);
  const efficiencyBonus = efficiencyResult.finalEfficiency;

  let baseXP = task.xpReward;
  let basePoints = task.pointReward;

  // 效率加成
  const xpGained = Math.round(baseXP * efficiencyBonus);
  const pointGained = Math.round(basePoints * efficiencyBonus);

  // 协作额外奖励
  let collaborationBonus = 1.0;
  const messages: string[] = [];

  if (isCollaboration && collaborationPartnerId) {
    const partner = Object.values(agent).find((a) => a.id === collaborationPartnerId);
    if (partner) {
      const relBonus = (agent.relationships[collaborationPartnerId] ?? 50) >= 80 ? 0.15 : 0;
      collaborationBonus = 1.3 + relBonus;  // 基础+30%，关系好额外+15%
      messages.push(`协作奖励: ${collaborationBonus.toFixed(2)}x`);
    }
  }

  const finalXP = Math.round(xpGained * collaborationBonus);
  const finalPoints = Math.round(pointGained * collaborationBonus);

  return {
    xpGained: finalXP,
    pointGained: finalPoints,
    energyCost: Math.round(10 / efficiencyBonus),  // 效率越高，能量消耗越少
    quotaCost: Math.round(20 / efficiencyBonus),
    messages: [
      `任务完成: ${task.title}`,
      `XP: ${baseXP} × ${efficiencyBonus.toFixed(2)} = ${xpGained}` + (isCollaboration ? ` × ${collaborationBonus.toFixed(2)} = ${finalXP}` : ''),
      `积分: ${basePoints} → ${finalPoints}`,
      `效率评级: ${efficiencyResult.breakdown}`,
      ...messages,
    ],
  };
}
```

### 2.6 升级判定

```typescript
// frontend/src/services/gameEngine.ts

export interface LevelUpResult {
  didLevelUp: boolean;
  oldLevel: number;
  newLevel: number;
  xpRequired: number;
  skillPointsGained: number;
}

export function checkLevelUp(agent: Agent): LevelUpResult {
  const xpRequired = agent.level * 100;
  const result: LevelUpResult = {
    didLevelUp: false,
    oldLevel: agent.level,
    newLevel: agent.level,
    xpRequired,
    skillPointsGained: 0,
  };

  if (agent.xp >= xpRequired) {
    result.didLevelUp = true;
    result.newLevel = agent.level + 1;
    result.skillPointsGained = 1;  // 每级获得1点技能点
  }

  return result;
}

export function checkCityLordLevelUp(cityLord: CityLord): LevelUpResult {
  const xpRequired = cityLord.level * 200;  // 城主XP需求是Agent的2倍

  const result: LevelUpResult = {
    didLevelUp: false,
    oldLevel: cityLord.level,
    newLevel: cityLord.level,
    xpRequired,
    skillPointsGained: 0,
  };

  if (cityLord.xp >= xpRequired) {
    result.didLevelUp = true;
    result.newLevel = cityLord.level + 1;
    result.skillPointsGained = 1;
  }

  return result;
}

// 城主等级解锁技能
const CITY_LORD_SKILL_UNLOCK: Record<number, (keyof CityLord['skills'])[]> = {
  2: ['preciseAssignment'],
  3: ['resourceDispatch'],
  4: ['inspirationGrant'],
  5: ['haloEffect'],
  6: ['omniscientView'],
};

export function getUnlockedSkills(level: number): (keyof CityLord['skills'])[] {
  const unlocked: (keyof CityLord['skills'])[] = ['incentiveSpeech'];  // 默认技能
  for (let l = 2; l <= level; l++) {
    unlocked.push(...(CITY_LORD_SKILL_UNLOCK[l] ?? []));
  }
  return unlocked;
}
```

---

## 3. WebSocket 服务

### 3.1 模块概述

**文件路径**：`frontend/src/services/websocket.ts`

**职责**：封装 WebSocket 客户端，处理与 Hermes Gateway 的连接、消息收发、断线重连。

### 3.2 WebSocket 客户端实现

```typescript
// frontend/src/services/websocket.ts

type MessageHandler = (message: WSMessage) => void;

interface WSMessage {
  type: 'agent_update' | 'task_update' | 'event' | 'chat' | 'system' | 'auto_chat' | 'achievement';
  payload: unknown;
  timestamp: number;
  source: string;
}

class HermesWebSocket {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Map<string, Set<MessageHandler>> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatInterval: number | null = null;
  private isIntentionalClose = false;

  constructor(url: string = 'ws://localhost:8000') {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.isIntentionalClose = false;

        this.ws.onopen = () => {
          console.log('[WS] Connected to Hermes Gateway');
          this.reconnectAttempts = 0;
          this.startHeartbeat();
          this.emit('system', {
            type: 'connected',
            message: '已连接到服务器',
            timestamp: Date.now(),
          });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message: WSMessage = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (err) {
            console.error('[WS] Failed to parse message:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          this.emit('system', {
            type: 'error',
            message: 'WebSocket 连接错误',
            timestamp: Date.now(),
          });
        };

        this.ws.onclose = (event) => {
          console.log(`[WS] Closed: ${event.code} ${event.reason}`);
          this.stopHeartbeat();

          if (!this.isIntentionalClose) {
            this.emit('system', {
              type: 'disconnected',
              message: '与服务器断开连接',
              timestamp: Date.now(),
            });
            this.attemptReconnect();
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    this.isIntentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type: string, payload: unknown): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WS] Cannot send, not connected');
      return;
    }

    const message: WSMessage = {
      type: type as WSMessage['type'],
      payload,
      timestamp: Date.now(),
      source: 'frontend',
    };

    this.ws.send(JSON.stringify(message));
  }

  on(type: string, handler: MessageHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);

    // 返回取消订阅函数
    return () => {
      this.handlers.get(type)?.delete(handler);
    };
  }

  off(type: string, handler: MessageHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  private handleMessage(message: WSMessage): void {
    // 触发对应类型的处理器
    this.emit(message.type, message);

    // 触发 'all' 类型处理器
    this.emit('all', message);
  }

  private emit(type: string, message: WSMessage): void {
    const handlers = this.handlers.get(type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message);
        } catch (err) {
          console.error(`[WS] Handler error for ${type}:`, err);
        }
      });
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = window.setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send('heartbeat', { timestamp: Date.now() });
      }
    }, 30000);  // 30秒心跳
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval !== null) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnect attempts reached');
      this.emit('system', {
        type: 'reconnect_failed',
        message: '重连失败，请刷新页面',
        timestamp: Date.now(),
      });
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch((err) => {
        console.error('[WS] Reconnect failed:', err);
      });
    }, delay);
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// 单例导出
export const wsService = new HermesWebSocket();

// ===== 便捷方法 =====

export function wsSendTaskAssign(agentId: string, taskId: string): void {
  wsService.send('assign_task', { agentId, taskId });
}

export function wsSendMoveAgent(agentId: string, targetRoom: string): void {
  wsService.send('move_agent', { agentId, targetRoom });
}

export function wsSendChat(content: string, agentId?: string): void {
  wsService.send('chat', { content, agentId });
}

export function wsSendSkillUse(skillName: string, targetAgentId?: string): void {
  wsService.send('use_skill', { skillName, targetAgentId });
}

export function wsSendEventChoice(eventId: string, choice: number): void {
  wsService.send('event_choice', { eventId, choice });
}
```

---

## 第二部分：UI 组件模块

---

## 4. ActivitySpace（中央活动空间）

### 4.1 模块概述

**文件路径**：`frontend/src/ui/ActivitySpace/ActivitySpace.tsx`

**职责**：渲染 13 格房间布局（9间办公室 + 休息室 + 机房 + 资料室 + 会议室），管理 Agent 在各房间的显示。

### 4.2 组件结构

```
ActivitySpace
├── .activity-space (13格网格容器)
│   ├── Row 1: Office × 5 (办1-5)
│   ├── Row 2: Office × 4 + RestRoom
│   └── Row 3: ServerRoom + ArchiveRoom + MeetingRoom
└── AgentSprite × N (Agent精灵，absolute定位)
```

### 4.3 组件 Props 与 State

```typescript
// frontend/src/ui/ActivitySpace/ActivitySpace.tsx

interface ActivitySpaceProps {
  className?: string;
}

interface RoomCellProps {
  room: Room;
  agents: Agent[];
  onAgentClick: (agentId: string) => void;
  onRoomClick: (roomId: RoomId) => void;
}

interface AgentSpriteProps {
  agent: Agent;
  room: Room;
  onClick: (agentId: string) => void;
}

// 组件内部 state
interface ActivitySpaceState {
  hoveredAgentId: string | null;
  selectedAgentId: string | null;
  agentAnimations: Record<string, 'idle' | 'walk' | 'work' | 'slacking'>;
}
```

### 4.4 核心实现逻辑

```typescript
// ActivitySpace.tsx

export const ActivitySpace: React.FC<ActivitySpaceProps> = ({ className }) => {
  const agents = useGameStore((s) => s.agents);
  const rooms = useGameStore((s) => s.rooms);
  const currentTick = useGameStore((s) => s.currentTick);

  const [hoveredAgentId, setHoveredAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // 计算Agent动画状态
  const getAgentAnimation = (agent: Agent): string => {
    switch (agent.status) {
      case 'walking': return 'walk';
      case 'slacking': return 'slacking';
      case 'working':
      case 'collaborating':
        return 'work';
      default:
        return 'idle';
    }
  };

  // Agent点击处理
  const handleAgentClick = (agentId: string) => {
    setSelectedAgentId(agentId);
    useGameStore.getState().setCurrentAgent(agentId);
    useGameStore.getState().updateUI('agent', agentId);  // 打开弹窗
  };

  // 房间点击处理
  const handleRoomClick = (roomId: RoomId) => {
    const room = rooms.find((r) => r.id === roomId);
    if (!room) return;

    // 特殊房间打开对应面板
    if (roomId === 'archive') {
      useGameStore.getState().updateUI('archive', null);
    } else if (roomId === 'meeting') {
      // 会议室暂不主动打开，等复盘触发
    }
  };

  return (
    <div className={`activity-space ${className ?? ''}`}>
      {/* 网格布局 */}
      <div className="grid grid-cols-5 gap-1 p-2">
        {/* Row 1: 5间办公室 */}
        {rooms.filter(r => typeof r.id === 'number').slice(0, 5).map((room) => (
          <RoomCell
            key={room.id}
            room={room}
            agents={Object.values(agents).filter(a => a.room === room.id)}
            onAgentClick={handleAgentClick}
            onRoomClick={handleRoomClick}
          />
        ))}

        {/* Row 2: 4间办公室 + 休息室 */}
        {rooms.filter(r => typeof r.id === 'number').slice(5, 9).map((room) => (
          <RoomCell
            key={room.id}
            room={room}
            agents={Object.values(agents).filter(a => a.room === room.id)}
            onAgentClick={handleAgentClick}
            onRoomClick={handleRoomClick}
          />
        ))}
        <RoomCell
          key="rest"
          room={rooms.find(r => r.id === 'rest')!}
          agents={Object.values(agents).filter(a => a.room === 'rest')}
          onAgentClick={handleAgentClick}
          onRoomClick={handleRoomClick}
        />

        {/* Row 3: 机房 + 资料室 + 会议室 */}
        <RoomCell
          key="server"
          room={rooms.find(r => r.id === 'server')!}
          agents={[]}
          onAgentClick={handleAgentClick}
          onRoomClick={handleRoomClick}
        />
        <RoomCell
          key="archive"
          room={rooms.find(r => r.id === 'archive')!}
          agents={[]}
          onAgentClick={handleAgentClick}
          onRoomClick={handleRoomClick}
        />
        <RoomCell
          key="meeting"
          room={rooms.find(r => r.id === 'meeting')!}
          agents={[]}
          onAgentClick={handleAgentClick}
          onRoomClick={handleRoomClick}
        />
      </div>

      {/* Agent精灵层（absolute定位，实现移动动画） */}
      <div className="agent-sprite-layer absolute inset-0 pointer-events-none">
        {Object.values(agents).map((agent) => (
          <AgentSprite
            key={agent.id}
            agent={agent}
            room={rooms.find(r => r.id === agent.room)!}
            animation={getAgentAnimation(agent)}
            onClick={() => handleAgentClick(agent.id)}
            isHovered={agent.id === hoveredAgentId}
            isSelected={agent.id === selectedAgentId}
          />
        ))}
      </div>
    </div>
  );
};
```

### 4.5 RoomCell 实现

```typescript
// frontend/src/ui/ActivitySpace/components/RoomCell.tsx

export const RoomCell: React.FC<RoomCellProps> = ({
  room,
  agents,
  onAgentClick,
  onRoomClick,
}) => {
  const isSpecialMode = room.isSpecialMode;
  const modeType = room.specialModeType;

  const getRoomIcon = () => {
    switch (room.type) {
      case 'office': return '🏠';
      case 'rest': return '🛋️';
      case 'server': return '🖥️';
      case 'archive': return '📚';
      case 'meeting': return '🏛️';
      default: return '⬜';
    }
  };

  const getRoomBorderClass = () => {
    if (isSpecialMode) {
      if (modeType === 'celebration') return 'border-yellow-400 border-2 shadow-lg shadow-yellow-400/30';
      if (modeType === 'review') return 'border-blue-400 border-2 shadow-lg shadow-blue-400/30';
    }
    return 'border-[var(--border-dark)]';
  };

  return (
    <div
      className={`
        room-cell relative h-20 rounded-sm overflow-hidden
        bg-[var(--bg-panel)] cursor-pointer
        border border-solid ${getRoomBorderClass()}
        transition-all duration-200 hover:border-[var(--border-light)]
        ${isSpecialMode ? 'animate-pulse' : ''}
      `}
      onClick={() => onRoomClick(room.id)}
    >
      {/* 房间名称 */}
      <div className="absolute top-0 left-0 right-0 px-1 py-0.5 bg-black/30 text-[10px] text-[var(--text-secondary)] truncate">
        {isSpecialMode && modeType === 'celebration' && '🎉 '}
        {isSpecialMode && modeType === 'review' && '📋 '}
        {room.name}
        {room.level > 1 && <span className="ml-1 text-[var(--accent-warm)]">Lv{room.level}</span>}
      </div>

      {/* Agent头像列表 */}
      <div className="absolute bottom-1 left-1 right-1 flex gap-0.5 flex-wrap">
        {agents.slice(0, 3).map((agent) => (
          <button
            key={agent.id}
            className={`
              agent-mini-avatar w-5 h-5 rounded-full overflow-hidden
              border-2 transition-transform hover:scale-110
              pointer-events-auto
              ${agent.isMain ? 'border-[var(--zaizai-gold)]' : 'border-[var(--border-dark)]'}
            `}
            onClick={(e) => {
              e.stopPropagation();
              onAgentClick(agent.id);
            }}
          >
            <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
          </button>
        ))}
        {agents.length > 3 && (
          <span className="text-[8px] text-[var(--text-muted)]">+{agents.length - 3}</span>
        )}
      </div>

      {/* 房间图标（无Agent时显示） */}
      {agents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-2xl opacity-30">
          {getRoomIcon()}
        </div>
      )}
    </div>
  );
};
```

### 4.6 AgentSprite 实现

```typescript
// frontend/src/ui/ActivitySpace/components/AgentSprite.tsx

export const AgentSprite: React.FC<AgentSpriteProps> = ({
  agent,
  room,
  animation,
  onClick,
  isHovered,
  isSelected,
}) => {
  // 根据房间计算位置
  const getRoomPosition = (room: Room): { x: number; y: number } => {
    // 这是一个简化的位置计算
    // 实际需要根据13格布局的精确坐标计算
    const positions: Record<string, { x: number; y: number }> = {
      '1': { x: 10, y: 10 },
      '2': { x: 25, y: 10 },
      // ... 其他房间
    };
    return positions[String(room.id)] ?? { x: 50, y: 50 };
  };

  const position = getRoomPosition(room);

  // 计算像素偏移（让多个Agent在同一房间不重叠）
  const agentIndex = room.agentIds.indexOf(agent.id);
  const offsetX = (agentIndex % 2) * 8;
  const offsetY = Math.floor(agentIndex / 2) * 8;

  const getAnimationClass = () => {
    switch (animation) {
      case 'walk': return 'animate-bounce';
      case 'work': return 'animate-pulse';
      case 'slacking': return 'opacity-50 grayscale';
      default: return '';
    }
  };

  const getMoodEmoji = () => {
    switch (agent.mood) {
      case 'excited': return '😄';
      case 'positive': return '😊';
      case 'neutral': return '😐';
      case 'sad': return '😔';
      case 'anxious': return '😤';
    }
  };

  return (
    <div
      className={`
        agent-sprite absolute pointer-events-auto cursor-pointer
        transition-all duration-300 ease-out
        ${isHovered ? 'z-20 scale-110' : 'z-10'}
        ${isSelected ? 'z-30 ring-2 ring-[var(--accent-warm)]' : ''}
        ${getAnimationClass()}
      `}
      style={{
        left: `${position.x + offsetX}%`,
        top: `${position.y + offsetY}%`,
        transform: 'translate(-50%, -50%)',
      }}
      onClick={onClick}
    >
      {/* 头像框 */}
      <div
        className={`
          relative w-10 h-10 rounded-full overflow-hidden
          border-2 shadow-md
          ${agent.isMain ? 'border-[var(--zaizai-gold)] shadow-[var(--zaizai-gold)]/30' : 'border-[var(--border-light)]'}
        `}
      >
        <img
          src={agent.avatarUrl}
          alt={agent.name}
          className="w-full h-full object-cover"
        />

        {/* 状态指示器 */}
        {agent.status === 'slacking' && (
          <span className="absolute -top-1 -right-1 text-xs">😤</span>
        )}
        {agent.status === 'working' && (
          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 text-[8px] animate-ping">⚡</span>
        )}
      </div>

      {/* 情绪指示 */}
      <div
        className="absolute -top-1 left-1/2 -translate-x-1/2 text-xs"
        title={`${agent.name}: ${agent.mood}`}
      >
        {getMoodEmoji()}
      </div>

      {/* 名字标签 */}
      <div
        className={`
          absolute top-full left-1/2 -translate-x-1/2 mt-0.5
          text-[9px] text-[var(--text-primary)] whitespace-nowrap
          bg-black/60 px-1 rounded
          ${agent.isMain ? 'text-[var(--zaizai-gold)] font-bold' : ''}
        `}
      >
        {agent.name}
      </div>
    </div>
  );
};
```

---

## 5. AgentPopup（Agent详情弹窗）

### 5.1 模块概述

**文件路径**：`frontend/src/ui/Popups/AgentPopup.tsx`

**职责**：点击 Agent 头像时弹出详情弹窗，展示 Agent 的完整信息，共 5 个标签页。

### 5.2 弹窗结构

```
AgentPopup (Portal渲染)
├── .popup-overlay (点击外部关闭)
├── .popup-container
│   ├── .popup-header
│   │   ├── Avatar (大头像 + 边框)
│   │   ├── BasicInfo (名字/职业/状态)
│   │   └── CloseButton
│   ├── .popup-tabs (5个标签)
│   │   ├── 📋 基本信息
│   │   ├── 📁 核心文件
│   │   ├── ⚙️ 模型配置
│   │   ├── 🛠️ 技能系统
│   │   └── 🌐 网关配置
│   └── .popup-content (标签页内容)
```

### 5.3 组件 Props

```typescript
// frontend/src/ui/Popups/AgentPopup.tsx

type TabId = 'basic' | 'files' | 'model' | 'skills' | 'gateway';

interface AgentPopupProps {
  agentId: AgentId;
  defaultTab?: TabId;
  onClose: () => void;
}

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
  badge?: string;  // 可选的通知数字
}
```

### 5.4 核心实现

```typescript
// AgentPopup.tsx

const TABS: TabConfig[] = [
  { id: 'basic', label: '基本信息', icon: '📋' },
  { id: 'files', label: '核心文件', icon: '📁' },
  { id: 'model', label: '模型配置', icon: '⚙️' },
  { id: 'skills', label: '技能系统', icon: '🛠️' },
  { id: 'gateway', label: '网关配置', icon: '🌐' },
];

export const AgentPopup: React.FC<AgentPopupProps> = ({
  agentId,
  defaultTab = 'basic',
  onClose,
}) => {
  const agent = useGameStore((s) => s.agents[agentId]);
  const [activeTab, setActiveTab] = useState<TabId>(defaultTab);

  if (!agent) return null;

  const isZaiZai = agent.isMain;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div className="agent-popup w-[780px] max-h-[85vh] bg-[var(--bg-surface)] border-2 border-[var(--border-light)] rounded-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="popup-header flex items-center gap-4 p-4 border-b border-[var(--border-dark)]">
          {/* Avatar */}
          <div
            className={`
              relative w-16 h-16 rounded-full overflow-hidden border-2
              ${isZaiZai
                ? 'border-[var(--zaizai-gold)] shadow-[0_0_12px_var(--zaizai-gold)]'
                : 'border-[var(--border-light)]'}
            `}
          >
            <img src={agent.avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
            {isZaiZai && <span className="absolute -top-1 -right-1 text-sm">⭐</span>}
          </div>

          {/* Basic Info */}
          <div className="flex-1">
            <h2 className={`text-lg font-bold ${isZaiZai ? 'text-[var(--zaizai-gold)]' : 'text-[var(--text-primary)]'}`}>
              {agent.name}
            </h2>
            <p className="text-sm text-[var(--text-secondary)]">
              {agent.role} · Lv.{agent.level}
            </p>
            <div className="flex items-center gap-2 mt-1">
              <StatusBadge status={agent.status} />
              <MoodBadge mood={agent.mood} />
            </div>
          </div>

          {/* Close Button */}
          <button
            className="w-8 h-8 flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] rounded transition-colors"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="popup-tabs flex border-b border-[var(--border-dark)] bg-[var(--bg-panel)]">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`
                tab-button flex-1 py-2.5 px-3 text-sm font-medium transition-colors relative
                ${activeTab === tab.id
                  ? 'text-[var(--accent-warm)] bg-[var(--bg-surface)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]'}
              `}
              onClick={() => setActiveTab(tab.id)}
            >
              <span>{tab.icon} {tab.label}</span>
              {tab.badge && (
                <span className="absolute top-1 right-2 w-4 h-4 bg-[var(--accent-red)] text-white text-[10px] rounded-full flex items-center justify-center">
                  {tab.badge}
                </span>
              )}
              {activeTab === tab.id && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--accent-warm)]" />
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="popup-content flex-1 overflow-y-auto p-4">
          {activeTab === 'basic' && <BasicInfoTab agent={agent} />}
          {activeTab === 'files' && <CoreFilesTab agent={agent} />}
          {activeTab === 'model' && <ModelConfigTab agent={agent} />}
          {activeTab === 'skills' && <SkillsTab agent={agent} />}
          {activeTab === 'gateway' && <GatewayTab agent={agent} />}
        </div>
      </div>
    </div>,
    document.body
  );
};
```

### 5.5 标签页内容实现

#### 5.5.1 基本信息标签页

```typescript
// BasicInfoTab.tsx

const BasicInfoTab: React.FC<{ agent: Agent }> = ({ agent }) => {
  return (
    <div className="space-y-4">
      {/* 简介 */}
      <div className="bg-[var(--bg-elevated)] p-3 rounded border border-[var(--border-dark)]">
        <p className="text-sm italic text-[var(--text-secondary)]">
          {agent.summary || '暂无简介'}
        </p>
      </div>

      {/* 基本信息表 */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <InfoRow label="Agent ID" value={agent.id} />
        <InfoRow label="职业类型" value={agent.role} />
        <InfoRow label="所属房间" value={String(agent.room)} />
        <InfoRow label="当前状态">
          <StatusBadge status={agent.status} />
        </InfoRow>
        <InfoRow label="当前任务" value={agent.currentTaskId ?? '无'} />
        <InfoRow label="职业匹配度">
          <RoleMatchBar value={agent.roleMatch} />
        </InfoRow>
      </div>

      {/* 需求条 */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium text-[var(--text-secondary)]">需求状态</h4>
        <NeedsBar label="饱食度" value={agent.energy} icon="🍖" />
        <NeedsBar label="电量" value={agent.quota} icon="⚡" />
        <NeedsBar label="社交" value={agent.socialNeed} icon="💬" />
      </div>

      {/* 行动按钮 */}
      <div className="flex gap-2 pt-2">
        <button className="action-btn primary">分配任务</button>
        <button className="action-btn">进入房间</button>
        <button className="action-btn">开始对话</button>
        <button className="action-btn">设置</button>
      </div>
    </div>
  );
};

// 子组件
const InfoRow: React.FC<{ label: string; value?: React.ReactNode; children?: React.ReactNode }> = ({
  label,
  value,
  children,
}) => (
  <div className="flex justify-between items-center py-1 border-b border-[var(--border-dark)]">
    <span className="text-[var(--text-muted)]">{label}</span>
    <span className="text-[var(--text-primary)]">
      {children ?? value ?? '-'}
    </span>
  </div>
);

const StatusBadge: React.FC<{ status: AgentStatus }> = ({ status }) => {
  const config: Record<AgentStatus, { label: string; color: string }> = {
    idle: { label: '空闲', color: 'bg-[var(--accent-green)]' },
    working: { label: '工作中', color: 'bg-[var(--accent-blue)]' },
    walking: { label: '移动中', color: 'bg-[var(--accent-warm)]' },
    social: { label: '社交中', color: 'bg-pink-500' },
    chatting: { label: '交流中', color: 'bg-purple-500' },
    collaborating: { label: '协作中', color: 'bg-indigo-500' },
    reporting: { label: '汇报中', color: 'bg-[var(--accent-warm)]' },
    slacking: { label: '消极怠工', color: 'bg-[var(--accent-red)]' },
    error: { label: '错误', color: 'bg-red-600' },
    offline: { label: '离线', color: 'bg-gray-600' },
  };

  const { label, color } = config[status];

  return (
    <span className={`px-2 py-0.5 text-xs rounded-full text-white ${color}`}>
      {label}
    </span>
  );
};

const NeedsBar: React.FC<{ label: string; value: number; icon: string }> = ({
  label,
  value,
  icon,
}) => {
  const getColor = () => {
    if (value >= 60) return 'var(--accent-green)';
    if (value >= 30) return 'var(--accent-warm)';
    return 'var(--accent-red)';
  };

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm w-16">{icon} {label}</span>
      <div className="flex-1 h-2 bg-[var(--bg-base)] rounded-full overflow-hidden">
        <div
          className="h-full transition-all duration-300 rounded-full"
          style={{ width: `${value}%`, backgroundColor: getColor() }}
        />
      </div>
      <span className="text-xs w-8 text-right">{value}%</span>
    </div>
  );
};
```

---

## 第三部分：Hooks 与工具函数

---

## 6. useGameLoop Hook

### 6.1 模块概述

**文件路径**：`frontend/src/hooks/useGameLoop.ts`

**职责**：管理游戏主循环，定时触发 tick() 更新游戏状态。

### 6.2 实现

```typescript
// frontend/src/hooks/useGameLoop.ts

import { useEffect, useRef } from 'react';
import { useGameStore } from '../store/gameState';

const TICK_INTERVAL = 2000;  // 2秒一个回合

export function useGameLoop() {
  const tick = useGameStore((s) => s.tick);
  const isRunningRef = useRef(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunningRef.current) return;

    isRunningRef.current = true;
    console.log('[GameLoop] Started');

    intervalRef.current = window.setInterval(() => {
      tick();
    }, TICK_INTERVAL);

    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      isRunningRef.current = false;
      console.log('[GameLoop] Stopped');
    };
  }, [tick]);
}
```

---

## 7. useAutoChat Hook

### 7.1 模块概述

**文件路径**：`frontend/src/hooks/useAutoChat.ts`

**职责**：管理 Agent 自主交流的触发、Token 消耗、消息展示。

### 7.2 实现

```typescript
// frontend/src/hooks/useAutoChat.ts

import { useEffect, useCallback } from 'react';
import { useGameStore } from '../store/gameState';
import { calcRoleMatch } from '../services/gameEngine';

interface AutoChatCandidate {
  fromAgentId: string;
  toAgentId: string;
  chatType: 'idle_chat' | 'topic_chat' | 'relationship_chat' | 'question';
  estimatedTokenCost: number;
  priority: number;  // 优先级，越高越先执行
}

export function useAutoChat() {
  const agents = useGameStore((s) => s.agents);
  const autoChatEnabled = useGameStore((s) => s.autoChatEnabled);
  const autoChatTokenLimit = useGameStore((s) => s.autoChatTokenLimit);
  const addNotification = useGameStore((s) => s.addNotification);
  const updateAgent = useGameStore((s) => s.updateAgent);
  const tick = useGameStore((s) => s.currentTick);

  // 检测是否可以自主交流
  const canAutoChat = useCallback((agentId: string): boolean => {
    const agent = agents[agentId];
    if (!agent) return false;
    if (!autoChatEnabled) return false;
    if (!agent.isAutoChatEnabled) return false;
    if (agent.status !== 'idle' && agent.status !== 'social') return false;
    if (agent.dailyTokenUsed >= agent.dailyTokenQuota) return false;
    return true;
  }, [agents, autoChatEnabled]);

  // 寻找可交流的Agent对
  const findChatCandidates = useCallback((): AutoChatCandidate[] => {
    const candidates: AutoChatCandidate[] = [];
    const agentList = Object.values(agents).filter((a) => canAutoChat(a.id));

    for (let i = 0; i < agentList.length; i++) {
      for (let j = i + 1; j < agentList.length; j++) {
        const agentA = agentList[i];
        const agentB = agentList[j];

        // 检查关系
        const relAtoB = agentA.relationships[agentB.id] ?? 50;
        const relBtoA = agentB.relationships[agentA.id] ?? 50;
        const avgRel = (relAtoB + relBtoA) / 2;

        // 判断交流类型
        let chatType: AutoChatCandidate['chatType'] = 'idle_chat';
        let priority = 1;
        let tokenCost = 50;

        if (avgRel >= 80) {
          // 关系好，闲聊
          chatType = 'relationship_chat';
          priority = 2;
          tokenCost = 30;
        } else if (avgRel >= 50 && Math.random() < 0.3) {
          // 关系一般，有概率闲聊
          chatType = 'idle_chat';
          priority = 1;
          tokenCost = 50;
        }

        // 如果两个Agent都在idle，且房间相邻
        if (
          agentA.room === agentB.room &&
          agentA.status === 'idle' &&
          agentB.status === 'idle'
        ) {
          priority += 1;
          tokenCost += 20;
        }

        candidates.push({
          fromAgentId: agentA.id,
          toAgentId: agentB.id,
          chatType,
          estimatedTokenCost: tokenCost,
          priority,
        });

        candidates.push({
          fromAgentId: agentB.id,
          toAgentId: agentA.id,
          chatType,
          estimatedTokenCost: tokenCost,
          priority,
        });
      }
    }

    // 按优先级排序
    return candidates.sort((a, b) => b.priority - a.priority);
  }, [agents, canAutoChat]);

  // 执行自主交流
  const executeAutoChat = useCallback((candidate: AutoChatCandidate) => {
    const { fromAgentId, toAgentId, chatType, estimatedTokenCost } = candidate;

    // 更新Token消耗
    updateAgent(fromAgentId, {
      dailyTokenUsed: agents[fromAgentId].dailyTokenUsed + estimatedTokenCost,
      status: 'chatting',
    });

    // 生成消息内容
    const chatMessages: Record<AutoChatCandidate['chatType'], string[]> = {
      idle_chat: [
        '最近工作怎么样？',
        '要不要休息一下？',
        '那个项目的需求有点模糊啊',
      ],
      topic_chat: [
        '我刚想到一个设计灵感！',
        '这个bug我之前遇到过',
        '让我查一下数据',
      ],
      relationship_chat: [
        '合作真愉快！',
        '我们的默契越来越好了',
        '下次还找你配合~',
      ],
      question: [
        '这个问题你能帮我看看吗？',
        '这个方案你觉得怎么样？',
      ],
    };

    const messages = chatMessages[chatType];
    const message = messages[Math.floor(Math.random() * messages.length)];

    // 添加通知
    addNotification({
      type: 'auto_chat',
      title: `${agents[fromAgentId].name} → ${agents[toAgentId].name}`,
      content: `${chatType === 'relationship_chat' ? '💬' : chatType === 'question' ? '❓' : '💡'} ${message}`,
      agentId: fromAgentId,
    });

    // 更新关系度（增加）
    const currentRel = agents[fromAgentId].relationships[toAgentId] ?? 50;
    updateAgent(fromAgentId, {
      relationships: {
        ...agents[fromAgentId].relationships,
        [toAgentId]: Math.min(100, currentRel + 2),
      },
    });

    console.log(`[AutoChat] ${agents[fromAgentId].name} → ${agents[toAgentId].name}: ${message}`);
  }, [agents, addNotification, updateAgent]);

  // 每tick执行一次检测
  useEffect(() => {
    if (!autoChatEnabled) return;

    const candidates = findChatCandidates();
    if (candidates.length === 0) return;

    // 随机选择一个候选执行（按概率）
    for (const candidate of candidates) {
      if (Math.random() < 0.15) {  // 15%概率触发
        executeAutoChat(candidate);
        break;
      }
    }
  }, [tick, autoChatEnabled, findChatCandidates, executeAutoChat]);

  // 手动控制
  const enableAutoChat = useCallback(() => {
    useGameStore.getState().setAutoChatEnabled(true);
  }, []);

  const disableAutoChat = useCallback(() => {
    useGameStore.getState().setAutoChatEnabled(false);
  }, []);

  return {
    isEnabled: autoChatEnabled,
    tokenLimit: autoChatTokenLimit,
    enableAutoChat,
    disableAutoChat,
  };
}
```

---

## 8. 工具函数库

### 8.1 常量定义

```typescript
// frontend/src/utils/constants.ts

export const GAME_TICK_INTERVAL = 2000;  // ms

export const ROOM_IDS = {
  OFFICE_START: 1,
  OFFICE_COUNT: 9,
  REST: 'rest',
  SERVER: 'server',
  ARCHIVE: 'archive',
  MEETING: 'meeting',
} as const;

export const MAX_AGENTS = 9;

export const SKILL_MAX_LEVEL = 3;

export const CITY_LORD_MAX_LEVEL = 6;

export const MATCH_THRESHOLDS = {
  PERFECT: 90,
  GOOD: 60,
  NORMAL: 20,
} as const;

export const MOOD_THRESHOLDS = {
  EXCITED: 80,
  POSITIVE: 60,
  NEUTRAL: 40,
  SAD: 20,
} as const;

export const RELATIONSHIP_THRESHOLDS = {
  BEST_FRIEND: 80,
  FRIEND: 50,
  ACQUAINTANCE: 20,
} as const;

export const AUTO_CHAT_TOKEN_LIMIT_DEFAULT = 200;

export const WEEKLY_TASK_TARGET = 5;
export const WEEKLY_UPGRADE_TARGET = 3;
```

### 8.2 数学计算工具

```typescript
// frontend/src/utils/math.ts

/**
 * 计算百分比
 */
export function percentage(value: number, total: number, decimals = 0): number {
  if (total === 0) return 0;
  return Number((value / total * 100).toFixed(decimals));
}

/**
 * 限制数值在范围内
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 平滑插值（用于动画）
 */
export function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

/**
 * 生成随机整数 [min, max]
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 格式化数字（添加千位分隔符）
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

/**
 * 格式化时间戳为 HH:mm:ss
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
```

### 8.3 文本处理工具

```typescript
// frontend/src/utils/text.ts

/**
 * 打字机效果
 */
export function typeWriter(
  text: string,
  speed = 50,
  onChar?: (char: string, index: number) => void
): () => void {
  let i = 0;
  const timer = setInterval(() => {
    if (i < text.length) {
      onChar?.(text.charAt(i), i);
      i++;
    } else {
      clearInterval(timer);
    }
  }, speed);

  return () => clearInterval(timer);
}

/**
 * 截断文本并添加省略号
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * 高亮关键词
 */
export function highlightKeyword(text: string, keyword: string): string {
  if (!keyword) return text;
  const regex = new RegExp(`(${keyword})`, 'gi');
  return text.replace(regex, '<mark>$1</mark>');
}
```

---

## 第四部分：数据字典

---

## 9. 数据字典

### 9.1 Agent 状态枚举

| 状态值 | 显示名 | 说明 | 动画 |
|--------|--------|------|------|
| `idle` | 空闲 | Agent待命，可接受任务 | 无 |
| `walking` | 移动中 | Agent正在移动到目标房间 | bounce |
| `working` | 工作中 | Agent正在执行任务 | pulse |
| `reporting` | 汇报中 | Agent完成任务后汇报 | 无 |
| `social` | 社交中 | Agent在休息室互动 | 无 |
| `chatting` | 交流中 | Agent参与自主交流 | 无 |
| `collaborating` | 协作中 | Agent与其他Agent协作 | pulse |
| `slacking` | 消极怠工 | 匹配度<20% | grayscale |
| `error` | 错误 | 发生异常 | 无 |
| `offline` | 离线 | Agent不在线 | 无 |

### 9.2 情绪枚举

| 情绪值 | 显示名 | Emoji | 效果 | 触发条件 |
|--------|--------|-------|------|----------|
| `excited` | 兴奋 | 😄 | 效率+20% | 情绪值≥80 |
| `positive` | 积极 | 😊 | 效率+10% | 情绪值60-79 |
| `neutral` | 平静 | 😐 | 无 | 情绪值40-59 |
| `sad` | 低落 | 😔 | 效率-10% | 情绪值20-39 |
| `anxious` | 焦躁 | 😤 | 效率-20% | 情绪值<20 |

### 9.3 事件类型枚举

| 事件类型 | 说明 | 典型场景 |
|----------|------|----------|
| `challenge` | 突发挑战 | Bug修复、需求变更、紧急上线 |
| `opportunity` | 机会事件 | 额外任务包、模型升级、协作机会 |
| `crisis` | 危机事件 | 团队士气危机、服务中断 |

### 9.4 成就分类与ID

| 分类 | ID | 名称 | 解锁条件 |
|------|-----|------|----------|
| milestone | `first_task` | 初出茅庐 | 首次完成任务 |
| milestone | `first_collaboration` | 第一次协作 | 首次触发Agent协作 |
| milestone | `perfect_match` | 完美匹配 | 连续10次任务匹配度100% |
| milestone | `zero_intervention` | 零干预 | 一整周没介入Agent自主交流 |
| milestone | `crisis_expert` | 危机处理专家 | 成功化解3次重大事件 |
| milestone | `social_darling` | 社交达人 | 所有Agent关系度达到60%+ |
| milestone | `efficiency_master` | 效率大师 | 单日完成5个任务 |
| milestone | `omniscient_lord` | 全知城主 | 解锁城主Lv6 |
| collaboration | `best_friends` | 最佳拍档 | 两Agent关系度达到100% |
| random | `lucky_star` | 意外之喜 | 连续3次协作出金色想法 |
| random | `backstabbed` | 倒霉日 | 连续3次协作失败 |
| efficiency | `speed_demon` | 速度狂魔 | 单任务用时<正常50% |

### 9.5 城主技能定义

| 技能Key | 显示名 | 解锁等级 | 效果 | 冷却 | 图标 |
|---------|--------|----------|------|------|------|
| `incentiveSpeech` | 激励演说 | 1 | 指定Agent饱食度+30，情绪+10 | 3回合 | 📣 |
| `preciseAssignment` | 精准分配 | 2 | 任务匹配度判断准确率+20% | 无 | 🎯 |
| `resourceDispatch` | 资源调度 | 3 | 指定Agent Token配额+50% | 5回合 | 💰 |
| `inspirationGrant` | 灵感赐予 | 4 | 协作中Agent质量+15% | 7回合 | 🔮 |
| `haloEffect` | 光环效应 | 5 | 全员情绪+10 | 10回合 | 🌟 |
| `omniscientView` | 全知视角 | 6 | 查看任意Agent详细状态 | 无 | 👁️ |

### 9.6 房间类型定义

| 房间类型 | 房间ID | 可容纳Agent | 特殊模式 | 设施升级 |
|----------|--------|------------|----------|----------|
| 办公室 | 1-9 | 1 | 无 | 解锁更多办公室 |
| 休息室 | rest | 无限 | 庆功模式 | Lv2/Lv3 |
| 机房 | server | 0 | 无 | Lv2/Lv3 |
| 资料室 | archive | 0 | 无 | 无 |
| 会议室 | meeting | 9 | 复盘模式 | 无 |

### 9.7 任务类型与职业匹配矩阵

| 任务类型 | 设计师 | 程序员 | 测试员 | 分析师 | 城主 |
|----------|--------|--------|--------|--------|------|
| design | 100 | 20 | 30 | 40 | 40 |
| code | 20 | 100 | 60 | 50 | 30 |
| test | 30 | 50 | 100 | 60 | 30 |
| analyze | 40 | 30 | 40 | 100 | 50 |
| review | 50 | 70 | 80 | 70 | 60 |
| meeting | 50 | 50 | 50 | 60 | 80 |
| other | 50 | 50 | 50 | 50 | 50 |

### 9.8 升级所需XP

| 当前等级 | 升级所需XP | 累计XP |
|----------|-----------|--------|
| 1 → 2 | 200 | 200 |
| 2 → 3 | 300 | 500 |
| 3 → 4 | 400 | 900 |
| 4 → 5 | 500 | 1400 |
| 5 → 6 | 600 | 2000 |
| 6 → 7 | 700 | 2700 |

### 9.9 城主升级所需XP（2倍Agent）

| 当前等级 | 升级所需XP | 累计XP |
|----------|-----------|--------|
| 1 → 2 | 400 | 400 |
| 2 → 3 | 600 | 1000 |
| 3 → 4 | 800 | 1800 |
| 4 → 5 | 1000 | 2800 |
| 5 → 6 | 1200 | 4000 |

### 9.10 WebSocket 消息类型

**前端 → 后端**

| type | payload | 说明 |
|------|---------|------|
| `heartbeat` | `{ timestamp }` | 心跳保活 |
| `assign_task` | `{ agentId, taskId }` | 分配任务 |
| `move_agent` | `{ agentId, targetRoom }` | 移动Agent |
| `use_skill` | `{ skillName, targetAgentId? }` | 使用城主技能 |
| `chat` | `{ content, agentId? }` | 发送聊天消息 |
| `event_choice` | `{ eventId, choice }` | 事件选择 |
| `auto_chat_control` | `{ enabled, tokenLimit }` | 自主交流开关 |

**后端 → 前端**

| type | payload | 说明 |
|------|---------|------|
| `agent_update` | `{ id, ...updates }` | Agent状态更新 |
| `task_update` | `{ id, status, progress }` | 任务状态更新 |
| `event` | `{ id, type, title, choices }` | 触发事件 |
| `chat` | `{ agentId, content, isAutoChat }` | 收到聊天消息 |
| `auto_chat` | `{ fromAgent, toAgent, chatType, content }` | 自主交流消息 |
| `achievement` | `{ id, name, description }` | 成就解锁通知 |
| `system` | `{ type, message }` | 系统消息 |
| `room_change` | `{ agentId, fromRoom, toRoom }` | Agent房间变更 |
| `city_lord_update` | `{ xp, level, skills }` | 城主状态更新 |

---

## 第五部分：附录

---

## 10. CSS 样式规范

### 10.1 全局 CSS 变量（index.css）

```css
/* Rimworld 暖棕色调 */
:root {
  /* 背景色 */
  --bg-base: #1e1b18;
  --bg-surface: #2d2a26;
  --bg-elevated: #3d3830;
  --bg-panel: #4a4235;

  /* 边框 */
  --border-dark: #1a1510;
  --border-light: #5a5040;

  /* 主色调 */
  --accent-warm: #c8a060;
  --accent-green: #7a9a50;
  --accent-red: #c06050;
  --accent-blue: #6080a0;

  /* 文字 */
  --text-primary: #e8dcc8;
  --text-secondary: #a89880;
  --text-muted: #685848;

  /* 需求条 */
  --mood-high: #7a9a50;
  --mood-mid: #c8a060;
  --mood-low: #c06050;

  /* 崽崽专属 */
  --zaizai-gold: #ffd700;
}

/* 全局字体 */
body {
  font-family: 'Noto Sans SC', 'PingFang SC', sans-serif;
  background-color: var(--bg-base);
  color: var(--text-primary);
  font-size: 12px;
  line-height: 1.4;
}

/* 像素风格数字 */
.pixel-number {
  font-family: 'VT323', monospace;
  font-size: 16px;
  letter-spacing: 1px;
}

/* RPG 风格按钮 */
.btn-rpg {
  background: var(--bg-elevated);
  border: 2px solid var(--border-light);
  color: var(--text-primary);
  padding: 6px 16px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  box-shadow: inset -1px -1px 0 var(--border-dark), inset 1px 1px 0 rgba(255,255,255,0.05);
}

.btn-rpg:hover {
  background: var(--bg-panel);
  border-color: var(--accent-warm);
  color: var(--accent-warm);
}

.btn-rpg:active {
  box-shadow: inset 1px 1px 0 var(--border-dark), inset -1px -1px 0 rgba(255,255,255,0.05);
}

/* 需求条 */
.needs-bar {
  height: 6px;
  background: var(--bg-base);
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid var(--border-dark);
}

.needs-bar-fill {
  height: 100%;
  transition: width 0.3s ease, background-color 0.3s ease;
}

/* 像素边框 */
.pixel-border {
  border: 2px solid var(--border-dark);
  box-shadow:
    inset -2px -2px 0 var(--border-dark),
    inset 2px 2px 0 var(--border-light);
}
```

---

## 11. 与 PRD/SDD 的追溯关系

| 详细设计章节 | 对应 PRD 章节 | 对应 SDD 章节 |
|-------------|--------------|--------------|
| 1. Store | 4.16, 5 | 6.1 |
| 2. GameEngine | 4.1-4.14 | 4.2 |
| 3. WebSocket | 4.16 | 5 |
| 4. ActivitySpace | 3, 4.2 | 7.1 |
| 5. AgentPopup | 4.16 | 7.1 |
| 6. useGameLoop | 4 | 4.3 |
| 7. useAutoChat | 4.7 | 4.3 |
| 8. 工具函数 | - | 4.4 |
| 9. 数据字典 | 4, 5 | 6, 7 |
| 10. CSS | 2 | 2.3 |
