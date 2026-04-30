import type { TeamAgent } from '../types/game';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function tickAgent(agent: TeamAgent): TeamAgent {
  const workMul = agent.status === 'working' || agent.status === 'slacking' ? 1.7 : 1;
  const rolePenalty = agent.roleMatch < 20 ? 1.5 : 1;
  const next = {
    ...agent,
    energy: clamp(agent.energy - 0.25 * workMul * rolePenalty, 0, 100),
    quota: clamp(agent.quota - 0.18 * workMul, 0, 100),
    socialNeed: clamp(agent.socialNeed - 0.12, 0, 100),
  };
  if (next.energy <= 0 || next.quota <= 0) return { ...next, status: 'offline' };
  if (next.roleMatch < 20) return { ...next, status: 'slacking' };
  return next;
}

export function calcRoleMatch(role: string, taskType: string): number {
  const table: Record<string, Record<string, number>> = {
    城主: { design: 70, code: 70, test: 70, analyze: 85, review: 90 },
    设计师: { design: 94, code: 42, test: 55, analyze: 68, review: 72 },
    程序员: { design: 38, code: 95, test: 66, analyze: 58, review: 78 },
    测试员: { design: 40, code: 62, test: 95, analyze: 60, review: 80 },
    分析师: { design: 66, code: 44, test: 58, analyze: 95, review: 74 },
  };
  return table[role]?.[taskType] ?? 60;
}
