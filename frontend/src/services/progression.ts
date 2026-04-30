export interface AchievementState {
  id: string;
  name: string;
  unlocked: boolean;
}

export const DEFAULT_ACHIEVEMENTS: AchievementState[] = [
  { id: 'first-task', name: '第一次任务分配', unlocked: false },
  { id: 'citylord-lv2', name: '城主升到 Lv.2', unlocked: false },
  { id: 'rest-upgrade', name: '升级休息室', unlocked: false },
];

export function unlockByRule(
  achievements: AchievementState[],
  state: {
    assignedTasks: number;
    cityLordLevel: number;
    restRoomLevel: number;
  }
) {
  return achievements.map((a) => {
    if (a.id === 'first-task' && state.assignedTasks > 0) return { ...a, unlocked: true };
    if (a.id === 'citylord-lv2' && state.cityLordLevel >= 2) return { ...a, unlocked: true };
    if (a.id === 'rest-upgrade' && state.restRoomLevel >= 2) return { ...a, unlocked: true };
    return a;
  });
}
