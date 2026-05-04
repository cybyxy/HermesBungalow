/**
 * 全页 Phaser 壳：顶栏、右侧会话/过程（遮罩滚动 Text）、底栏菜单。
 * 底栏输入为覆盖在画布上的原生 textarea（IME 中文、复制粘贴由浏览器处理）；选图仍用系统 API。
 */
import type Phaser from 'phaser';
import type { InferenceEntry } from '../store/uiStore';
import { useUiStore } from '../store/uiStore';
import { submitStudioChat, stopStudioChat } from '../chat/studioChatActions';
import { MAIN_MENUS } from '../ui/menuConfig';
import { colors, studioFontMeta, studioFontUi, studioInk } from '../ui/theme';
import type { FullPageLayout } from '../ui/fullPageLayout';
import type { Agent, GameWorldSnapshot } from '../types/game';
import type { BottomSheetState } from '../store/uiStore';
import { drawTopAgentAvatar, InferenceBubbleColumn } from './studioInferenceBubbles';

/** 顶栏 / 底栏与中央区错层，数值低于中央人物（~5000） */
const DEPTH_SHELL = 50;
/**
 * 右栏与中央人物（StudioScene ~5000）之间仅留小间隔；避免 depth 上万在部分 WebGL 下
 * 与 GeometryMask 合成异常导致整栏纯黑、盖住文字与气泡。
 */
const DEPTH_RIGHT_BG = 5010;
const DEPTH_RIGHT_G = 5012;
const DEPTH_RIGHT_LABELS = 5014;
const DEPTH_RIGHT_CHAT = 5018;
const DEPTH_RIGHT_TOOL = 5022;
const DEPTH_RIGHT_ACTS = 5032;
const DEPTH_RIGHT_TOAST = 5045;
/** 顶栏头像须高于右侧列里的 GeometryMask */
const DEPTH_TOP_AGENT = 5110;

