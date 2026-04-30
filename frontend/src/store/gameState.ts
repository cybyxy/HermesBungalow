import { create } from 'zustand';
import { calcRoleMatch, tickAgent } from '../services/gameEngine';
import { createRandomEvent } from '../services/eventSystem';
import { DEFAULT_ACHIEVEMENTS, unlockByRule, type AchievementState } from '../services/progression';
import type { ActivityEvent, TaskItem, TaskType, TeamAgent } from '../types/game';

const STORAGE_KEY = 'hb_game_state_v1';
const STORAGE_VERSION = 2;

function readPersistedState(): Partial<{
  tasks: TaskItem[];
  taskLifecycleLog: Record<string, Array<{ timestamp: number; action: string; detail: string }>>;
  activityLog: Array<{ type: 'task' | 'event' | 'skill' | 'upgrade'; message: string; timestamp: number }>;
}> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // v1 -> v2 migration: old payload may not contain version field
    const version = Number(parsed?.version ?? 1);
    if (version <= 1) {
      const migratedTasks = Array.isArray(parsed?.tasks)
        ? parsed.tasks.map((t: TaskItem) => ({
            ...t,
            qualityScore: Number(t?.qualityScore ?? 0),
            priority: (t?.priority ?? 2) as 1 | 2 | 3,
            etaSec: Number(t?.etaSec ?? 0),
          }))
        : [];
      return {
        tasks: migratedTasks,
        taskLifecycleLog: parsed?.taskLifecycleLog && typeof parsed.taskLifecycleLog === 'object' ? parsed.taskLifecycleLog : {},
        activityLog: Array.isArray(parsed?.activityLog) ? parsed.activityLog : [],
      };
    }
    return {
      tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : [],
      taskLifecycleLog: parsed?.taskLifecycleLog && typeof parsed.taskLifecycleLog === 'object' ? parsed.taskLifecycleLog : {},
      activityLog: Array.isArray(parsed?.activityLog) ? parsed.activityLog : [],
    };
  } catch {
    return {};
  }
}

type WSStatus = 'disconnected' | 'connecting' | 'open';

interface GameStore {
  wsStatus: WSStatus;
  weekCompleted: number;
  weekTarget: number;
  cityLordPoints: number;
  cityLordLevel: number;
  restRoomLevel: number;
  serverRoomLevel: number;
  assignedTasks: number;
  selectedTaskType: TaskType;
  tasks: TaskItem[];
  agents: TeamAgent[];
  events: Array<ActivityEvent & { expireAt?: number }>;
  achievements: AchievementState[];
  latestResolution: string;
  activityLog: Array<{ type: 'task' | 'event' | 'skill' | 'upgrade'; message: string; timestamp: number }>;
  eventResultFeed: Array<{ id: string; text: string; timestamp: number }>;
  eventUndoStack: Array<{
    event: ActivityEvent & { expireAt?: number };
    accept: boolean;
    pointsDelta: number;
    weekDelta: number;
  }>;
  eventRedoStack: Array<{
    event: ActivityEvent & { expireAt?: number };
    accept: boolean;
    pointsDelta: number;
    weekDelta: number;
  }>;
  cityLordSkillCooldowns: { motivate: number; dispatch: number };
  levelUpFeed: Array<{ id: string; text: string; timestamp: number }>;
  taskLifecycleLog: Record<string, Array<{ timestamp: number; action: string; detail: string }>>;
  chatMessages: Array<{ id: string; sender: 'user' | 'caicai'; text: string }>;
  setWsStatus: (status: WSStatus) => void;
  appendChat: (sender: 'user' | 'caicai', text: string) => void;
  addEvent: (event: Omit<ActivityEvent, 'id' | 'timestamp'>) => void;
  assignTask: (agentId: string, taskType: TaskType) => void;
  cancelTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  changeTaskPriority: (taskId: string, direction: 'up' | 'down') => void;
  reorderTask: (sourceTaskId: string, targetTaskId: string) => void;
  reassignTask: (taskId: string, targetAgentId: string) => void;
  applyImportedTimeline: (
    taskId: string,
    timeline: Array<{ timestamp: number; action: string; detail: string }>,
    mode: 'replace' | 'merge',
    dedupStrategy?: 'none' | 'timestamp' | 'action'
  ) => void;
  resolveEvent: (eventId: string, accept: boolean) => void;
  undoLastEventResolution: () => boolean;
  redoLastEventResolution: () => boolean;
  upgradeFacility: (facility: 'rest' | 'server') => boolean;
  castCityLordSkill: (skill: 'motivate' | 'dispatch') => boolean;
  setSelectedTaskType: (taskType: TaskType) => void;
  tick: () => void;
}

