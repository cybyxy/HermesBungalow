/**
 * 全页 Phaser 壳：底栏菜单；顶栏由 React DOM（CenterStage · TopBar）绘制。
 * 右侧会话/过程由 React DOM 绘制。底栏会话输入为 DOM textarea（叠在画布上）。
 */
import type Phaser from 'phaser';
import { useUiStore } from '../store/uiStore';
import { submitStudioChat, stopStudioChat } from '../chat/studioChatActions';
import { MAIN_MENUS } from '../ui/menuConfig';
import { colors, studioFontMeta, studioFontUi, studioInk } from '../ui/theme';
import type { FullPageLayout } from '../ui/fullPageLayout';
import type { Agent, GameWorldSnapshot } from '../types/game';
import type { BottomSheetState } from '../store/uiStore';
/** 底栏与中央区错层，数值低于中央人物（~5000） */
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

function hx(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

type HitZone = { x: number; y: number; w: number; h: number; kind: string; payload?: string };

export class StudioShellUi {
  private scene: Phaser.Scene;
  private getSlice: () => ShellSyncSlice;
  private getHandlers: () => ShellHandlers;
  private bottomG: Phaser.GameObjects.Graphics;
  private bottomMeta: Phaser.GameObjects.Text;
  private sendBtnText: Phaser.GameObjects.Text;
  private imgBtnText: Phaser.GameObjects.Text;
  private footerBtnTexts: Phaser.GameObjects.Text[] = [];
  private menuLabelTexts: Phaser.GameObjects.Text[] = [];
  private pendingFiles: File[] = [];
  private toastUntil = 0;
  private toastText: Phaser.GameObjects.Text;
  private menuHitZones: HitZone[] = [];
  private miscHitZones: HitZone[] = [];

  private readonly chatInputEl: HTMLTextAreaElement;
  private inputRect = { x: 0, y: 0, w: 160, h: 34 };
  private readonly textareaKeydown: (e: KeyboardEvent) => void;
  /** 与 sync 解耦：滚动/缩放后仍对齐画布上的底栏框 */
  private readonly boundLayoutChatInputDom: () => void;
  private inputLayoutObserver: ResizeObserver | null = null;

  constructor(scene: Phaser.Scene, getSlice: () => ShellSyncSlice, getHandlers: () => ShellHandlers) {
    this.scene = scene;
    this.getSlice = getSlice;
    this.getHandlers = getHandlers;
    this.bottomG = scene.add.graphics().setDepth(DEPTH_SHELL);
    this.bottomMeta = scene.add
      .text(0, 0, '', { fontSize: '11px', color: studioInk.muted, fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 1);
    this.sendBtnText = scene.add
      .text(0, 0, '发送', { fontSize: '12px', color: colors.bright, fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 2)
      .setOrigin(0.5);
    this.imgBtnText = scene.add
      .text(0, 0, '🖼', { fontSize: '13px', fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 2)
      .setOrigin(0.5);
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

    const ta = document.createElement('textarea');
    ta.autocomplete = 'off';
    ta.spellcheck = true;
    ta.placeholder =
      '输入消息 · Enter 发送 · Shift+Enter 换行 · @对方|或空格+要说的话 · 群发：@所有人|或 @所有人 同一说明';
    ta.tabIndex = 0;
    Object.assign(ta.style, {
      position: 'fixed',
      /** 高于 BottomSheetHost(1100) / 其它壳层，避免被叠在下面「看不见」 */
      zIndex: '2147483000',
      boxSizing: 'border-box',
      margin: '0',
      padding: '8px',
      border: `1px solid ${colors.border}`,
      borderRadius: '6px',
      background: 'rgba(26,26,48,0.97)',
      color: studioInk.body,
      fontSize: '12px',
      lineHeight: '1.55',
      fontFamily: studioFontUi,
      letterSpacing: '0.01em',
      resize: 'none',
      outline: 'none',
      overflow: 'auto',
      display: 'block',
      pointerEvents: 'auto',
      cursor: 'text',
      visibility: 'visible',
      opacity: '1',
    });
    this.chatInputEl = ta;
    document.body.appendChild(ta);

    this.boundLayoutChatInputDom = () => {
      this.layoutChatInputDom();
    };
    window.addEventListener('resize', this.boundLayoutChatInputDom);
    window.addEventListener('scroll', this.boundLayoutChatInputDom, true);

    this.textareaKeydown = (e: KeyboardEvent) => {
      const aid = useUiStore.getState().selectedAgentId;
      const streaming = Boolean(aid && useUiStore.getState().agentStreamIds[aid]);
      if (streaming) return;
      if (e.key === 'Enter' && !e.shiftKey) {
        if (e.isComposing) return;
        e.preventDefault();
        void this.onSendClick();
      }
    };
    ta.addEventListener('keydown', this.textareaKeydown);

    const mount = this.scene.game.canvas.parentElement;
    if (typeof ResizeObserver !== 'undefined' && mount) {
      this.inputLayoutObserver = new ResizeObserver(this.boundLayoutChatInputDom);
      this.inputLayoutObserver.observe(mount);
    }
    this.layoutChatInputDom();
  }

  private layoutChatInputDom(): void {
    const canvas = this.scene.game.canvas;
    if (!canvas || canvas.width < 2 || canvas.height < 2) return;
    const br = canvas.getBoundingClientRect();
    const scaleX = br.width / Math.max(1, canvas.width);
    const scaleY = br.height / Math.max(1, canvas.height);
    const { x, y, w, h } = this.inputRect;
    const el = this.chatInputEl;
    const cw = Math.max(32, w * scaleX);
    const ch = Math.max(28, h * scaleY);
    el.style.left = `${br.left + x * scaleX}px`;
    el.style.top = `${br.top + y * scaleY}px`;
    el.style.width = `${cw}px`;
    el.style.height = `${ch}px`;
    el.style.visibility = cw >= 8 && ch >= 8 ? 'visible' : 'hidden';
    el.style.pointerEvents = 'auto';

    const aid = useUiStore.getState().selectedAgentId;
    const streaming = Boolean(aid && useUiStore.getState().agentStreamIds[aid]);
    const focused = document.activeElement === el;
    if (streaming) {
      el.style.border = `1px solid ${colors.border}`;
      el.style.opacity = '0.75';
    } else if (focused) {
      el.style.border = `2px solid ${colors.gold}`;
      el.style.opacity = '1';
    } else {
      el.style.border = `1px solid ${colors.border}`;
      el.style.opacity = '1';
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.boundLayoutChatInputDom);
    window.removeEventListener('scroll', this.boundLayoutChatInputDom, true);
    this.inputLayoutObserver?.disconnect();
    this.inputLayoutObserver = null;
    this.chatInputEl.removeEventListener('keydown', this.textareaKeydown);
    this.chatInputEl.remove();
    this.destroyShellGraphics();
  }

  private destroyShellGraphics(): void {
    this.bottomG.destroy();
    this.bottomMeta.destroy();
    this.sendBtnText.destroy();
    this.imgBtnText.destroy();
    this.toastText.destroy();
    for (const t of this.menuLabelTexts) t.destroy();
    for (const t of this.footerBtnTexts) t.destroy();
  }

  private onSendClick(): void {
    const slice = this.getSlice();
    void submitStudioChat({
      text: this.chatInputEl.value.trim(),
      pendingFiles: [...this.pendingFiles],
      snapshot: slice.snapshot,
      onToast: (m) => this.flashToast(m),
      clearInput: () => {
        this.chatInputEl.value = '';
      },
      clearPendingFiles: () => {
        this.pendingFiles = [];
      },
    });
  }

  private async pickFilesNative(): Promise<void> {
    const w = window as Window & {
      showOpenFilePicker?: (opts: {
        multiple?: boolean;
        types?: { accept: Record<string, string[]> }[];
      }) => Promise<{ getFile: () => Promise<File> }[]>;
    };
    try {
      if (typeof w.showOpenFilePicker === 'function') {
        const handles = await w.showOpenFilePicker({
          multiple: true,
          types: [{ accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp'] } }],
        });
        const files: File[] = [];
        for (const h of handles.slice(0, 4)) {
          files.push(await h.getFile());
        }
        if (files.length) {
          this.pendingFiles = [...this.pendingFiles, ...files].slice(0, 4);
          this.flashToast(`已选 ${this.pendingFiles.length} 张图`);
        }
        return;
      }
    } catch {
      /* 用户取消 */
    }
    this.flashToast('当前浏览器不支持系统选图 API（需 Chromium 系），可改用粘贴图片');
  }

  private flashToast(msg: string): void {
    this.toastText.setText(msg);
    this.toastText.setVisible(true);
    this.toastUntil = Date.now() + 2800;
  }

  sync(): void {
    const s = this.getSlice();
    this.miscHitZones = [];
    const { layout, snapshot, bottomSheet, selectedAgentId, selectedTaskId } = s;
    const { bottom } = layout;

    const bx = bottom.x;
    const by = bottom.y;
    this.bottomG.clear();
    this.bottomG.fillStyle(hx('#151525'), 1);
    this.bottomG.lineStyle(2, hx(colors.border), 1);
    this.bottomG.fillRect(bx, by, bottom.w, bottom.h);
    this.bottomG.strokeRect(bx + 1, by + 1, bottom.w - 2, bottom.h - 2);

    this.menuHitZones = [];
    for (const t of this.menuLabelTexts) t.destroy();
    this.menuLabelTexts = [];
    let mx = bx + 10;
    const my = by + 10;
    for (const m of MAIN_MENUS) {
      const open = bottomSheet.kind === 'menu' && bottomSheet.menuKey === m.key;
      this.bottomG.fillStyle(hx(open ? '#3a4a6a' : colors.btn), 1);
      this.bottomG.lineStyle(1, hx(open ? colors.gold : colors.border), 1);
      this.bottomG.fillRoundedRect(mx, my, 70, 34, 4);
      this.menuHitZones.push({ x: mx, y: my, w: 70, h: 34, kind: 'menu', payload: m.key });
      const lab = this.scene.add
        .text(mx + 35, my + 17, m.label, {
          fontSize: '11px',
          color: open ? studioInk.accentSoft : colors.bright,
          fontFamily: studioFontUi,
          fontStyle: open ? 'bold' : 'normal',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(52);
      this.menuLabelTexts.push(lab);
      mx += 78;
    }

    const metaX = mx + 16;
    const ag = snapshot?.agents.find((a: Agent) => a.id === selectedAgentId);
    this.bottomMeta.setPosition(metaX, by + 18);
    this.bottomMeta.setText(
      snapshot
        ? `第 ${snapshot.day} 天  ${snapshot.time}  💰${snapshot.money}${ag ? `  对话:${ag.name}` : ''}  任务#:${selectedTaskId ?? '-'}`
        : '',
    );

    const btnY = by + 8;
    const rightBtnsX = bx + bottom.w - 220;
    for (const t of this.footerBtnTexts) t.destroy();
    this.footerBtnTexts = [];
    const addFooter = (label: string, ix: number, kind: string) => {
      const x = rightBtnsX + ix * 76;
      this.bottomG.fillStyle(hx(colors.btn), 1);
      this.bottomG.fillRoundedRect(x, btnY, 68, 34, 4);
      this.miscHitZones.push({ x, y: btnY, w: 68, h: 34, kind });
      const lab = this.scene.add
        .text(x + 34, btnY + 17, label, {
          fontSize: '11px',
          color: colors.bright,
          fontFamily: studioFontUi,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(52);
      this.footerBtnTexts.push(lab);
    };
    addFooter('新建', 0, 'newTask');
    addFooter('分配', 1, 'assign');
    addFooter('技能', 2, 'skills');

    const imgX = metaX + 200;
    this.bottomG.fillStyle(hx('#2a2a44'), 1);
    this.bottomG.fillRoundedRect(imgX, btnY, 32, 34, 4);
    this.imgBtnText.setPosition(imgX + 16, btnY + 17);
    this.miscHitZones.push({ x: imgX, y: btnY, w: 32, h: 34, kind: 'pickImage' });

    const taW = Math.max(160, rightBtnsX - imgX - 90);
    const tax = imgX + 40;
    const tay = by + 6;
    const inputH = Math.min(120, Math.max(34, bottom.h - 20));
    this.inputRect = { x: tax, y: tay, w: taW, h: inputH };

    const sendX = tax + taW + 8;
    const streaming = Boolean(selectedAgentId && useUiStore.getState().agentStreamIds[selectedAgentId]);
    this.chatInputEl.readOnly = streaming;
    this.bottomG.fillStyle(hx('#2a3a55'), 1);
    this.bottomG.fillRoundedRect(sendX, btnY, 52, 34, 4);
    this.sendBtnText.setPosition(sendX + 26, btnY + 17);
    this.sendBtnText.setText(streaming ? '停止' : '发送');
    this.sendBtnText.setStyle({ color: streaming ? '#ff8888' : colors.bright });
    this.miscHitZones.push({ x: sendX, y: btnY, w: 52, h: 34, kind: streaming ? 'stop' : 'send' });

    if (Date.now() > this.toastUntil) this.toastText.setVisible(false);
    else {
      this.toastText.setPosition(bx + bottom.w / 2, by - 6);
      this.toastText.setOrigin(0.5, 1);
    }

    this.layoutChatInputDom();
  }

  pointerDown(gx: number, gy: number): boolean {
    const hit = (z: HitZone) => gx >= z.x && gy >= z.y && gx <= z.x + z.w && gy <= z.y + z.h;
    const ir = this.inputRect;
    const onInput = gx >= ir.x && gy >= ir.y && gx <= ir.x + ir.w && gy <= ir.y + ir.h;
    if (!onInput) this.chatInputEl.blur();

    for (const z of this.menuHitZones) {
      if (hit(z) && z.payload) {
        this.getHandlers().onToggleMenu(z.payload);
        return true;
      }
    }
    for (const z of this.miscHitZones) {
      if (!hit(z)) continue;
      const h = this.getHandlers();
      if (z.kind === 'newTask') {
        h.onQuickNewTask();
        return true;
      }
      if (z.kind === 'assign') {
        h.onQuickAssign();
        return true;
      }
      if (z.kind === 'skills') {
        h.onQuickSkills();
        return true;
      }
      if (z.kind === 'send') {
        void this.onSendClick();
        return true;
      }
      if (z.kind === 'stop') {
        void stopStudioChat();
        return true;
      }
      if (z.kind === 'pickImage') {
        void this.pickFilesNative();
        return true;
      }
    }
    return false;
  }
}