export type ShellSyncSlice = {
  layout: FullPageLayout;
  snapshot: GameWorldSnapshot | null;
  inferenceLog: InferenceEntry[];
  gatewayStatus: string;
  loading: boolean;
  bottomSheet: BottomSheetState;
  selectedAgentId: string | null;
  selectedTaskId: number | null;
  rightPanelCollapsed: boolean;
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
  private topG: Phaser.GameObjects.Graphics;
  /** 右栏半透明底（Rectangle 的 fillAlpha 比 Graphics 在 WebGL 上更稳定） */
  private rightBackdrop!: Phaser.GameObjects.Rectangle;
  private rightG: Phaser.GameObjects.Graphics;
  private bottomG: Phaser.GameObjects.Graphics;
  private titleText: Phaser.GameObjects.Text;
  private subTopText: Phaser.GameObjects.Text;
  private rightTitle: Phaser.GameObjects.Text;
  private toolTitle: Phaser.GameObjects.Text;
  private chatBubbles: InferenceBubbleColumn;
  private toolBubbles: InferenceBubbleColumn;
  private topAgentG: Phaser.GameObjects.Graphics;
  private gwText: Phaser.GameObjects.Text;
  private lordText: Phaser.GameObjects.Text;
  private bottomMeta: Phaser.GameObjects.Text;
  private refreshText: Phaser.GameObjects.Text;
  private clearBtnText: Phaser.GameObjects.Text;
  private sendBtnText: Phaser.GameObjects.Text;
  private imgBtnText: Phaser.GameObjects.Text;
  private footerBtnTexts: Phaser.GameObjects.Text[] = [];
  private menuLabelTexts: Phaser.GameObjects.Text[] = [];
  private agentLetterTexts: Phaser.GameObjects.Text[] = [];
  private pendingFiles: File[] = [];
  private lastScrollPanelW = 0;
  private toastUntil = 0;
  private toastText: Phaser.GameObjects.Text;
  private collapseChevron: Phaser.GameObjects.Text;
  private agentHitZones: HitZone[] = [];
  private menuHitZones: HitZone[] = [];
  private miscHitZones: HitZone[] = [];

  private readonly chatInputEl: HTMLTextAreaElement;
  private inputRect = { x: 0, y: 0, w: 160, h: 34 };
  private readonly wheelHandler: (
    pointer: Phaser.Input.Pointer,
    _go: Phaser.GameObjects.GameObject[],
    _dx: number,
    dy: number,
    _dz: number,
    _ev: unknown,
  ) => void;
  private readonly textareaKeydown: (e: KeyboardEvent) => void;

  constructor(scene: Phaser.Scene, getSlice: () => ShellSyncSlice, getHandlers: () => ShellHandlers) {
    this.scene = scene;
    this.getSlice = getSlice;
    this.getHandlers = getHandlers;
    this.topG = scene.add.graphics().setDepth(DEPTH_SHELL);
    this.rightBackdrop = scene.add
      .rectangle(0, 0, 64, 64, 0x1a1a2e, 0.52)
      .setOrigin(0, 0)
      .setDepth(DEPTH_RIGHT_BG)
      .setStrokeStyle(2, hx(colors.border), 0.85);
    this.rightG = scene.add.graphics().setDepth(DEPTH_RIGHT_G);
    this.bottomG = scene.add.graphics().setDepth(DEPTH_SHELL);
    this.titleText = scene.add
      .text(0, 0, '', { fontSize: '16px', color: colors.gold, fontFamily: studioFontUi, fontStyle: 'bold' })
      .setDepth(DEPTH_SHELL + 1);
    this.titleText.setLetterSpacing(0.35);
    this.subTopText = scene.add
      .text(0, 0, '', { fontSize: '12px', color: studioInk.muted, fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 1);
    this.subTopText.setLetterSpacing(0.12);
    this.rightTitle = scene.add
      .text(0, 0, '💬 会话', { fontSize: '13px', color: studioInk.accentSoft, fontFamily: studioFontUi, fontStyle: 'bold' })
      .setDepth(DEPTH_RIGHT_LABELS);
    this.rightTitle.setLetterSpacing(0.2);
    this.toolTitle = scene.add
      .text(0, 0, '🔧 过程', { fontSize: '13px', color: studioInk.accentSoft, fontFamily: studioFontUi, fontStyle: 'bold' })
      .setDepth(DEPTH_RIGHT_LABELS);
    this.toolTitle.setLetterSpacing(0.2);
    this.chatBubbles = new InferenceBubbleColumn(scene, DEPTH_RIGHT_CHAT, 'chat');
    this.toolBubbles = new InferenceBubbleColumn(scene, DEPTH_RIGHT_TOOL, 'tool');
    this.topAgentG = scene.add.graphics().setDepth(DEPTH_TOP_AGENT);
    this.gwText = scene.add
      .text(0, 0, '', { fontSize: '10px', color: studioInk.muted, fontFamily: studioFontMeta })
      .setDepth(DEPTH_SHELL + 1);
    this.lordText = scene.add
      .text(0, 0, '', { fontSize: '11px', color: studioInk.accentSoft, fontFamily: studioFontUi, fontStyle: 'bold' })
      .setDepth(DEPTH_SHELL + 1);
    this.bottomMeta = scene.add
      .text(0, 0, '', { fontSize: '11px', color: studioInk.muted, fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 1);
    this.refreshText = scene.add
      .text(0, 0, '刷新', { fontSize: '12px', color: colors.bright, fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 2)
      .setOrigin(0.5);
    this.clearBtnText = scene.add
      .text(0, 0, '清空', { fontSize: '11px', color: studioInk.muted, fontFamily: studioFontUi })
      .setDepth(DEPTH_RIGHT_ACTS)
      .setOrigin(0.5);
    this.sendBtnText = scene.add
      .text(0, 0, '发送', { fontSize: '12px', color: colors.bright, fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 2)
      .setOrigin(0.5);
    this.imgBtnText = scene.add
      .text(0, 0, '🖼', { fontSize: '13px', fontFamily: studioFontUi })
      .setDepth(DEPTH_SHELL + 2)
      .setOrigin(0.5);
    this.collapseChevron = scene.add
      .text(0, 0, '▶', {
        fontSize: '15px',
        color: studioInk.accentSoft,
        fontFamily: studioFontUi,
        fontStyle: 'bold',
      })
      .setDepth(DEPTH_RIGHT_ACTS + 1)
      .setOrigin(0.5, 0.5)
      .setVisible(false);
    this.toastText = scene.add
      .text(0, 0, '', {
        fontSize: '12px',
        color: studioInk.body,
        fontFamily: studioFontUi,
        backgroundColor: '#1a1a30',
        padding: { x: 10, y: 6 },
      })
      .setDepth(DEPTH_RIGHT_TOAST)
      .setVisible(false);

    this.wheelHandler = (pointer, _go, _dx, dy) => {
      // 与 pointerDown 一致用 x/y（滚轮时 worldX/worldY 可能未与 transformPointer 同步）
      const px = pointer.x;
      const py = pointer.y;
      const d = dy !== 0 ? dy : pointer.deltaY;
      if (this.chatBubbles.tryWheel(px, py, d)) return;
      this.toolBubbles.tryWheel(px, py, d);
    };
    scene.input.on('wheel', this.wheelHandler);

    const ta = document.createElement('textarea');
    ta.autocomplete = 'off';
    ta.spellcheck = true;
    ta.placeholder = '输入消息 · Enter 发送 · Shift+Enter 换行 · 支持中文与粘贴';
    ta.tabIndex = 0;
    Object.assign(ta.style, {
      position: 'fixed',
      zIndex: '10000',
      boxSizing: 'border-box',
      margin: '0',
      padding: '8px',
      border: 'none',
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
      pointerEvents: 'none',
    });
    this.chatInputEl = ta;
    document.body.appendChild(ta);

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
  }

  private layoutChatInputDom(): void {
    const canvas = this.scene.game.canvas;
    const br = canvas.getBoundingClientRect();
    const scaleX = br.width / Math.max(1, canvas.width);
    const scaleY = br.height / Math.max(1, canvas.height);
    const { x, y, w, h } = this.inputRect;
    const el = this.chatInputEl;
    el.style.left = `${br.left + x * scaleX}px`;
    el.style.top = `${br.top + y * scaleY}px`;
    el.style.width = `${Math.max(0, w * scaleX)}px`;
    el.style.height = `${Math.max(0, h * scaleY)}px`;
    el.style.pointerEvents = document.activeElement === el ? 'auto' : 'none';
  }

  destroy(): void {
    this.scene.input.off('wheel', this.wheelHandler);
    this.chatInputEl.removeEventListener('keydown', this.textareaKeydown);
    this.chatInputEl.remove();
    this.chatBubbles.destroy();
    this.toolBubbles.destroy();
    this.destroyShellGraphics();
  }

  private destroyShellGraphics(): void {
    this.topG.destroy();
    this.topAgentG.destroy();
    this.rightBackdrop.destroy();
    this.rightG.destroy();
    this.bottomG.destroy();
    this.titleText.destroy();
    this.subTopText.destroy();
    this.rightTitle.destroy();
    this.toolTitle.destroy();
    this.gwText.destroy();
    this.lordText.destroy();
    this.bottomMeta.destroy();
    this.refreshText.destroy();
    this.clearBtnText.destroy();
    this.sendBtnText.destroy();
    this.imgBtnText.destroy();
    this.collapseChevron.destroy();
    this.toastText.destroy();
    for (const t of this.menuLabelTexts) t.destroy();
    for (const t of this.footerBtnTexts) t.destroy();
    for (const t of this.agentLetterTexts) t.destroy();
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
    const {
      layout,
      snapshot,
      inferenceLog,
      gatewayStatus,
      loading,
      bottomSheet,
      selectedAgentId,
      selectedTaskId,
      rightPanelCollapsed,
    } = s;
    const { top, right, bottom } = layout;
    const padX = 10;

    this.topG.clear();
    this.topG.fillStyle(hx('#151525'), 1);
    this.topG.lineStyle(2, hx(colors.border), 1);
    this.topG.fillRect(top.x, top.y, top.w, top.h);
    this.topG.strokeRect(top.x + 1, top.y + 1, top.w - 2, top.h - 2);

    this.titleText.setPosition(top.x + 16, top.y + 10);
    this.titleText.setText('Hermes 数字工作室');
    this.subTopText.setPosition(top.x + 16, top.y + 32);
    this.subTopText.setText(
      snapshot
        ? `第 ${snapshot.day} 天 ${snapshot.time} · 💰 ${snapshot.money} · 👥 ${snapshot.agents.length} · 📋 ${snapshot.tasks.length}`
        : '',
    );

    this.agentHitZones = [];
    for (const t of this.agentLetterTexts) t.destroy();
    this.agentLetterTexts = [];

    const rx = right.x;
    const ry = right.y;
    this.rightG.clear();
    /** 折叠：不展示右侧半透明底板（仅保留 ◀ 与点击热区，办公室全透） */
    if (rightPanelCollapsed) {
      this.rightBackdrop.setVisible(false);
    } else {
      this.rightBackdrop.setPosition(rx, ry);
      this.rightBackdrop.setSize(Math.max(1, right.w), Math.max(1, right.h));
      this.rightBackdrop.setVisible(true);
    }

    if (rightPanelCollapsed) {
      this.rightTitle.setVisible(false);
      this.toolTitle.setVisible(false);
      this.clearBtnText.setVisible(false);
      this.chatBubbles.setColumnVisible(false);
      this.toolBubbles.setColumnVisible(false);
      this.chatBubbles.layout(rx, ry, 0, 0);
      this.toolBubbles.layout(rx, ry, 0, 0);
      this.collapseChevron.setVisible(true);
      this.collapseChevron.setText('◀');
      this.collapseChevron.setPosition(rx + right.w / 2, ry + right.h / 2);
      this.miscHitZones.push({ x: rx, y: ry, w: right.w, h: right.h, kind: 'toggleRightPanel' });
    } else {
      this.chatBubbles.setColumnVisible(true);
      this.toolBubbles.setColumnVisible(true);
      this.rightTitle.setVisible(true);
      this.toolTitle.setVisible(true);
      this.clearBtnText.setVisible(true);
      const splitY = ry + Math.floor(right.h * 0.61);
      this.rightG.lineStyle(1, hx(colors.border), 0.45);
      this.rightG.lineBetween(rx + 8, splitY, rx + right.w - 8, splitY);

      const chatTop = ry + 32;
      const chatMaxH = Math.max(40, splitY - chatTop - 10);
      const toolBlockTop = splitY + 28;
      const toolMaxH = Math.max(36, ry + right.h - toolBlockTop - 12);

      const ww = Math.max(80, right.w - padX * 2);
      if (ww !== this.lastScrollPanelW) {
        this.lastScrollPanelW = ww;
      }

      this.rightTitle.setPosition(rx + 12, ry + 10);
      this.chatBubbles.layout(rx + padX, chatTop, ww, chatMaxH);
      this.chatBubbles.syncData(inferenceLog, snapshot, ww, selectedAgentId);

      this.toolTitle.setPosition(rx + 12, splitY + 8);
      this.toolBubbles.layout(rx + padX, toolBlockTop, ww, toolMaxH);
      this.toolBubbles.syncData(inferenceLog, snapshot, ww, selectedAgentId);

      const clearW = 44;
      const clearH = 22;
      const clearX = rx + right.w - clearW - 10;
      const clearY = ry + 8;
      const collapseBtnW = 28;
      const collapseX = clearX - collapseBtnW - 6;
      this.rightG.fillStyle(hx('#2a2a44'), 0.62);
      this.rightG.fillRoundedRect(collapseX, clearY, collapseBtnW, clearH, 4);
      this.collapseChevron.setVisible(true);
      this.collapseChevron.setText('▶');
      this.collapseChevron.setPosition(collapseX + collapseBtnW / 2, clearY + clearH / 2);
      this.miscHitZones.push({
        x: collapseX,
        y: clearY,
        w: collapseBtnW,
        h: clearH,
        kind: 'toggleRightPanel',
      });
      this.rightG.fillStyle(hx('#2a2a44'), 0.72);
      this.rightG.fillRoundedRect(clearX, clearY, clearW, clearH, 4);
      this.clearBtnText.setPosition(clearX + clearW / 2, clearY + clearH / 2);
      this.miscHitZones.push({ x: clearX, y: clearY, w: clearW, h: clearH, kind: 'clear' });
    }

    const lordX = top.x + top.w - 130;
    this.gwText.setPosition(lordX, top.y + 10);
    this.gwText.setText(`GW:${gatewayStatus}`);
    this.lordText.setPosition(lordX, top.y + 28);
    this.lordText.setText(snapshot ? `👑 Lv.${snapshot.lord_level}  XP:${snapshot.lord_xp}` : '');

    const refreshX = top.x + top.w - 52;
    const refreshY = top.y + top.h / 2 - 14;
    this.topG.fillStyle(hx(colors.btn), 1);
    this.topG.fillRoundedRect(refreshX, refreshY, 44, 28, 4);
    this.refreshText.setPosition(refreshX + 22, refreshY + 14);
    this.refreshText.setText(loading ? '…' : '刷新');
    this.miscHitZones.push({ x: refreshX, y: refreshY, w: 44, h: 28, kind: 'refresh' });

    this.topAgentG.clear();
    if (snapshot?.agents.length) {
      const startX = top.x + top.w * 0.36;
      const cy = top.y + top.h / 2;
      let ax = startX;
      for (const a of snapshot.agents) {
        const sel = a.id === selectedAgentId;
        this.agentHitZones.push({ x: ax - 22, y: cy - 22, w: 44, h: 44, kind: 'agent', payload: a.id });
        const texts = drawTopAgentAvatar(this.topAgentG, this.scene, ax, cy, 20, a, sel, DEPTH_TOP_AGENT);
        this.agentLetterTexts.push(...texts);
        ax += 46;
      }
    }

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
    const inputActive = document.activeElement === this.chatInputEl;
    this.bottomG.lineStyle(inputActive ? 2 : 1, inputActive ? hx(colors.gold) : hx(colors.border), 1);
    this.bottomG.strokeRoundedRect(tax, tay, taW, inputH, 6);
    this.miscHitZones.push({ x: tax, y: tay, w: taW, h: inputH, kind: 'focusInput' });

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

    for (const z of this.agentHitZones) {
      if (hit(z) && z.payload) {
        this.getHandlers().onOpenAgentDetail(z.payload);
        return true;
      }
    }
    for (const z of this.menuHitZones) {
      if (hit(z) && z.payload) {
        this.getHandlers().onToggleMenu(z.payload);
        return true;
      }
    }
    for (const z of this.miscHitZones) {
      if (!hit(z)) continue;
      if (z.kind === 'focusInput') {
        this.layoutChatInputDom();
        this.chatInputEl.focus({ preventScroll: true });
        return true;
      }
      const h = this.getHandlers();
      if (z.kind === 'refresh') {
        h.onRefresh();
        return true;
      }
      if (z.kind === 'toggleRightPanel') {
        useUiStore.getState().toggleStudioRightPanelCollapsed();
        return true;
      }
      if (z.kind === 'clear') {
        useUiStore.getState().clearInferenceLog();
        return true;
      }
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
