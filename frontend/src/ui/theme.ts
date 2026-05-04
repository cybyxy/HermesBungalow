/** Visual tokens aligned with docs/原型/prototype-complete.html */

export const colors = {
  bg: '#0a0a15',
  panel: 'rgba(26,26,48,0.95)',
  border: '#333355',
  gold: '#FFD700',
  text: '#aaa',
  bright: '#fff',
  btn: '#2a3a5a',
  btnHover: '#3a4a6a',
  agent: '#4169E1',
  face: '#FFE4B5',
  fixed: '#1a2a4a',
  dynamic: '#1a3a2a',
} as const;

export const layoutPx = {
  topBar: 64,
  bottomBar: 76,
  /** Right column: tasks + inference timeline */
  sidePanel: 340,
  /** Collapsed right strip (chevron hit area) */
  sidePanelCollapsed: 32,
} as const;

/** Phaser 工作室壳层 / 会话气泡：中文与西文混排更易读，避免正文用等宽体 */
export const studioFontUi =
  'system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei UI", "Noto Sans SC", "Segoe UI", sans-serif';

/** 时间、GW 等次要信息 */
export const studioFontMeta =
  'ui-monospace, "SF Mono", Menlo, "Cascadia Code", "Microsoft YaHei UI", monospace';

/** 工作室文案色阶（略提亮、减轻纯灰「糊」感） */
export const studioInk = {
  muted: '#9494ae',
  body: '#eceef6',
  userBody: '#e4e9ff',
  replyBody: '#dff5ea',
  toolBody: '#cfd6e8',
  /** 小标题用柔金，避免与正文对比过硬 */
  accentSoft: '#ebd896',
  errorSoft: '#ffb4b4',
} as const;

const professionMap: Record<string, string> = {
  程序员: '#4169E1',
  设计师: '#9370DB',
  测试员: '#228B22',
  分析师: '#FF8C00',
};

export function professionColor(profession: string): string {
  return professionMap[profession] ?? colors.text;
}

export function statusLabelCn(status: string): string {
  if (status === 'working') return '工作中';
  if (status === 'idle') return '空闲';
  if (status === 'resting') return '休息中';
  if (status === 'social') return '社交中';
  if (status === 'walking') return '移动中';
  return status;
}

export function statusColor(status: string): string {
  if (status === 'working') return '#90EE90';
  if (status === 'idle') return colors.gold;
  if (status === 'resting') return '#87CEEB';
  if (status === 'social') return '#DDA0DD';
  if (status === 'walking') return '#87CEFA';
  return '#888';
}

export function taskStatusLabelCn(status: string): { text: string; color: string } {
  if (status === 'pending') return { text: '待接取', color: colors.text };
  if (status === 'in_progress') return { text: '进行中', color: colors.gold };
  if (status === 'completed') return { text: '已完成', color: '#228B22' };
  if (status === 'failed') return { text: '失败', color: colors.gold };
  return { text: status, color: colors.text };
}
