import type { ActivityEvent } from '../types/game';

export interface EventTemplate {
  type: ActivityEvent['type'];
  title: string;
  detail: string;
  durationSec: number;
}

const EVENT_POOL: EventTemplate[] = [
  { type: 'challenge', title: '突发：模型链路抖动', detail: '主链路波动，建议切换策略并安排复盘。', durationSec: 90 },
  { type: 'challenge', title: '突发：Agent 情绪低落', detail: '连续低匹配任务导致怠工风险上升。', durationSec: 120 },
  { type: 'opportunity', title: '机会：协作加成窗口', detail: '两名 Agent 协作可获得双倍积分。', durationSec: 75 },
  { type: 'info', title: '日常：休息室氛围上升', detail: '社交恢复效率提升。', durationSec: 60 },
];

export function createRandomEvent(now: number): (ActivityEvent & { expireAt: number }) | null {
  if (Math.random() > 0.035) return null;
  const picked = EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)];
  return {
    id: `evt-${now}-${Math.floor(Math.random() * 1000)}`,
    timestamp: now,
    expireAt: now + picked.durationSec * 1000,
    type: picked.type,
    title: picked.title,
    detail: picked.detail,
  };
}
