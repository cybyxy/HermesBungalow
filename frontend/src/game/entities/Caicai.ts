import * as Phaser from 'phaser';

/**
 * 崽崽角色实体 — 需求分析师的数字形象
 *
 * 结构：
 * - 身体: caicai_body (三帧四方向精灵图, 96x192, 32x48/格)
 *   - Row 0 (frames 0-2): 向下 — 待机→迈步→待机
 *   - Row 1 (frames 3-5): 向左
 *   - Row 2 (frames 6-8): 向右
 *   - Row 3 (frames 9-11): 向上（背面）
 * - 表情: expression1/expression2 (精灵图, 400x800, 5列x8行=40格, 每格80x100)
 */

// 表情类型定义 — 对应Llm回复中的语义标签
export type ExpressionType =
  | 'happy'        // 开心/爱心眼 (expression1)
  | 'thinking'     // 思考/戴眼镜 (expression1)
  | 'surprised'    // 惊讶 (expression1)
  | 'sweating'     // 流汗/紧张 (expression2)
  | 'crying'       // 哭泣/悲伤 (expression2)
  | 'eating'       // 吃东西 (expression2)
  | 'none';        // 无表情

// 语义 → 表情的映射规则
export const SEMANTIC_TO_EXPRESSION: Record<string, ExpressionType> = {
  happy: 'happy',
  welcome: 'happy',
  thanks: 'happy',
  agree: 'happy',
  thinking: 'thinking',
  search: 'thinking',
  analyze: 'thinking',
  confused: 'surprised',
  surprised: 'surprised',
  shocked: 'surprised',
  nervous: 'sweating',
  embarrassed: 'sweating',
  stressed: 'sweating',
  sad: 'crying',
  sorry: 'crying',
  eating: 'eating',
  coffee: 'happy',
};

// 表情素材帧索引映射 (spritesheet: 5列x8行, frameWidth=80, frameHeight=100)
// expression1: 😈💬💀🔥💧 | expression2: 💦💧等
const EXPRESSION_FRAMES: Record<ExpressionType, { key: string; frame: number }> = {
  happy:       { key: 'expression1', frame: 0 },     // Row0-Col0 😈
  thinking:    { key: 'expression1', frame: 5 },     // Row1-Col0 💬
  surprised:   { key: 'expression1', frame: 9 },     // Row2-Col4 💀
  sweating:    { key: 'expression2', frame: 35 },    // Row7-Col0 💦
  crying:      { key: 'expression2', frame: 36 },    // Row7-Col1 💦
  eating:      { key: 'expression2', frame: 21 },    // Row5-Col1 🔥
  none:        null as any,
};

// 行走方向枚举 — 对应精灵图的4行
export type WalkDirection = 'down' | 'left' | 'right' | 'up';

/**
 * 构建动画帧数组 - Phaser 3 需要 { key, frame } 对象格式
 */
function makeFrames(key: string, indices: number[]): Phaser.Animations.AnimationFrame[] {
  return indices.map((i) => ({ key, frame: i }));
}

