import type { GameTask, GameWorldSnapshot } from '../types/game';
import { isPeerVisitorAgent } from '../ui/buildingLayout';

/** 与后端 ``post_task`` 拼给编排模型的用户文一致 */
export function buildTaskOrchestrationUserMessage(task: GameTask): string {
  const parts: string[] = [`任务名称：${task.name || ''}`];
  const cat = (task.catalog ?? '').trim();
  if (cat) parts.push(`任务目录：${cat}`);
  const desc = (task.description ?? '').trim();
  if (desc) parts.push(`目标描述：${desc}`);
  const del = (task.deliverables ?? '').trim();
  if (del) parts.push(`交付产物：${del}`);
  const acc = (task.acceptance_criteria ?? '').trim();
  if (acc) parts.push(`验收标准：${acc}`);
  const due = (task.due_at ?? '').trim();
  if (due) parts.push(`完成日期：${due}`);
  const eh = task.estimated_hours;
  if (eh != null && Number(eh) > 0) parts.push(`预计工时：${eh}小时`);
  return (`请着手完成以下任务：\n` + parts.join('\n')).trim();
}

export function firstLocalAgentId(snapshot: GameWorldSnapshot | null): string {
  const hit = snapshot?.agents.find((a) => !isPeerVisitorAgent(a));
  return hit?.id?.trim() ?? '';
}
