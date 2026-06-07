/** 办公室房间定义 — 纯视觉容器，不涉及模拟逻辑 */

export interface OfficeRoom {
  id: string;
  name: string;
  icon: string;
  color: string;
}

/** 4 个固定房间 */
const FIXED_ROOMS: OfficeRoom[] = [
  { id: 'manager', name: '经理室', icon: '💼', color: '#FF9800' },
  { id: 'server', name: '机房', icon: '🖥️', color: '#4caf50' },
  { id: 'lobby', name: '休息室', icon: '☕', color: '#607D8B' },
  { id: 'library', name: '图书室', icon: '📚', color: '#2196F3' },
];

const DYNAMIC_COLORS = [
  '#2196F3', '#E91E63', '#00BCD4', '#FF5722', '#8BC34A', '#FFC107',
  '#795548', '#3F51B5', '#009688', '#CDDC39', '#F44336', '#03A9F4',
];

const DYNAMIC_ICONS = ['💻', '📊', '⚙️', '🏠', '🌿', '📚', '🎯', '🔧', '💡', '📋', '🌟', '🗂️'];

/** 按 agent 数量构建完整房间列表：4 固定 + max(0, agentCount-1) 动态 */
export function buildRoomList(agentCount: number): OfficeRoom[] {
  const dynamicCount = Math.max(0, agentCount - 1);
  const dynamic: OfficeRoom[] = [];
  for (let i = 0; i < dynamicCount; i++) {
    dynamic.push({
      id: `dyn-${i}`,
      name: `办公室 ${i + 1}`,
      icon: DYNAMIC_ICONS[i % DYNAMIC_ICONS.length],
      color: DYNAMIC_COLORS[i % DYNAMIC_COLORS.length],
    });
  }
  return [...FIXED_ROOMS, ...dynamic];
}

/** 全部房间 id 列表（含动态），方便 get_configured_channels 等运行时引用 */
export const FIXED_ROOM_IDS = FIXED_ROOMS.map((r) => r.id);

/** 按职业给一个默认房间 */
const PROFESSION_ROOM: Record<string, string> = {
  '后端开发': 'server',
  '程序员': 'server',
  '前端开发': 'server',
  '设计师': 'library',
  '测试员': 'server',
  '产品经理': 'manager',
  '项目经理': 'manager',
  '需求分析': 'manager',
  '架构师': 'server',
  '运维工程师': 'server',
  '文档师': 'library',
  '数据分析师': 'library',
  '城主': 'manager',
  '算法工程师': 'server',
};

export function defaultRoomForProfession(profession: string): string {
  return PROFESSION_ROOM[profession] ?? 'lobby';
}
