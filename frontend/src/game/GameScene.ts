import * as Phaser from 'phaser';
import { Caicai } from './entities/Caicai';
import type { ExpressionType } from './entities/Caicai';

/**
 * 崽崽的数字小屋 — 主场景
 *
 * 使用 tiles/ 目录中的真实素材构建温馨办公角：
 * - 左侧工作区: desk + computer + office_chair
 * - 右侧休闲区: sofa + glasscoffeetable + houseplants
 * - 墙面装饰: wall + whiteboard + coffeemachine
 * - 地面铺砖: floot (32x32)
 */
export class GameScene extends Phaser.Scene {
  private caicai!: Caicai;
  private coffeeCup!: Phaser.GameObjects.Container;
  private coffeeSteam: Phaser.Particles.Arcade.Emitter | null = null;

  // === 巡逻相关 ===
  private isPatrolling: boolean = false;
  private patrolQueue: Array<{ x: number; y: number }> = [];
  private patrolProcessing: boolean = false;

  constructor() {
    super({ key: 'GameScene' });
  }

  preload(): void {
    // === 崽崽身体精灵图 (三帧四方向动画) ===
    this.load.spritesheet('caicai_body', '/assets/sprites/caicai_body.png', {
      frameWidth: 32,
      frameHeight: 48,
    });

    // === 表情图标集（精灵图 5列x8行=40格, 每格80x100）===
    this.load.spritesheet('expression1', '/assets/sprites/expression1.png', {
      frameWidth: 80,
      frameHeight: 100,
    });
    this.load.spritesheet('expression2', '/assets/sprites/expression2.png', {
      frameWidth: 80,
      frameHeight: 100,
    });

    // === 地面瓦片 ===
    this.load.image('floor', '/assets/tiles/floot.png');           // 32x32

    // === 墙壁 ===
    this.load.image('wall', '/assets/tiles/wall.png');              // 96x64
    this.load.image('wall_short', '/assets/tiles/wall_short.png');   // 32x64

    // === 家具 ===
    this.load.image('desk', '/assets/tiles/desk.png');               // 91x46
    this.load.image('sofa', '/assets/tiles/sofa.png');               // 96x52
    this.load.image('table', '/assets/tiles/table.png');             // 96x44
    this.load.image('glasscoffeetable', '/assets/tiles/glasscoffeetable.png'); // 52x32
    this.load.image('office_chair', '/assets/tiles/office_chair.png'); // 30x36

    // === 电器 & 装饰 ===
    this.load.image('computer_idle', '/assets/tiles/computer_idle.png');     // 29x29
    this.load.image('computer_work', '/assets/tiles/computer_work.png');     // 29x29
    this.load.image('coffeemachine_idle', '/assets/tiles/coffeemachine_idle.png');   // 29x32
    this.load.image('coffeemachine_work', '/assets/tiles/coffeemachine_work.png');   // 29x32
    this.load.image('whiteboard', '/assets/tiles/whiteboard.png');            // 88x64

    // === 绿植 ===
    this.load.image('houseplants_1', '/assets/tiles/houseplants_1.png');   // 26x60
    this.load.image('houseplants_2', '/assets/tiles/houseplants_2.png');   // 32x70

    // === 咖啡杯 ===
    this.load.image('coffeecup_empty', '/assets/tiles/coffeecup_empty.png');  // 12x12
    this.load.image('coffeecup_full', '/assets/tiles/coffeecup_full.png');    // 12x12
  }

