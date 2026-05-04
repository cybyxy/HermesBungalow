import Phaser from 'phaser';
import type { InferenceEntry, InferenceVariant } from '../store/uiStore';
import type { Agent, GameWorldSnapshot } from '../types/game';
import { colors, professionColor, studioFontMeta, studioFontUi, studioInk } from '../ui/theme';

function hx(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

export function stripInferenceBody(s: string, maxLen: number): string {
  const t = s.replace(/\r/g, '').replace(/```[\s\S]*?```/g, '…').trim();
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

function entryBubbleStyle(v: InferenceVariant): { border: number; fill: number; fa: number } {
  if (v === 'user') return { border: hx('#4a5a8a'), fill: hx('#2a3858'), fa: 0.76 };
  if (v === 'status') return { border: hx('#3a4558'), fill: hx('#1e2337'), fa: 0.72 };
  if (v === 'error') return { border: hx('#8a3a3a'), fill: hx('#3c1414'), fa: 0.78 };
  if (v === 'reasoning') return { border: hx('#5a4a8a'), fill: hx('#322846'), fa: 0.7 };
  if (v === 'tool_start') return { border: hx('#8a7a2a'), fill: hx('#5a501e'), fa: 0.72 };
  if (v === 'tool_done') return { border: hx('#2a6a4a'), fill: hx('#1a5038'), fa: 0.72 };
  if (v === 'tool_failed') return { border: hx('#8a4a2a'), fill: hx('#5a281a'), fa: 0.78 };
  return { border: hx('#2a4a3a'), fill: hx('#1a3a2a'), fa: 0.7 };
}

export function userInferenceTargetNamePh(e: InferenceEntry, snapshot: GameWorldSnapshot): string {
  const body = (e.body || '').trim();
  const relayM = body.match(/^\/relay\s+(\S+)\s*\|\s*/i);
  if (relayM) {
    const token = relayM[1]!.trim();
    const hit = snapshot.agents.find((a) => a.id === token || a.profile === token || a.name === token);
    return hit?.name ?? token;
  }
  const atM = body.match(/^@(\S+)\s*[|｜]\s*/);
  if (atM) {
    const token = atM[1]!.trim();
    const hit = snapshot.agents.find((a) => a.id === token || a.profile === token || a.name === token);
    return hit?.name ?? token;
  }
  if (e.agentId) {
    const hit = snapshot.agents.find((a) => a.id === e.agentId);
    if (hit?.name) return hit.name;
  }
  return 'Agent';
}

export function inferenceRoleLabelPh(e: InferenceEntry, agent: Agent | undefined): string {
  if (e.variant === 'user') return '';
  if (e.variant === 'error') {
    const h = (e.headline || '').trim();
    return h && h !== '系统' ? h : '系统';
  }
  const p = (agent?.profession || '').trim();
  if (p) return p;
  const h = e.headline || '';
  const i = h.indexOf(' · ');
  if (i >= 0) return h.slice(i + 3).trim() || h;
  return h || 'Agent';
}

export function agentAvatarLabelLetter(a: Agent): string {
  const raw = a.display_name || a.name;
  const m = raw.match(/[\u4e00-\u9fff]/);
  if (m) return m[0]!;
  return raw[0] ?? '?';
}

function agentStatusGlyph(status: string): string {
  if (status === 'working') return '💻';
  if (status === 'resting') return '😴';
  return '🟡';
}

/** 顶栏小圆：职业色环 + 首字 + 右下角状态 */
export function drawTopAgentAvatar(
  g: Phaser.GameObjects.Graphics,
  scene: Phaser.Scene,
  cx: number,
  cy: number,
  r: number,
  agent: Agent,
  selected: boolean,
  depth: number,
): Phaser.GameObjects.Text[] {
  const outs: Phaser.GameObjects.Text[] = [];
  const ring = hx(professionColor(agent.profession));
  g.fillStyle(hx('#252538'), 1);
  g.fillCircle(cx, cy, r);
  g.lineStyle(selected ? 3 : 2, selected ? hx(colors.gold) : ring, 1);
  g.strokeCircle(cx, cy, r);
  const lt = scene.add
    .text(cx, cy, agentAvatarLabelLetter(agent), {
      fontSize: `${Math.max(11, Math.round(r * 0.65))}px`,
      color: colors.bright,
      fontFamily: studioFontUi,
      fontStyle: 'bold',
    })
    .setOrigin(0.5, 0.5)
    .setDepth(depth);
  outs.push(lt);
  const st = scene.add
    .text(cx + r * 0.55, cy + r * 0.45, agentStatusGlyph(agent.status), {
      fontSize: `${Math.max(8, Math.round(r * 0.36))}px`,
      fontFamily: studioFontUi,
    })
    .setOrigin(0.5, 0.5)
    .setDepth(depth + 0.1);
  outs.push(st);
  return outs;
}

function toolGlyph(v: InferenceVariant): string {
  if (v === 'tool_start') return '→';
  if (v === 'tool_done') return '✓';
  if (v === 'tool_failed') return '✗';
  return '•';
}

function toolGlyphColor(v: InferenceVariant): string {
  if (v === 'tool_done') return '#5fda7a';
  if (v === 'tool_failed') return '#ff8888';
  return '#aaaaaa';
}

type MaskableGo = Phaser.GameObjects.GameObject & {
  clearMask(destroy?: boolean): Phaser.GameObjects.GameObject;
  setMask(mask: Phaser.Display.Masks.BitmapMask | Phaser.Display.Masks.GeometryMask | null): Phaser.GameObjects.GameObject;
};

function asMaskable(go: Phaser.GameObjects.GameObject): MaskableGo {
  return go as MaskableGo;
}

/**
 * 递归摘掉 mask 并销毁 GeometryMask 实例（每个叶子各自持有一份 mask，见 applyMaskLeaves）。
 */
function clearMaskDeep(go: Phaser.GameObjects.GameObject): void {
  const c = go as Phaser.GameObjects.Container;
  if (c.list && c.list.length > 0) {
    for (const ch of c.list as Phaser.GameObjects.GameObject[]) {
      clearMaskDeep(ch);
    }
  }
  asMaskable(go).clearMask(true);
}

/**
 * 只对叶子 setMask。每个叶子使用 **独立** GeometryMask、同源 `maskGfx`，避免多对象共用一个 GeometryMask
 * 时在 destroy/clear 后 `geometryMask` 被置 null，进而 `applyStencil` 里 `geometryMask.renderWebGL` 报错。
 */
function applyMaskLeaves(
  go: Phaser.GameObjects.GameObject,
  scene: Phaser.Scene,
  maskGfx: Phaser.GameObjects.Graphics,
): void {
  const c = go as Phaser.GameObjects.Container;
  if (c.list && c.list.length > 0) {
    for (const ch of c.list as Phaser.GameObjects.GameObject[]) {
      applyMaskLeaves(ch, scene, maskGfx);
    }
    return;
  }
  const m = new Phaser.Display.Masks.GeometryMask(scene, maskGfx);
  asMaskable(go).setMask(m);
}

/**
 * 右侧会话 / 过程：气泡列表。裁剪：每个叶子独立 GeometryMask，同源 maskGfx 矩形（避免共用一个 GeometryMask 在 WebGL 下损坏）。
 */
export class InferenceBubbleColumn {
  private readonly scene: Phaser.Scene;
  private readonly maskGfx: Phaser.GameObjects.Graphics;
  private readonly outer: Phaser.GameObjects.Container;
  private readonly inner: Phaser.GameObjects.Container;
  private scrollY = 0;
  private viewX = 0;
  private viewY = 0;
  private viewW = 0;
  private viewH = 0;
  private contentH = 0;
  private lastSig = '';
  private lastW = -1;
  /** 避免每帧 clear mask 图形导致 GeometryMask 源被掏空、子节点整块不显示 */
  private lastMaskGeomW = -1;
  private lastMaskGeomH = -1;
  private readonly mode: 'chat' | 'tool';

  constructor(scene: Phaser.Scene, depth: number, mode: 'chat' | 'tool') {
    this.scene = scene;
    this.mode = mode;
    this.maskGfx = scene.add.graphics().setVisible(false).setDepth(depth - 0.02);
    this.outer = scene.add.container(0, 0).setDepth(depth);
    this.inner = scene.add.container(0, 0);
    this.outer.add(this.inner);
  }

  setColumnVisible(visible: boolean): void {
    this.outer.setVisible(visible);
  }

  destroy(): void {
    clearMaskDeep(this.inner);
    this.outer.destroy(true);
    this.maskGfx.destroy();
  }

  layout(x: number, y: number, w: number, h: number): void {
    this.viewX = x;
    this.viewY = y;
    this.viewW = w;
    this.viewH = h;
    this.outer.setPosition(x, y);
    this.maskGfx.setPosition(x, y);
    const geomChanged = w !== this.lastMaskGeomW || h !== this.lastMaskGeomH;
    if (geomChanged) {
      this.lastMaskGeomW = w;
      this.lastMaskGeomH = h;
      this.maskGfx.clear();
      this.maskGfx.fillStyle(0xffffff, 1);
      this.maskGfx.fillRect(0, 0, w, h);
      if (this.inner.length > 0) {
        this.applyMaskToInner();
      }
    }
    this.clampScroll();
    this.inner.setY(-this.scrollY);
  }

  private maxScroll(): number {
    return Math.max(0, this.contentH - this.viewH + 6);
  }

  private clampScroll(): void {
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll());
  }

  stickToBottom(): void {
    this.scrollY = this.maxScroll();
    this.clampScroll();
    this.inner.setY(-this.scrollY);
  }

  tryWheel(worldX: number, worldY: number, deltaY: number): boolean {
    if (!this.outer.visible) return false;
    if (
      worldX < this.viewX ||
      worldY < this.viewY ||
      worldX > this.viewX + this.viewW ||
      worldY > this.viewY + this.viewH
    ) {
      return false;
    }
    const mag = Math.abs(deltaY);
    if (mag < 0.5) return true;
    const step = Math.sign(deltaY) * Math.min(100, Math.max(18, mag * 0.45));
    this.scrollY = Phaser.Math.Clamp(this.scrollY + step, 0, this.maxScroll());
    this.inner.setY(-this.scrollY);
    return true;
  }

  private applyMaskToInner(): void {
    clearMaskDeep(this.inner);
    for (const ch of this.inner.list as Phaser.GameObjects.GameObject[]) {
      applyMaskLeaves(ch, this.scene, this.maskGfx);
    }
  }

  syncData(
    log: InferenceEntry[],
    snapshot: GameWorldSnapshot | null,
    ww: number,
    selectedAgentId: string | null = null,
  ): void {
    const snap: GameWorldSnapshot =
      snapshot ??
      ({
        day: 0,
        time: '',
        money: 0,
        lord_level: 0,
        lord_xp: 0,
        agents: [],
        tasks: [],
        rooms: [],
        competition_history: [],
      } as GameWorldSnapshot);
    const vis =
      this.mode === 'chat'
        ? log.filter((e) => e.variant === 'user' || e.variant === 'reply' || e.variant === 'error')
        : log.filter(
            (e) =>
              e.variant === 'tool_start' ||
              e.variant === 'tool_done' ||
              e.variant === 'tool_failed' ||
              e.variant === 'reasoning' ||
              e.variant === 'status',
          );
    /** 须覆盖「过程」列里任意一条 body 的更新；仅用尾部会与 reply 流交错时漏掉推理刷新 */
    const visDigest = vis.map((e) => `${e.id}:${e.variant}:${(e.body || '').length}`).join('|');
    const sig = `${ww}|${vis.length}|${visDigest}`;
    const innerEmptyButShouldShow = vis.length > 0 && this.inner.length === 0;
    if (sig === this.lastSig && !innerEmptyButShouldShow) {
      // 数据未变时不要每帧 stickToBottom，否则会抵消用户滚轮位置
      this.clampScroll();
      this.inner.setY(-this.scrollY);
      return;
    }
    clearMaskDeep(this.inner);
    this.inner.removeAll(true);
    this.scrollY = 0;

    const innerW = Math.max(40, ww - 4);
    try {
      if (!vis.length) {
        const empty =
          this.mode === 'chat'
            ? '推理过程与最终回复将显示在此。'
            : '工具调用与推理过程将显示在此。';
        const t = this.scene.add.text(4, 6, empty, {
          fontSize: '12px',
          color: studioInk.muted,
          fontFamily: studioFontUi,
          wordWrap: { width: Math.max(32, innerW - 8), useAdvancedWrap: true },
          lineSpacing: 3,
        });
        this.inner.add(t);
        asMaskable(t).setMask(new Phaser.Display.Masks.GeometryMask(this.scene, this.maskGfx));
        this.contentH = t.height + 20;
        this.stickToBottom();
        this.lastSig = sig;
        this.lastW = ww;
        return;
      }

      let y = 0;
      const gap = this.mode === 'chat' ? 10 : 6;
      const slice = vis.slice(Math.max(0, vis.length - 32));
      for (const e of slice) {
        const built =
          this.mode === 'chat'
            ? this.buildChatBlock(e, snap, innerW, selectedAgentId)
            : this.buildToolBlock(e, snap, innerW, selectedAgentId);
        built.container.setPosition(0, y);
        this.inner.add(built.container);
        y += built.height + gap;
      }
      this.contentH = Math.max(y - gap, 40);
      this.applyMaskToInner();
      this.stickToBottom();
      this.lastSig = sig;
      this.lastW = ww;
    } catch (err) {
      // 若在 lastSig 更新前抛错，下一帧仍会重试；若已清空 inner 却写入了 lastSig，会永久空白
      console.error(`[InferenceBubbleColumn:${this.mode}] syncData`, err);
      this.lastSig = '';
      this.lastW = -1;
    }
  }

  private buildChatBlock(
    e: InferenceEntry,
    snapshot: GameWorldSnapshot,
    innerW: number,
    selectedAgentId: string | null,
  ): { container: Phaser.GameObjects.Container; height: number } {
    const c = this.scene.add.container(0, 0);
    let agent = e.agentId ? snapshot.agents.find((a) => a.id === e.agentId) : undefined;
    if (!agent && selectedAgentId && (e.variant === 'reply' || e.variant === 'error')) {
      agent = snapshot.agents.find((a) => a.id === selectedAgentId);
    }
    const isUser = e.variant === 'user';
    const AV = 26;
    const maxBubble = Math.min(268, innerW - AV - 10);
    const bw = maxBubble;
    const time = new Date(e.at).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const sty = entryBubbleStyle(e.variant);
    const bodyStr = stripInferenceBody(e.body || '', 8000);
    const bodyColor =
      e.variant === 'error' ? studioInk.errorSoft : isUser ? studioInk.userBody : studioInk.replyBody;
    const bx = isUser ? innerW - bw - (AV + 6) : AV + 6;

    const timeT = this.scene.add.text(isUser ? 4 : innerW - 4, 2, time, {
      fontSize: '10px',
      color: studioInk.muted,
      fontFamily: studioFontMeta,
    });
    if (!isUser) timeT.setOrigin(1, 0);

    const headerRowTexts: Phaser.GameObjects.Text[] = [timeT];
    let headerH = 18;
    if (isUser) {
      const target = userInferenceTargetNamePh(e, snapshot);
      const nameW = Math.max(48, innerW - AV - 110);
      const nameT = this.scene.add.text(innerW - AV - 8, 2, target, {
        fontSize: '11px',
        color: studioInk.accentSoft,
        fontFamily: studioFontUi,
        fontStyle: 'bold',
        wordWrap: { width: nameW, useAdvancedWrap: true },
        align: 'right',
        maxLines: 3,
      });
      nameT.setOrigin(1, 0);
      headerRowTexts.push(nameT);
      headerH = Math.max(18, Math.max(timeT.height, nameT.height) + 6);
    } else {
      const role = inferenceRoleLabelPh(e, agent);
      const roleW = Math.max(48, innerW - AV - 120);
      const roleT = this.scene.add.text(AV + 10, 2, role, {
        fontSize: '11px',
        color: studioInk.accentSoft,
        fontFamily: studioFontUi,
        fontStyle: 'bold',
        wordWrap: { width: roleW, useAdvancedWrap: true },
        maxLines: 3,
      });
      headerRowTexts.push(roleT);
      headerH = Math.max(18, Math.max(timeT.height, roleT.height) + 6);
    }

    /** 过小会触发 Phaser advancedWordWrap 在单字过宽时抛错；略大于气泡时由右侧 mask 裁切 */
    const wrapW = Math.max(32, bw - 16);
    const bodyText = this.scene.add.text(0, 0, bodyStr, {
      fontSize: '12px',
      color: bodyColor,
      fontFamily: studioFontUi,
      /** basic 换行只在空格处断开；无空格中文整段会单行溢出气泡 */
      wordWrap: { width: wrapW, useAdvancedWrap: true },
      lineSpacing: 4,
    });
    const bubbleH = Math.max(28, bodyText.height + 14);
    const rowH = headerH + bubbleH + 4;

    const g = this.scene.add.graphics();
    c.add(g);
    g.fillStyle(sty.fill, sty.fa);
    g.lineStyle(1, sty.border, 1);
    g.fillRoundedRect(bx, headerH, bw, bubbleH, 10);
    g.strokeRoundedRect(bx, headerH, bw, bubbleH, 10);
    bodyText.setPosition(bx + 8, headerH + 7);
    c.add(bodyText);
    for (const ht of headerRowTexts) {
      c.add(ht);
    }

    if (isUser) {
      const ring = hx(colors.gold);
      g.fillStyle(hx('#2a2848'), 1);
      g.lineStyle(2, ring, 1);
      const acx = innerW - AV / 2 - 2;
      const acy = headerH / 2 + 2;
      g.fillCircle(acx, acy, AV / 2);
      g.strokeCircle(acx, acy, AV / 2);
      const me = this.scene.add.text(acx, acy, '我', {
        fontSize: '12px',
        color: studioInk.accentSoft,
        fontFamily: studioFontUi,
        fontStyle: 'bold',
      }).setOrigin(0.5, 0.5);
      c.add(me);
    } else {
      const ring = agent ? hx(professionColor(agent.profession)) : hx('#555555');
      const acx = AV / 2 + 2;
      const acy = headerH / 2 + 2;
      g.fillStyle(hx('#252540'), 1);
      g.lineStyle(2, ring, 1);
      g.fillCircle(acx, acy, AV / 2);
      g.strokeCircle(acx, acy, AV / 2);
      const letter = this.scene.add.text(acx, acy, agent ? agentAvatarLabelLetter(agent) : '?', {
        fontSize: '12px',
        color: colors.bright,
        fontFamily: studioFontUi,
        fontStyle: 'bold',
      }).setOrigin(0.5, 0.5);
      c.add(letter);
      if (agent) {
        const badge = this.scene.add.text(acx + AV * 0.32, acy + AV * 0.28, agentStatusGlyph(agent.status), {
          fontSize: '9px',
          fontFamily: studioFontUi,
        }).setOrigin(0.5, 0.5);
        c.add(badge);
      }
    }

    return { container: c, height: rowH };
  }

  private buildToolBlock(
    e: InferenceEntry,
    snapshot: GameWorldSnapshot,
    innerW: number,
    selectedAgentId: string | null,
  ): { container: Phaser.GameObjects.Container; height: number } {
    const c = this.scene.add.container(0, 0);
    let agent = e.agentId ? snapshot.agents.find((a) => a.id === e.agentId) : undefined;
    if (!agent && selectedAgentId) {
      agent = snapshot.agents.find((a) => a.id === selectedAgentId);
    }
    const sty = entryBubbleStyle(e.variant);
    const role = inferenceRoleLabelPh(e, agent);
    const time = new Date(e.at).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    const bodyStr = stripInferenceBody(e.body || '', 4000);
    const AV = 22;
    const textW = Math.max(40, innerW - AV - 20);
    const glyph = this.scene.add.text(AV + 12, 4, toolGlyph(e.variant), {
      fontSize: '10px',
      color: toolGlyphColor(e.variant),
      fontFamily: studioFontUi,
      fontStyle: 'bold',
    });
    const roleLineW = Math.max(40, innerW - AV - 100);
    const roleT = this.scene.add.text(AV + 28, 4, role, {
      fontSize: '11px',
      color: studioInk.accentSoft,
      fontFamily: studioFontUi,
      fontStyle: 'bold',
      wordWrap: { width: roleLineW, useAdvancedWrap: true },
      maxLines: 3,
    });
    const timeT = this.scene.add.text(innerW - 10, 4, time, {
      fontSize: '10px',
      color: studioInk.muted,
      fontFamily: studioFontMeta,
    });
    timeT.setOrigin(1, 0);
    const headH = Math.max(18, Math.max(glyph.height, roleT.height, timeT.height) + 8);

    const bodyText = this.scene.add.text(0, 0, bodyStr, {
      fontSize: '11px',
      color: studioInk.toolBody,
      fontFamily: studioFontUi,
      wordWrap: { width: textW, useAdvancedWrap: true },
      lineSpacing: 3,
    });
    const pad = 8;
    const bubbleH = headH + bodyText.height + pad * 2;
    const rowH = bubbleH + 4;

    const g = this.scene.add.graphics();
    c.add(g);
    g.fillStyle(sty.fill, sty.fa);
    g.lineStyle(1, sty.border, 1);
    g.fillRoundedRect(2, 0, innerW - 4, bubbleH, 8);
    g.strokeRoundedRect(2, 0, innerW - 4, bubbleH, 8);

    const acx = AV / 2 + 6;
    const acy = headH / 2 + 1;
    const ring = agent ? hx(professionColor(agent.profession)) : hx('#555555');
    g.fillStyle(hx('#252540'), 1);
    g.lineStyle(2, ring, 1);
    g.fillCircle(acx, acy, AV / 2);
    g.strokeCircle(acx, acy, AV / 2);
    const letter = this.scene.add.text(acx, acy, agent ? agentAvatarLabelLetter(agent) : '?', {
      fontSize: '11px',
      color: colors.bright,
      fontFamily: studioFontUi,
      fontStyle: 'bold',
    }).setOrigin(0.5, 0.5);
    c.add(letter);
    if (agent) {
      const badge = this.scene.add.text(acx + AV * 0.32, acy + AV * 0.28, agentStatusGlyph(agent.status), {
        fontSize: '8px',
        fontFamily: studioFontUi,
      }).setOrigin(0.5, 0.5);
      c.add(badge);
    }

    c.add(glyph);
    c.add(roleT);
    c.add(timeT);
    bodyText.setPosition(AV + 12, headH + 2);
    c.add(bodyText);

    return { container: c, height: rowH };
  }
}