export class Caicai {
  private scene: Phaser.Scene;
  private body!: Phaser.GameObjects.Sprite;          // 身体精灵 (caicai_body spritesheet)
  private expressionBubble!: Phaser.GameObjects.Container; // 头顶表情气泡
  private currentExpression: ExpressionType = 'none';
  private currentDirection: WalkDirection = 'down';  // 当前朝向
  private isWalking: boolean = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.createBody(x, y);
    this.createExpressionBubble();
  }

  /**
   * 创建崽崽身体 — 使用 caicai_body (三帧四方向精灵图)
   */
  private createBody(x: number, y: number): void {
    // 创建精灵，默认显示第0帧（向下-待机）
    this.body = this.scene.add.sprite(x, y, 'caicai_body', 0);
    this.body.setScale(1);        // 原大小：32x48
    this.body.setOrigin(0.5, 1);   // 锚点居中底部，方便行走定位
    this.body.setInteractive({ cursor: 'pointer' });

    // === 注册精灵图动画（使用正确的 { key, frame } 格式）===
    const anims = this.scene.anims;
    const key = 'caicai_body';

    // idle-down / walk-down: 向下 (frames 0→1→2)
    anims.create({ key: 'idle-down', frames: makeFrames(key, [0, 1, 2]), frameRate: 4, repeat: -1 });
    anims.create({ key: 'walk-down', frames: makeFrames(key, [0, 1, 2]), frameRate: 8, repeat: -1 });

    // idle-left / walk-left: 向左 (frames 3→4→5)
    anims.create({ key: 'idle-left', frames: makeFrames(key, [3, 4, 5]), frameRate: 4, repeat: -1 });
    anims.create({ key: 'walk-left', frames: makeFrames(key, [3, 4, 5]), frameRate: 8, repeat: -1 });

    // idle-right / walk-right: 向右 (frames 6→7→8)
    anims.create({ key: 'idle-right', frames: makeFrames(key, [6, 7, 8]), frameRate: 4, repeat: -1 });
    anims.create({ key: 'walk-right', frames: makeFrames(key, [6, 7, 8]), frameRate: 8, repeat: -1 });

    // idle-up / walk-up: 向上/背面 (frames 9→10→11)
    anims.create({ key: 'idle-up', frames: makeFrames(key, [9, 10, 11]), frameRate: 4, repeat: -1 });
    anims.create({ key: 'walk-up', frames: makeFrames(key, [9, 10, 11]), frameRate: 8, repeat: -1 });

    // === 默认播放向下待机动画 ===
    this.body.play('idle-down');

    // 点击崽崽触发对话
    this.body.on('pointerdown', () => {
      console.log('[Caicai] 被点击了！');
      window.dispatchEvent(new CustomEvent('caicai-click'));
      this.showExpression('surprised');
    });
  }

  /**
   * 创建头顶表情气泡容器
   */
  private createExpressionBubble(): void {
    const x = this.body.x;
    const y = this.body.y - 30; // 在崽崽头顶上方（原大小32x48）

    this.expressionBubble = this.scene.add.container(x, y);
    this.expressionBubble.setDepth(10_000); // 表情气泡始终在最上层
    this.expressionBubble.setVisible(false);
  }

  /**
   * 切换朝向 — 根据行走方向播放对应的待机动画
   */
  private switchDirection(dir: WalkDirection): void {
    if (this.currentDirection === dir) return;
    this.currentDirection = dir;
    const animKey = `idle-${dir}`;
    if (!this.isWalking && this.body.anims?.currentAnim?.key !== animKey) {
      this.body.play(animKey);
    }
  }

  /**
   * 显示表情 — 在崽崽头顶弹出对应表情图标
   * @param type 表情类型
   * @param duration 显示时长(ms)，默认2000ms后消失
   */
  showExpression(type: ExpressionType, duration = 2000): void {
    this.currentExpression = type;

    if (type === 'none') {
      this.expressionBubble.setVisible(false);
      return;
    }

    const frameInfo = EXPRESSION_FRAMES[type];
    if (!frameInfo) return;

    // 清除旧表情
    while (this.expressionBubble.count > 0) {
      this.expressionBubble.removeAt(0, true);
    }

    // 从精灵图中选帧显示对应图标 — setFrame 是 spritesheet 的关键！
    const icon = this.scene.add.sprite(0, -20, frameInfo.key)
      .setFrame(frameInfo.frame)   // ⬅️ 关键：选择精灵图中的具体帧
      .setScale(1.5)
      .setAlpha(0.9);

    // 添加白色气泡背景 — 用 Graphics 画圆角矩形（Rectangle 没有 setRadius）
    const graphics = this.scene.add.graphics();
    graphics.fillStyle(0xffffff, 0.85);
    graphics.lineStyle(2, 0xff69b4);
    graphics.fillRoundedRect(-24, -44, 48, 48, 12); // x,y,w,h,radius
    graphics.strokeRoundedRect(-24, -44, 48, 48, 12);

    this.expressionBubble.add([graphics, icon]);
    this.expressionBubble.setVisible(true);

    // 表情弹出动画 — 从下往上弹入
    this.expressionBubble.setScale(0.3).setAlpha(0);
    this.scene.tweens.add({
      targets: this.expressionBubble,
      scale: { from: 0.3, to: 1 },
      alpha: { from: 0, to: 1 },
      duration: 300,
      ease: 'Back.easeOut',
    });

    // 表情轻微上下浮动
    this.scene.tweens.add({
      targets: this.expressionBubble,
      y: { from: -25, to: -15 },
      duration: 800,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: Math.floor(duration / 800),
    });

    // 定时消失 — 淡出动画
    setTimeout(() => {
      this.scene.tweens.add({
        targets: this.expressionBubble,
        scale: { from: 1, to: 0.3 },
        alpha: { from: 1, to: 0 },
        duration: 250,
        ease: 'Sine.easeIn',
        onComplete: () => {
          this.expressionBubble.setVisible(false);
          this.currentExpression = 'none';
        },
      });
    }, duration);

    // 同步到全局状态
    window.dispatchEvent(new CustomEvent('caicai-expression', {
      detail: { type, timestamp: Date.now() },
    }));
  }

  /**
   * 根据语义标签自动切换表情
   */
  setExpressionFromSemantic(semanticTag: string): void {
    const expression = SEMANTIC_TO_EXPRESSION[semanticTag.toLowerCase()] || 'happy';
    this.showExpression(expression);
  }

  /**
   * 让崽崽走向指定位置 — 自动判断方向并播放对应行走动画
   */
  walkTo(x: number, y: number, onComplete?: () => void): void {
    if (this.isWalking) return;
    this.isWalking = true;

    const dx = x - this.body.x;
    const dy = y - this.body.y;

    // 根据目标位置判断行走方向
    let dir: WalkDirection;
    if (Math.abs(dx) >= Math.abs(dy)) {
      dir = dx > 0 ? 'right' : 'left';
    } else {
      dir = dy < 0 ? 'up' : 'down';
    }

    // 切换朝向 + 播放行走动画
    this.switchDirection(dir);
    const walkAnimKey = `walk-${dir}`;
    this.body.play(walkAnimKey);

    // 计算行走时间（像素速度约50px/s）
    const distance = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.max(distance / 2, 300); // 至少走300ms

    this.scene.tweens.add({
      targets: [this.body],
      x,
      y,
      duration,
      ease: 'Linear',
      onComplete: () => {
        this.isWalking = false;
        // 行走结束，切回待机动画
        const idleAnimKey = `idle-${dir}`;
        this.body.play(idleAnimKey);
        onComplete?.();
      },
    });

    // === 表情气泡跟随身体移动（用 update 循环代替 startFollow）===
    this.followBubble(this.expressionBubble, this.body);
  }

  /**
   * 让表情气泡跟随崽崽身体 — Phaser Container 没有 startFollow，手动实现
   */
  private followBubble(bubble: Phaser.GameObjects.Container, target: Phaser.GameObjects.Sprite): void {
    const offsetX = -50;
    const offsetY = -30;

    // 每帧更新气泡位置跟随身体
    const updateFn = () => {
      bubble.x = target.x + offsetX;
      bubble.y = target.y + offsetY;
    };

    this.scene.events.on('update', updateFn);

    // 3秒后停止跟随（崽崽基本走完了）
    setTimeout(() => {
      this.scene.events.off('update', updateFn);
    }, 5000);
  }

  /**
   * 崽崽挥手打招呼动画
   */
  waveHand(): void {
    this.scene.tweens.add({
      targets: this.body,
      angle: { from: 0, to: 15 },
      duration: 200,
      ease: 'Sine.easeOut',
      yoyo: true,
      repeat: 3,
    });
  }

  /**
   * 崽崽开心转圈动画 (加咖啡后)
   */
  spinHappy(): void {
    this.scene.tweens.add({
      targets: this.body,
      angle: { from: 0, to: 360 },
      duration: 800,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.body.setAngle(0);
      },
    });
  }

  /**
   * 点头动画（认同/确认）
   */
  nodHead(): void {
    this.scene.tweens.add({
      targets: this.body,
      y: { from: this.body.y, to: this.body.y + 6 },
      duration: 120,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: 1,
    });
  }

  /**
   * 摇头动画（否定/纠结）
   */
  shakeHead(): void {
    this.scene.tweens.add({
      targets: this.body,
      x: { from: this.body.x - 4, to: this.body.x + 4 },
      duration: 90,
      ease: 'Sine.easeInOut',
      yoyo: true,
      repeat: 3,
      onComplete: () => this.body.setX(this.body.x),
    });
  }

  /**
   * 获取崽崽当前位置
   */
  getPosition(): { x: number; y: number } {
    return { x: this.body.x, y: this.body.y };
  }

  /**
   * 外部场景按Y排序时设置身体层级
   */
  setBodyDepth(depth: number): void {
    this.body.setDepth(depth);
  }

  /**
   * 获取当前表情
   */
  getCurrentExpression(): ExpressionType {
    return this.currentExpression;
  }
}
