import type { CSSProperties } from 'react';
import type { TaskWorldSnapshot } from '../types/game';
import { colors } from './theme';

export const blockTitle: CSSProperties = {
  color: colors.gold,
  fontSize: 12,
  fontWeight: 'bold',
  marginBottom: 8,
};

export function formatTs(t: number | string): string {
  const n = typeof t === 'string' ? Number(t) : t;
  if (!Number.isFinite(n)) return '';
  return new Date(n * 1000).toLocaleString();
}

export function agentLabel(snapshot: TaskWorldSnapshot | null, agentId: string | null): string {
  if (!agentId) return '—';
  const a = snapshot?.agents.find((x) => x.id === agentId);
  return a ? `${a.name}` : agentId.slice(0, 8);
}

export function taskAssigneeName(snapshot: TaskWorldSnapshot | null, assigneeId: string | null | undefined): string {
  if (!assigneeId) return '未分配';
  const a = snapshot?.agents.find((x) => x.id === assigneeId);
  return a?.name ?? assigneeId.slice(0, 8);
}