const initialAgents: TeamAgent[] = [
  { id: 'zaizai', name: '崽崽', role: '城主', status: 'idle', energy: 88, quota: 93, socialNeed: 78, roleMatch: 100 },
  { id: 'designer', name: '小设', role: '设计师', status: 'working', energy: 82, quota: 86, socialNeed: 66, roleMatch: 91 },
  { id: 'coder', name: '小码', role: '程序员', status: 'working', energy: 79, quota: 84, socialNeed: 62, roleMatch: 94 },
  { id: 'tester', name: '小测', role: '测试员', status: 'idle', energy: 85, quota: 89, socialNeed: 64, roleMatch: 72 },
  { id: 'analyst', name: '小析', role: '分析师', status: 'social', energy: 77, quota: 88, socialNeed: 71, roleMatch: 80 },
];

const persisted = readPersistedState();

export const useGameState = create<GameStore>((set) => ({
  wsStatus: 'disconnected',
  weekCompleted: 0,
  weekTarget: 30,
  cityLordPoints: 0,
  cityLordLevel: 1,
  restRoomLevel: 1,
  serverRoomLevel: 1,
  assignedTasks: 0,
  selectedTaskType: 'design',
  tasks: persisted.tasks ?? [],
  agents: initialAgents,
  events: [],
  achievements: DEFAULT_ACHIEVEMENTS,
  latestResolution: '',
  activityLog: persisted.activityLog ?? [],
  eventResultFeed: [],
  eventUndoStack: [],
  eventRedoStack: [],
  cityLordSkillCooldowns: { motivate: 0, dispatch: 0 },
  levelUpFeed: [],
  taskLifecycleLog: persisted.taskLifecycleLog ?? {},
  chatMessages: [],
  setWsStatus: (wsStatus) => set({ wsStatus }),
  appendChat: (sender, text) =>
    set((s) => ({
      chatMessages: [...s.chatMessages, { id: `${Date.now()}-${Math.random()}`, sender, text }],
    })),
  addEvent: (event) =>
    set((s) => ({
      events: [{ id: `${Date.now()}-${Math.random()}`, timestamp: Date.now(), ...event }, ...s.events].slice(0, 20),
    })),
  assignTask: (agentId, taskType) =>
    set((s) => {
      const now = Date.now();
      const taskId = `task-${now}-${Math.floor(Math.random() * 1000)}`;
      const newTask: TaskItem = {
        id: taskId,
        agentId,
        taskType,
        progress: 0,
        status: 'queued' as const,
        priority: (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3,
        rewardPoints: 12,
        rewardWeek: 1,
        etaSec: 12,
        qualityScore: 0,
      };
      const agents = s.agents.map((a) => {
        if (a.id !== agentId) return a;
        const roleMatch = calcRoleMatch(a.role, taskType);
        const status: TeamAgent['status'] = roleMatch < 20 ? 'slacking' : 'working';
        return {
          ...a,
          roleMatch,
          status,
        };
      });
      return {
        agents,
        assignedTasks: s.assignedTasks + 1,
        selectedTaskType: taskType,
        tasks: [
          newTask,
          ...s.tasks,
        ]
          .sort((a, b) => b.priority - a.priority || a.progress - b.progress)
          .slice(0, 80),
        events: [
          {
            id: `${now}-${Math.random()}`,
            timestamp: now,
            type: 'info' as const,
            title: '任务已分配',
            detail: `已向 ${agentId} 分配 ${taskType} 任务`,
          },
          ...s.events,
        ].slice(0, 20),
        activityLog: [
          { type: 'task' as const, message: `任务分配: ${agentId} <- ${taskType}`, timestamp: now },
          ...s.activityLog,
        ].slice(0, 60),
        taskLifecycleLog: {
          ...s.taskLifecycleLog,
          [taskId]: [
            ...(s.taskLifecycleLog[taskId] ?? []),
            { timestamp: now, action: 'created', detail: `创建并分配给 ${agentId}, 类型 ${taskType}` },
            { timestamp: now, action: 'queued', detail: '进入任务队列' },
          ],
        },
      };
    }),
  cancelTask: (taskId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId && (t.status === 'queued' || t.status === 'in_progress')
        ? { ...t, status: 'cancelled' as const }
        : t)),
      activityLog: [
        { type: 'task' as const, message: `任务取消: ${taskId.slice(0, 8)}`, timestamp: Date.now() },
        ...s.activityLog,
      ].slice(0, 60),
      taskLifecycleLog: {
        ...s.taskLifecycleLog,
        [taskId]: [
          ...(s.taskLifecycleLog[taskId] ?? []),
          { timestamp: Date.now(), action: 'cancelled', detail: '任务被手动取消' },
        ],
      },
    })),
  retryTask: (taskId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId && (t.status === 'cancelled' || t.status === 'failed')
        ? { ...t, status: 'queued' as const, progress: 0, etaSec: 12 }
        : t)),
      activityLog: [
        { type: 'task' as const, message: `任务重试: ${taskId.slice(0, 8)}`, timestamp: Date.now() },
        ...s.activityLog,
      ].slice(0, 60),
      taskLifecycleLog: {
        ...s.taskLifecycleLog,
        [taskId]: [
          ...(s.taskLifecycleLog[taskId] ?? []),
          { timestamp: Date.now(), action: 'retried', detail: '任务重试并重新入队' },
          { timestamp: Date.now(), action: 'queued', detail: '进入任务队列' },
        ],
      },
    })),
  changeTaskPriority: (taskId, direction) =>
    set((s) => {
      const tasks = s.tasks.map((t) => {
        if (t.id !== taskId) return t;
        const delta = direction === 'up' ? 1 : -1;
        const nextPriority = Math.max(1, Math.min(3, t.priority + delta)) as 1 | 2 | 3;
        return { ...t, priority: nextPriority };
      }).sort((a, b) => b.priority - a.priority || a.progress - b.progress);
      return {
        tasks,
        activityLog: [
          { type: 'task' as const, message: `任务优先级调整: ${taskId.slice(0, 8)} ${direction === 'up' ? '上调' : '下调'}`, timestamp: Date.now() },
          ...s.activityLog,
        ].slice(0, 60),
        taskLifecycleLog: {
          ...s.taskLifecycleLog,
          [taskId]: [
            ...(s.taskLifecycleLog[taskId] ?? []),
            { timestamp: Date.now(), action: 'priority_changed', detail: `优先级${direction === 'up' ? '上调' : '下调'}` },
          ],
        },
      };
    }),
  reorderTask: (sourceTaskId, targetTaskId) =>
    set((s) => {
      const from = s.tasks.findIndex((t) => t.id === sourceTaskId);
      const to = s.tasks.findIndex((t) => t.id === targetTaskId);
      if (from < 0 || to < 0 || from === to) return s;
      const next = [...s.tasks];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return {
        tasks: next,
        activityLog: [
          { type: 'task' as const, message: `任务重排: ${sourceTaskId.slice(0, 8)} -> ${targetTaskId.slice(0, 8)}`, timestamp: Date.now() },
          ...s.activityLog,
        ].slice(0, 60),
        taskLifecycleLog: {
          ...s.taskLifecycleLog,
          [sourceTaskId]: [
            ...(s.taskLifecycleLog[sourceTaskId] ?? []),
            { timestamp: Date.now(), action: 'reordered', detail: `重排到 ${targetTaskId.slice(0, 8)} 前` },
          ],
        },
      };
    }),
  reassignTask: (taskId, targetAgentId) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === taskId
        ? { ...t, agentId: targetAgentId, status: t.status === 'done' ? 'done' : 'queued', etaSec: t.status === 'done' ? 0 : 12 }
        : t)),
      activityLog: [
        { type: 'task' as const, message: `任务转派: ${taskId.slice(0, 8)} -> ${targetAgentId}`, timestamp: Date.now() },
        ...s.activityLog,
      ].slice(0, 60),
      taskLifecycleLog: {
        ...s.taskLifecycleLog,
        [taskId]: [
          ...(s.taskLifecycleLog[taskId] ?? []),
          { timestamp: Date.now(), action: 'reassigned', detail: `转派到 ${targetAgentId}` },
          { timestamp: Date.now(), action: 'queued', detail: '转派后重新排队' },
        ],
      },
    })),
  applyImportedTimeline: (taskId, timeline, mode, dedupStrategy = 'none') =>
    set((s) => {
      const existing = s.taskLifecycleLog[taskId] ?? [];
      const merged = mode === 'replace'
        ? [...timeline]
        : [...existing, ...timeline].sort((a, b) => a.timestamp - b.timestamp);
      const nextTimeline = (() => {
        if (dedupStrategy === 'none') return merged;
        if (dedupStrategy === 'timestamp') {
          const seen = new Set<number>();
          return merged.filter((x) => {
            if (seen.has(x.timestamp)) return false;
            seen.add(x.timestamp);
            return true;
          });
        }
        const seen = new Set<string>();
        return merged.filter((x) => {
          if (seen.has(x.action)) return false;
          seen.add(x.action);
          return true;
        });
      })();
      return {
        taskLifecycleLog: {
          ...s.taskLifecycleLog,
          [taskId]: nextTimeline,
        },
        activityLog: [
          {
            type: 'task' as const,
            message: `导入时间线(${mode === 'replace' ? '覆盖' : '合并'}|${dedupStrategy}): ${taskId.slice(0, 8)} +${timeline.length}`,
            timestamp: Date.now(),
          },
          ...s.activityLog,
        ].slice(0, 60),
      };
    }),
  resolveEvent: (eventId, accept) =>
    set((s) => {
      const target = s.events.find((e) => e.id === eventId);
      if (!target) return s;
      const pointsDelta = accept ? 20 : 0;
      const weekDelta = accept ? 1 : 0;
      return {
        events: s.events.filter((e) => e.id !== eventId),
        cityLordPoints: s.cityLordPoints + pointsDelta,
        weekCompleted: s.weekCompleted + weekDelta,
        latestResolution: accept ? '已接受事件并推进进度。' : '已忽略事件。',
        activityLog: [
          { type: 'event' as const, message: `事件处理: ${accept ? '接受' : '忽略'} ${eventId.slice(0, 8)}`, timestamp: Date.now() },
          ...s.activityLog,
        ].slice(0, 60),
        eventResultFeed: [
          { id: `${Date.now()}-${Math.random()}`, text: `${accept ? '✅ 接受' : '⏭ 忽略'} 事件 ${eventId.slice(0, 8)}`, timestamp: Date.now() },
          ...s.eventResultFeed,
        ].slice(0, 20),
        eventUndoStack: [{ event: target, accept, pointsDelta, weekDelta }, ...s.eventUndoStack].slice(0, 50),
        eventRedoStack: [],
      };
    }),
  undoLastEventResolution: () => {
    let ok = false;
    set((s) => {
      const snap = s.eventUndoStack[0];
      if (!snap) return s;
      const restUndo = s.eventUndoStack.slice(1);
      ok = true;
      return {
        events: [snap.event, ...s.events].slice(0, 20),
        cityLordPoints: Math.max(0, s.cityLordPoints - snap.pointsDelta),
        weekCompleted: Math.max(0, s.weekCompleted - snap.weekDelta),
        latestResolution: '已撤销最近一次事件处理。',
        activityLog: [
          { type: 'event' as const, message: `撤销事件处理: ${snap.event.id.slice(0, 8)}`, timestamp: Date.now() },
          ...s.activityLog,
        ].slice(0, 60),
        eventResultFeed: [
          { id: `${Date.now()}-${Math.random()}`, text: `↩️ 撤销事件 ${snap.event.id.slice(0, 8)}`, timestamp: Date.now() },
          ...s.eventResultFeed,
        ].slice(0, 20),
        eventUndoStack: restUndo,
        eventRedoStack: [snap, ...s.eventRedoStack].slice(0, 50),
      };
    });
    return ok;
  },
  redoLastEventResolution: () => {
    let ok = false;
    set((s) => {
      const snap = s.eventRedoStack[0];
      if (!snap) return s;
      const restRedo = s.eventRedoStack.slice(1);
      ok = true;
      return {
        events: s.events.filter((e) => e.id !== snap.event.id),
        cityLordPoints: s.cityLordPoints + snap.pointsDelta,
        weekCompleted: s.weekCompleted + snap.weekDelta,
        latestResolution: '已重做最近一次事件处理。',
        activityLog: [
          { type: 'event' as const, message: `重做事件处理: ${snap.event.id.slice(0, 8)}`, timestamp: Date.now() },
          ...s.activityLog,
        ].slice(0, 60),
        eventResultFeed: [
          { id: `${Date.now()}-${Math.random()}`, text: `↪️ 重做事件 ${snap.event.id.slice(0, 8)}`, timestamp: Date.now() },
          ...s.eventResultFeed,
        ].slice(0, 20),
        eventRedoStack: restRedo,
        eventUndoStack: [snap, ...s.eventUndoStack].slice(0, 50),
      };
    });
    return ok;
  },
  upgradeFacility: (facility) => {
    let ok = false;
    set((s) => {
      const level = facility === 'rest' ? s.restRoomLevel : s.serverRoomLevel;
      const cost = level === 1 ? 500 : 1500;
      if (s.cityLordPoints < cost || level >= 3) return s;
      ok = true;
      return {
        cityLordPoints: s.cityLordPoints - cost,
        restRoomLevel: facility === 'rest' ? level + 1 : s.restRoomLevel,
        serverRoomLevel: facility === 'server' ? level + 1 : s.serverRoomLevel,
        latestResolution: facility === 'rest' ? '休息室升级成功。' : '机房升级成功。',
        activityLog: [
          { type: 'upgrade' as const, message: `设施升级: ${facility} -> Lv.${level + 1}`, timestamp: Date.now() },
          ...s.activityLog,
        ].slice(0, 60),
      };
    });
    return ok;
  },
  castCityLordSkill: (skill) => {
    let ok = false;
    set((s) => {
      if (s.cityLordSkillCooldowns[skill] > 0) return s;
      if (skill === 'motivate' && s.cityLordPoints >= 50) {
        ok = true;
        return {
          cityLordPoints: s.cityLordPoints - 50,
          agents: s.agents.map((a) => ({
            ...a,
            socialNeed: Math.min(100, a.socialNeed + 10),
            energy: Math.min(100, a.energy + 4),
          })),
          latestResolution: '城主技能【激励演说】已生效。',
          cityLordSkillCooldowns: { ...s.cityLordSkillCooldowns, motivate: 20 },
          activityLog: [
            { type: 'skill' as const, message: '城主技能: 激励演说', timestamp: Date.now() },
            ...s.activityLog,
          ].slice(0, 60),
        };
      }
      if (skill === 'dispatch' && s.cityLordPoints >= 80) {
        ok = true;
        return {
          cityLordPoints: s.cityLordPoints - 80,
          agents: s.agents.map((a) => ({
            ...a,
            quota: Math.min(100, a.quota + 12),
          })),
          latestResolution: '城主技能【资源调度】已生效。',
          cityLordSkillCooldowns: { ...s.cityLordSkillCooldowns, dispatch: 30 },
          activityLog: [
            { type: 'skill' as const, message: '城主技能: 资源调度', timestamp: Date.now() },
            ...s.activityLog,
          ].slice(0, 60),
        };
      }
      return s;
    });
    return ok;
  },
  setSelectedTaskType: (taskType) => set({ selectedTaskType: taskType }),
  tick: () =>
    set((s) => {
      const recoverBoost = 1 + (s.restRoomLevel - 1) * 0.25;
      const agents = s.agents.map((a) => {
        const next = tickAgent(a);
        if (next.status === 'social') {
          return {
            ...next,
            socialNeed: Math.min(100, next.socialNeed + 0.25 * recoverBoost),
            energy: Math.min(100, next.energy + 0.12 * recoverBoost),
          };
        }
        return next;
      });
      const workers = agents.filter((a) => a.status === 'working').length;
      const cityLordPoints = s.cityLordPoints + workers;
      const levelBefore = s.cityLordLevel;
      const nextTasks = s.tasks.map((t) => {
        if (t.status === 'done' || t.status === 'cancelled' || t.status === 'failed') return t;
        const agent = agents.find((a) => a.id === t.agentId);
        if (!agent) return t;
        const status: TaskItem['status'] = t.progress === 0 ? 'queued' : t.status;
        const speed = agent.status === 'working' ? 16 : agent.status === 'slacking' ? 5 : 8;
        const progress = t.progress;
        const maybeFail = agent.status === 'slacking' && Math.random() < 0.05;
        const nextStatus: TaskItem['status'] = maybeFail ? 'failed' : progress >= 100 ? 'done' : status;
        const etaSec = nextStatus === 'in_progress' || nextStatus === 'queued'
          ? Math.max(1, Math.ceil((100 - progress) / Math.max(1, speed)))
          : 0;
        return { ...t, status: nextStatus, progress, etaSec };
      });
      // 严格调度：每个 Agent 同时最多一个 in_progress，其余 queued
      const byAgent = new Map<string, TaskItem[]>();
      for (const t of nextTasks) {
        const arr = byAgent.get(t.agentId) ?? [];
        arr.push(t);
        byAgent.set(t.agentId, arr);
      }
      const scheduled = new Map<string, TaskItem>();
      for (const [agentId, arr] of byAgent.entries()) {
        const candidates = arr
          .filter((t) => t.status === 'queued' || t.status === 'in_progress')
          .sort((a, b) => b.priority - a.priority || a.progress - b.progress);
        const active = candidates[0];
        if (active) scheduled.set(agentId, active);
      }
      const finalTasks = nextTasks.map((t) => {
        if (t.status === 'done' || t.status === 'cancelled' || t.status === 'failed') return t;
        const active = scheduled.get(t.agentId);
        const agent = agents.find((a) => a.id === t.agentId);
        if (!active || !agent) return { ...t, status: 'queued' as const };
        if (active.id !== t.id) return { ...t, status: 'queued' as const };
        const speed = agent.status === 'working' ? 16 : agent.status === 'slacking' ? 5 : 8;
        const progress = Math.min(100, t.progress + speed * Math.max(0.5, agent.roleMatch / 100));
        const maybeFail = agent.status === 'slacking' && Math.random() < 0.05;
        const status: TaskItem['status'] = maybeFail ? 'failed' : progress >= 100 ? 'done' : 'in_progress';
        const etaSec = status === 'in_progress' ? Math.max(1, Math.ceil((100 - progress) / Math.max(1, speed))) : 0;
        const roleMatchWeight = 0.8;
        const energyWeight = 0.2;
        const roleMatchPart = Math.round(agent.roleMatch * roleMatchWeight);
        const energyPart = Math.round(agent.energy * energyWeight);
        const qualityScore = status === 'done'
          ? Math.max(0, Math.min(100, roleMatchPart + energyPart))
          : t.qualityScore;
        return {
          ...t,
          progress,
          status,
          etaSec,
          qualityScore,
          qualityBreakdown: {
            roleMatchWeight,
            energyWeight,
            roleMatchPart,
            energyPart,
          },
        };
      }).sort((a, b) => b.priority - a.priority || a.progress - b.progress);
      const justDone = finalTasks.filter((t, idx) => t.status === 'done' && s.tasks[idx]?.status !== 'done');
      const newlyRunning = finalTasks.filter((t, idx) => t.status === 'in_progress' && s.tasks[idx]?.status !== 'in_progress');
      const newlyFailed = finalTasks.filter((t, idx) => t.status === 'failed' && s.tasks[idx]?.status !== 'failed');
      const taskRewardPoints = justDone.reduce((acc, t) => acc + Math.round(t.rewardPoints * (0.7 + t.qualityScore / 100)), 0);
      const taskRewardWeek = justDone.reduce((acc, t) => acc + t.rewardWeek, 0);
      const totalPoints = cityLordPoints + taskRewardPoints;
      const nextEvents = s.events.filter((e) => !e.expireAt || e.expireAt > Date.now());
      const randomEvent = createRandomEvent(Date.now());
      if (randomEvent) nextEvents.unshift(randomEvent);
      const cityLordLevel = Math.floor(totalPoints / 200) + 1;
      const achievements = unlockByRule(s.achievements, {
        assignedTasks: s.assignedTasks,
        cityLordLevel,
        restRoomLevel: s.restRoomLevel,
      });
      const cityLordSkillCooldowns = {
        motivate: Math.max(0, s.cityLordSkillCooldowns.motivate - 1),
        dispatch: Math.max(0, s.cityLordSkillCooldowns.dispatch - 1),
      };
      const levelAfter = cityLordLevel;
      const levelUpFeed = levelAfter > levelBefore
        ? [{ id: `${Date.now()}-${Math.random()}`, text: `🎉 城主升级到 Lv.${levelAfter}`, timestamp: Date.now() }, ...s.levelUpFeed].slice(0, 20)
        : s.levelUpFeed;
      return {
        agents,
        cityLordPoints: totalPoints,
        cityLordLevel: levelAfter,
        tasks: finalTasks,
        weekCompleted: s.weekCompleted + (Math.random() < 0.05 ? 1 : 0) + taskRewardWeek,
        events: nextEvents.slice(0, 20),
        achievements,
        cityLordSkillCooldowns,
        levelUpFeed,
        activityLog: [
          ...justDone.map((t) => ({
            type: 'task' as const,
            message: `任务完成: ${t.agentId}/${t.taskType} (+${t.rewardPoints}积分)`,
            timestamp: Date.now(),
          })),
          ...s.activityLog,
        ].slice(0, 60),
        taskLifecycleLog: (() => {
          const next = { ...s.taskLifecycleLog };
          for (const t of newlyRunning) {
            next[t.id] = [
              ...(next[t.id] ?? []),
              { timestamp: Date.now(), action: 'started', detail: `开始执行, ETA ${t.etaSec}s` },
            ];
          }
          for (const t of justDone) {
            next[t.id] = [
              ...(next[t.id] ?? []),
              { timestamp: Date.now(), action: 'completed', detail: `任务完成, 质量分 ${t.qualityScore}` },
            ];
          }
          for (const t of newlyFailed) {
            next[t.id] = [
              ...(next[t.id] ?? []),
              { timestamp: Date.now(), action: 'failed', detail: '执行失败, 可重试' },
            ];
          }
          return next;
        })(),
      };
    }),
}));

if (typeof window !== 'undefined') {
  useGameState.subscribe((state) => {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          tasks: state.tasks,
          taskLifecycleLog: state.taskLifecycleLog,
          activityLog: state.activityLog,
        })
      );
    } catch {
      // ignore persistence errors
    }
  });
}
