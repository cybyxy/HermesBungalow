import type { TaskWorldSnapshot } from '../types/game';

const TASK_FLOW_KINDS = new Set([
  'task_create',
  'task_update',
  'task_assign',
  'task_complete',
  'task_delete',
  'task_progress',
  'task_collaboration',
  'competition_result',
  'task_workflow_defined',
]);

export type TaskWorkflowRow = {
  id: string;
  at: number;
  kind: string;
  title: string;
  detail: string;
};

function numTaskId(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function agentName(snapshot: TaskWorldSnapshot | null, agentId: unknown): string {
  const id = String(agentId ?? '').trim();
  if (!id) return '—';
  const a = snapshot?.agents.find((x) => x.id === id);
  return a?.name ?? id.slice(0, 8);
}

/** 从存档 ``event_log`` 提取与某任务 id 相关的流程节点（与编排 monitor 无关） */
export function buildTaskWorkflowTimeline(
  eventLog: Record<string, unknown>[] | undefined,
  taskId: number,
  snapshot: TaskWorldSnapshot | null,
): TaskWorkflowRow[] {
  const tid = Number(taskId);
  if (!Number.isFinite(tid)) return [];
  const rows: TaskWorkflowRow[] = [];
  let i = 0;
  for (const raw of eventLog ?? []) {
    const kind = String(raw.kind ?? '');
    if (!TASK_FLOW_KINDS.has(kind)) continue;
    const eid = numTaskId(raw.task_id);
    if (eid == null || eid !== tid) continue;
    const at = Number(raw.at);
    const tAt = Number.isFinite(at) ? at : 0;
    const id = `${kind}-${tAt}-${i++}`;

    let title = kind;
    let detail = '';
    switch (kind) {
      case 'task_create':
        title = '任务创建';
        detail = String(raw.name ?? '').trim() || `任务 #${tid}`;
        if (String(raw.catalog ?? '').trim()) detail += ` · 目录 ${String(raw.catalog).trim()}`;
        break;
      case 'task_update':
        title = '任务更新';
        detail = '已保存对标题/描述/截止/产物/验收等字段的修改';
        break;
      case 'task_assign': {
        title = '分配 / 执行人变更';
        const comp = Boolean(raw.competition);
        const aid = String(raw.assignee_id ?? '').trim();
        detail = aid ? `执行人：${agentName(snapshot, aid)}` : '未分配 / 已解除';
        if (comp) detail += ' · 含竞争抽签';
        break;
      }
      case 'task_complete':
        title = '任务完成';
        detail = `质量 ${Number(raw.quality ?? 0)} · XP +${Number(raw.xp ?? 0)} · 金币 +${Number(raw.gold ?? 0)}`;
        if (raw.assignee_id) detail += ` · ${agentName(snapshot, raw.assignee_id)}`;
        break;
      case 'task_delete':
        title = '任务删除';
        detail = String(raw.name ?? '').trim() || `任务 #${tid} 已从存档移除`;
        break;
      case 'task_progress':
        title = '进度更新';
        detail = `进度 ${Math.round(Number(raw.progress ?? 0))}%`;
        break;
      case 'task_collaboration':
        title = '协作模式';
        detail = '已开启协作加成';
        break;
      case 'competition_result': {
        title = '任务竞争';
        const wid = String(raw.winner_id ?? '').trim();
        detail = wid ? `中签：${agentName(snapshot, wid)}` : '竞争结果';
        const losers = raw.loser_ids;
        if (Array.isArray(losers) && losers.length)
          detail += ` · 未中：${losers.map((x) => agentName(snapshot, x)).join('、')}`;
        break;
      }
      case 'task_workflow_defined': {
        title = '流程规划已写入';
        const n = Number(raw.step_count ?? 0);
        detail = Number.isFinite(n) && n > 0 ? `共 ${n} 个步骤` : '已更新 workflow_steps';
        const sm = String(raw.summary ?? '').trim();
        if (sm) detail += ` · ${sm.slice(0, 200)}${sm.length > 200 ? '…' : ''}`;
        break;
      }
      default:
        title = kind;
        detail = '';
    }
    rows.push({ id, at: tAt, kind, title, detail });
  }
  rows.sort((a, b) => a.at - b.at);
  return rows;
}

export function workflowKindColor(kind: string): string {
  switch (kind) {
    case 'task_create':
      return '#6ecf9b';
    case 'task_complete':
      return '#5ab4c4';
    case 'task_assign':
      return '#8ab4f8';
    case 'task_update':
      return '#c9a8ff';
    case 'task_progress':
      return '#d4af37';
    case 'task_collaboration':
      return '#9cf';
    case 'competition_result':
      return '#daa520';
    case 'task_delete':
      return '#f88';
    case 'task_workflow_defined':
      return '#b8e';
    case 'analyze':
      return '#7eb8da';
    case 'design':
      return '#c9a8ff';
    case 'implement':
      return '#6ecf9b';
    case 'test':
      return '#f0c674';
    case 'review':
      return '#daa520';
    case 'deliver':
      return '#5ab4c4';
    case 'other':
      return '#888';
    default:
      return '#888';
  }
}
