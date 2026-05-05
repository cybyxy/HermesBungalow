export type MenuItemDef =
  | { type: 'item'; id: string; label: string; hotkey?: string; tooltip?: string; disabled?: boolean }
  | { type: 'separator' };

export type MenuDef = { key: string; label: string; items: MenuItemDef[] };

/** Mirrors prototype MENUS structure; handlers wire in BottomBar / App. */
export const MAIN_MENUS: MenuDef[] = [
  {
    key: 'agent',
    label: '👥 Agent',
    items: [
      { type: 'item', id: 'showAddAgent', label: '➕ 添加Agent', hotkey: 'Ctrl+A', tooltip: '打开添加Agent弹窗' },
      { type: 'item', id: 'showAgentList', label: '📋 Agent列表', tooltip: '在左栏查看' },
      { type: 'item', id: 'showAgentStats', label: '📊 统计面板', tooltip: '占位' },
      { type: 'separator' },
      { type: 'item', id: 'showWorkMode', label: '💼 工作模式', tooltip: '占位' },
      { type: 'item', id: 'showRestMode', label: '😴 休息模式', tooltip: '占位' },
    ],
  },
  {
    key: 'task',
    label: '📋 任务',
    items: [
      { type: 'item', id: 'showNewTask', label: '➕ 新建任务', hotkey: 'Ctrl+T', tooltip: '居中非模态窗口新建任务（遮罩不挡操作）' },
      { type: 'item', id: 'showTaskList', label: '📋 任务列表', hotkey: 'J', tooltip: '在左侧栏查看' },
      { type: 'item', id: 'showTaskHistory', label: '📜 任务历史', tooltip: '占位' },
      { type: 'separator' },
      { type: 'item', id: 'showCompetition', label: '🎲 任务竞争', tooltip: '左侧选任务后底栏分配' },
      { type: 'item', id: 'showCollaboration', label: '🤝 协作任务', tooltip: '占位' },
    ],
  },
  {
    key: 'social',
    label: '💬 社交',
    items: [
      { type: 'item', id: 'showRelationMap', label: '🗺️ 关系图谱', tooltip: '占位' },
      { type: 'item', id: 'showChatLog', label: '💭 聊天记录', tooltip: '占位' },
      { type: 'item', id: 'showEventLog', label: '📰 事件日志', hotkey: 'E', tooltip: '右栏事件日志' },
      { type: 'separator' },
      { type: 'item', id: 'showGreeting', label: '🤝 打招呼设置', tooltip: '占位' },
    ],
  },
  {
    key: 'lord',
    label: '👑 城主',
    items: [
      { type: 'item', id: 'showLordInfo', label: '📊 城主信息', tooltip: '占位' },
      { type: 'item', id: 'showLordLevel', label: '⬆️ 城主等级', tooltip: '占位' },
      { type: 'item', id: 'showPoints', label: '💰 积分', tooltip: '占位' },
    ],
  },
  {
    key: 'building',
    label: '🏠 基地',
    items: [
      { type: 'item', id: 'showBuildRoom', label: '🔨 建造房间', tooltip: '占位' },
      { type: 'item', id: 'showRoomList', label: '📋 房间列表', tooltip: '占位' },
    ],
  },
  {
    key: 'event',
    label: '🎲 事件',
    items: [
      { type: 'item', id: 'showChallenge', label: '⚡ 突发挑战', tooltip: '占位' },
      { type: 'item', id: 'showPeriodicEvent', label: '📅 周期事件', tooltip: '占位' },
    ],
  },
  {
    key: 'help',
    label: '❓ 帮助',
    items: [
      { type: 'item', id: 'showGuide', label: '📖 新手引导', tooltip: '占位' },
      { type: 'item', id: 'showAbout', label: 'ℹ️ 关于', tooltip: 'Hermes 数字工作室' },
      { type: 'separator' },
      { type: 'item', id: 'showDevGateway', label: '🔌 Gateway 状态', tooltip: '开发用' },
    ],
  },
];