  create(): void {
    const { width, height } = this.scale;

    // === 1. 构建温馨小屋场景 ===
    this.buildCozyScene(width, height);

    // === 2. 创建崽崽角色 — 站在休闲区沙发旁 ===
    this.caicai = new Caicai(this, width * 0.65, height * 0.78);

    // === 3. 咖啡杯交互区（在玻璃茶几上）===
    this.createCoffeeCup(width, height);

    // === 4. 崽崽迎宾动画 — 从沙发旁跑过来打招呼 ===
    setTimeout(() => {
      console.log('[巡逻] 开始迎宾动画');
      this.caicai.walkTo(width * 0.55, height * 0.72,
        () => {
          console.log('[巡逻] 迎宾到达，挥手+表情');
          this.caicai.waveHand();
          this.caicai.showExpression('happy', 3000);

          // 欢迎消息
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('caicai-welcome', {
              detail: { message: '欢迎来到崽崽的数字小屋！💖\n左边是工作区，右边是休闲角～想喝杯咖啡吗？' },
            }));
          }, 500);

          // === 迎宾结束后等2秒再开始巡逻（确保挥手动画完成）===
          setTimeout(() => {
            console.log('[巡逻] 开始自动巡逻');
            this.startPatrol(width, height);
          }, 2000);
        }
      );
    }, 800);

    // === 5. 监听Gateway事件 — 表情联动 ===
    this.setupGatewayEventListeners();

    // === 6. 监听Zustand状态变化 — React ↔ Phaser双向联动 ===
    window.addEventListener('caicai-expression-change', (e: Event) => {
      const detail = (e as CustomEvent).detail as { type: string };
      if (detail?.type) {
        console.log(`[GameScene] 收到表情指令: ${detail.type}`);
        this.caicai.showExpression(detail.type as any, 3000);
      }
    });
  }

  /**
   * 崽崽自动巡逻 — 在小屋里随机走动，偶尔停下来发呆/思考
   */
  private startPatrol(width: number, height: number): void {
    if (this.isPatrolling) return;
    this.isPatrolling = true;

    // 定义几个崽崽喜欢待的"兴趣点"
    const waypoints = [
      { x: width * 0.2, y: height * 0.78 },     // 工作区
      { x: width * 0.55, y: height * 0.72 },   // 中央空地
      { x: width * 0.75, y: height * 0.82 },    // 休闲区
      { x: width * 0.4,  y: height * 0.65 },     // 看白板
      { x: width * 0.9,  y: height * 0.7 },      // 绿植角
    ];

    const randomExpression = (): ExpressionType => {
      const expressions: ExpressionType[] = ['happy', 'thinking', 'surprised'];
      return expressions[Math.floor(Math.random() * expressions.length)];
    };

    /**
     * 巡逻步进 — 走到一个兴趣点，显示表情，然后继续
     */
    const patrolStep = () => {
      if (!this.isPatrolling) return;

      // 选一个远离当前位置的兴趣点
      const pos = this.caicai.getPosition();
      let target = waypoints[Math.floor(Math.random() * waypoints.length)];
      let attempts = 0;
      while (Math.abs(pos.x - target.x) < 40 && Math.abs(pos.y - target.y) < 40 && attempts < 10) {
        target = waypoints[Math.floor(Math.random() * waypoints.length)];
        attempts++;
      }

      console.log(`[巡逻] 崽崽走向 (${Math.round(target.x)}, ${Math.round(target.y)})，当前位置 (${Math.round(pos.x)}, ${Math.round(pos.y)})`);

      // 使用 tween 直接移动（绕过 walkTo 的 isWalking 守卫问题）
      this.moveCaicaiTo(target.x, target.y, () => {
        console.log(`[巡逻] 崽崽到达 (${Math.round(target.x)}, ${Math.round(target.y)})`);

        // 到达后随机显示表情，停留一会儿再走
        const expr = randomExpression();
        this.caicai.showExpression(expr, 2000 + Math.random() * 1500);

        // 停留 2-4 秒后继续巡逻
        const delay = 2000 + Math.random() * 2000;
        console.log(`[巡逻] 停留 ${Math.round(delay)}ms 后继续`);
        setTimeout(() => {
          patrolStep();
        }, delay);
      });
    };

    // 第一次巡逻
    patrolStep();
  }

  /**
   * 直接移动崽崽（不依赖 Caicai.walkTo 的 isWalking 守卫）
   */
  private moveCaicaiTo(x: number, y: number, onComplete?: () => void): void {
    const body = (this.caicai as any).body;

    // 判断方向
    const dx = x - body.x;
    const dy = y - body.y;
    let dir: string;
    if (Math.abs(dx) >= Math.abs(dy)) {
      dir = dx > 0 ? 'right' : 'left';
    } else {
      dir = dy < 0 ? 'up' : 'down';
    }

    // 播放行走动画
    body.play(`walk-${dir}`);

    // 计算距离和时间
    const distance = Math.sqrt(dx * dx + dy * dy);
    const duration = Math.max(distance / 1.5, 400); // 速度约1.5px/ms ≈ 90px/s，至少走400ms

    console.log(`[巡逻] 移动距离 ${Math.round(distance)}px，预计 ${Math.round(duration)}ms`);

    this.tweens.add({
      targets: [body],
      x,
      y,
      duration,
      ease: 'Linear',
      onComplete: () => {
        // 切回待机动画
        body.play(`idle-${dir}`);
        onComplete?.();
      },
    });
  }

  /**
   * 使用 tiles/ 素材构建崽崽的温馨小屋
   *
   * 布局设计:
   * ┌─────────────────────────────────────┐
   * │  wall      whiteboard     wall      │ <- 墙面
   * │  coffeemachine                        │
   * ├─────────────────────────────────────┤
   * │ desk+computer  sofa+table            │ <- 家具层
   * │ chair          plant                 │
   * └─────────────────────────────────────┘ <- floor铺满
   */
  private buildCozyScene(width: number, height: number): void {
    // === 深色背景底色 ===
    const bg = this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0);

    // === 地板 — 用 floot.png (32x32) 铺满下半区域 ===
    const floorY = height * 0.5;
    for (let x = 0; x < width; x += 32) {
      for (let y = floorY; y < height; y += 32) {
        this.add.image(x + 16, y + 16, 'floor');
      }
    }

    // === 墙壁 — 用 wall.png (96x64) 铺满上半区域 ===
    for (let x = 0; x < width; x += 96) {
      this.add.image(x + 48, height * 0.25, 'wall');
    }

    // 右侧补一块短墙
    const remainingWidth = width % 96;
    if (remainingWidth > 32) {
      this.add.image(width - 16, height * 0.25, 'wall_short');
    }

    // === 白板 — 挂在左侧墙上 ===
    const whiteboard = this.add.image(width * 0.2, height * 0.38, 'whiteboard');

    // === 咖啡机 — 放在茶几上（崽崽的专属咖啡供应站）===
    const coffeeMachine = this.add.image(width * 0.68, height * 0.82 - 24, 'coffeemachine_idle');

    // === 左侧工作区：书桌 + 电脑 + 椅子 ===
    const deskX = width * 0.2;
    const deskY = height * 0.72;
    this.add.image(deskX, deskY, 'desk');

    // 电脑上放 computer_idle（崽崽不工作时）
    this.add.image(deskX - 5, deskY - 18, 'computer_idle');

    // 办公椅放在书桌前（与办公桌垂直对齐）
    const chair = this.add.image(width * 0.2, height * 0.82, 'office_chair');

    // === 右侧休闲区：沙发 + 玻璃茶几 ===
    const sofaX = width * 0.68;
    const sofaY = height * 0.74;
    this.add.image(sofaX, sofaY, 'sofa');

    // 玻璃茶几放在沙发前
    this.add.image(width * 0.68, height * 0.82, 'glasscoffeetable');

    // === 绿植装饰 — 给小屋增添生机 🌿 ===
    // 角落放一盆大绿植
    this.add.image(width * 0.92, height * 0.76, 'houseplants_2');

    // 书桌旁也放一小盆
    this.add.image(width * 0.08, deskY - 5, 'houseplants_1');

    // === 咖啡杯（在玻璃茶几上，可交互）===
    const coffeeX = width * 0.68;
    const coffeeY = height * 0.82 - 14;
    this.add.image(coffeeX, coffeeY, 'coffeecup_empty');

    // === 氛围灯光效果 — 暖色调 ===
    const light = this.add.circle(width / 2, height * 0.5, width * 0.6, 0xffe4b5, 0.08);
  }

  /**
   * 创建咖啡杯交互区域
   */
  private createCoffeeCup(width: number, height: number): void {
    const coffeeX = width * 0.68;
    const coffeeY = height * 0.82 - 14;

    // 点击区域
    const coffeeZone = this.add.zone(coffeeX, coffeeY, 30, 30).setInteractive();

    coffeeZone.on('pointerdown', () => {
      console.log('[GameScene] 给崽崽加了杯咖啡！');
      window.dispatchEvent(new CustomEvent('add-coffee'));

      // 崽崽开心转圈 + 表情变化
      this.caicai.spinHappy();
      this.caicai.showExpression('happy', 3000);
    });

    coffeeZone.on('pointerover', () => {
      coffeeZone.setScale(1.2);
    });

    coffeeZone.on('pointerout', () => {
      coffeeZone.setScale(1);
    });
  }

  /**
   * 设置Gateway事件监听 — LLM回复驱动崽崽表情/动作
   */
  private setupGatewayEventListeners(): void {
    // 监听来自后端的表情指令
    window.addEventListener('gateway-expression', (e: Event) => {
      const detail = (e as CustomEvent).detail as { type: ExpressionType };
      if (detail?.type) {
        this.caicai.showExpression(detail.type);
      }
    });

    // 监听来自后端的动作指令
    window.addEventListener('gateway-action', (e: Event) => {
      const detail = (e as CustomEvent).detail as { action: string };
      switch (detail?.action) {
        case 'wave':
          this.caicai.waveHand();
          break;
        case 'spin':
          this.caicai.spinHappy();
          break;
        case 'walk_to_desk':
          const { width } = this.scale;
          this.caicai.walkTo(width * 0.2, this.scale.height * 0.78);
          break;
      }
    });

    // 监听语义标签 — 自动映射表情
    window.addEventListener('gateway-semantic', (e: Event) => {
      const detail = (e as CustomEvent).detail as { tag: string };
      if (detail?.tag) {
        this.caicai.setExpressionFromSemantic(detail.tag);
      }
    });
  }

  update(): void {
    // 每帧更新逻辑（如需要）
  }
}
