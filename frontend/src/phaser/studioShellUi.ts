/**
 * Phaser 壳层精简：底栏菜单与输入已迁至 React（CenterStage · BottomBar）。
 * 此处仅保留画布内轻提示，避免与中央场景 CSS 缩放耦合。
 */
import type Phaser from 'phaser';
import { studioFontUi, studioInk } from '../ui/theme';
import type { FullPageLayout } from '../ui/fullPageLayout';
import type { GameWorldSnapshot } from '../types/game';
import type { BottomSheetState } from '../store/uiStore';

const DEPTH_SHELL = 50;
const DEPTH_TOAST = 5045;

export type ShellSyncSlice = {
  layout: FullPageLayout;
  snapshot: GameWorldSnapshot | null;
  gatewayStatus: string;
  loading: boolean;
  bottomSheet: BottomSheetState;
  selectedAgentId: string | null;
  selectedTaskId: number | null;
};

export type ShellHandlers = {
  onOpenAgentDetail: (id: string) => void;
  onRefresh: () => void;
  onToggleMenu: (key: string) => void;
  onQuickNewTask: () => void;
  onQuickAssign: () => void;
  onQuickSkills: () => void;
};

export class StudioShellUi {
  private scene: Phaser.Scene;
  private getSlice: () => ShellSyncSlice;
  private bottomG: Phaser.GameObjects.Graphics;
  private toastUntil = 0;
  private toastText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, getSlice: () => ShellSyncSlice, _getHandlers: () => ShellHandlers) {
    this.scene = scene;
    this.getSlice = getSlice;
    this.bottomG = scene.add.graphics().setDepth(DEPTH_SHELL);
    this.toastText = scene.add
      .text(0, 0, '', {
        fontSize: '12px',
        color: studioInk.body,
        fontFamily: studioFontUi,
        backgroundColor: '#1a1a30',
        padding: { x: 10, y: 6 },
      })
      .setDepth(DEPTH_TOAST)
      .setVisible(false);
  }

  destroy(): void {
    this.bottomG.destroy();
    this.toastText.destroy();
  }

  sync(): void {
    this.bottomG.clear();
    const s = this.getSlice();
    const { layout } = s;
    const cw = layout.center.w;
    const ch = layout.center.h;
    if (Date.now() > this.toastUntil) this.toastText.setVisible(false);
    else {
      this.toastText.setPosition(cw / 2, ch - 18);
      this.toastText.setOrigin(0.5, 1);
    }
  }

  pointerDown(_gx: number, _gy: number): boolean {
    return false;
  }
}
