import Phaser from 'phaser';
import { studioFontUi } from '../ui/theme';

/**
 * 多行 Text + 几何遮罩垂直滚动。
 * 遮罩 Graphics 使用 make.graphics({ add: false })，与 Text 同为场景级坐标，
 * 避免「mask 在 Container 子级 + Text 被 mask」在部分 WebGL/像素模式下整块不显示。
 */
export class MaskedScrollText {
  private readonly maskShape: Phaser.GameObjects.Graphics;
  private readonly body: Phaser.GameObjects.Text;
  private scrollY = 0;
  private viewW = 100;
  private viewH = 100;
  /** 视口左上角（与 Phaser 指针坐标一致） */
  private viewX = 0;
  private viewY = 0;

  constructor(scene: Phaser.Scene, depth: number, fontSize: string, color: string) {
    this.maskShape = scene.add.graphics().setVisible(false).setDepth(depth - 0.01);
    this.body = scene.add.text(0, 0, '', {
      fontSize,
      color,
      fontFamily: studioFontUi,
      wordWrap: { width: 200, useAdvancedWrap: false },
      lineSpacing: 3,
    });
    this.body.setOrigin(0, 0);
    this.body.setDepth(depth);
    this.body.setMask(this.maskShape.createGeometryMask());
  }

  destroy(): void {
    this.body.clearMask(true);
    this.body.destroy();
    this.maskShape.destroy();
  }

  layout(worldX: number, worldY: number, ww: number, vh: number): void {
    this.viewX = worldX;
    this.viewY = worldY;
    this.viewW = ww;
    this.viewH = vh;
    this.maskShape.setPosition(worldX, worldY);
    this.maskShape.clear();
    this.maskShape.fillStyle(0xffffff, 1);
    this.maskShape.fillRect(0, 0, ww, vh);
    this.body.setStyle({ wordWrap: { width: Math.max(40, ww - 8), useAdvancedWrap: false } });
    this.clampScroll();
    this.applyScroll();
  }

  setContent(text: string, stickToBottom: boolean): void {
    const prevMax = this.maxScroll();
    const prevY = this.scrollY;
    const nearBottom = prevMax <= 2 || prevMax - prevY < 48;
    this.body.setText(text);
    const m = this.maxScroll();
    if (stickToBottom || nearBottom) this.scrollY = m;
    else this.scrollY = Phaser.Math.Clamp(prevY, 0, m);
    this.applyScroll();
  }

  private maxScroll(): number {
    return Math.max(0, this.body.height - this.viewH + 8);
  }

  private clampScroll(): void {
    this.scrollY = Phaser.Math.Clamp(this.scrollY, 0, this.maxScroll());
  }

  private applyScroll(): void {
    this.body.setPosition(this.viewX + 4, this.viewY + 4 - this.scrollY);
  }

  /** @returns true 表示已消费滚轮（在面板内） */
  tryWheel(worldX: number, worldY: number, deltaY: number): boolean {
    if (!this.contains(worldX, worldY)) return false;
    const step = deltaY > 0 ? 36 : deltaY < 0 ? -36 : 0;
    this.scrollY = Phaser.Math.Clamp(this.scrollY + step, 0, this.maxScroll());
    this.applyScroll();
    return true;
  }

  contains(worldX: number, worldY: number): boolean {
    return (
      worldX >= this.viewX &&
      worldY >= this.viewY &&
      worldX <= this.viewX + this.viewW &&
      worldY <= this.viewY + this.viewH
    );
  }
}
