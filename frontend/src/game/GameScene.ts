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
  // 调试开关：关闭自动巡逻，但保留模型事件触发的互动走位
  private static readonly ENABLE_AUTO_PATROL = false;
  private static readonly ENABLE_ACTION_MOVEMENT = true;
  private caicai!: Caicai;

  // === 巡逻相关 ===
  private isPatrolling: boolean = false;
  private lastChatInteractAt = 0;
  private computerSprite: Phaser.GameObjects.Image | null = null;
  private deskPos: { x: number; y: number } = { x: 0, y: 0 };
  private ySortedObjects: Phaser.GameObjects.Image[] = [];
  private anchoredLayerObjects: Array<{
    child: Phaser.GameObjects.Image;
    parent: Phaser.GameObjects.Image;
    offset: number;
  }> = [];

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
    this.load.image('glasscoffeetable', '/assets/tiles/glasscoffeetablenew.png'); // 78x48 新版茶几
    this.load.image('office_chair', '/assets/tiles/office_chair.png'); // 30x36

    // === 书架 & 书籍 ===
    this.load.image('bookshelf', '/assets/tiles/Bookshelf.png');     // 96x63
    this.load.image('book', '/assets/tiles/book.png');               // 17x17 单本书
    this.load.image('books_1', '/assets/tiles/books_1.png');         // 28x26 书堆
    this.load.image('books_2', '/assets/tiles/books_2.png');          // 20x14 书堆
    this.load.image('books_3', '/assets/tiles/books_3.png');         // 17x26 书堆

    // === 电器 & 装饰 ===
    this.load.image('computer_idle', '/assets/tiles/computer_idle.png');     // 29x29
    this.load.image('computer_work', '/assets/tiles/computer_work.png');     // 29x29
    this.load.image('computer_1', '/assets/tiles/computer_1.png');           // 12x28 老式显示器
    this.load.image('coffeemachine_idle', '/assets/tiles/coffeemachine_idle.png');   // 29x32
    this.load.image('coffeemachine_work', '/assets/tiles/coffeemachine_work.png');   // 29x32
    this.load.image('coffeemachinebase', '/assets/tiles/coffeemachinebase.png');   // 32x54 咖啡机底座
    this.load.image('whiteboard', '/assets/tiles/whiteboard.png');            // 88x64
    this.load.image('whiteboard_2', '/assets/tiles/whiteboard_2.png');        // 58x36 小白板

    // === 墙面装饰 ===
    this.load.image('clock', '/assets/tiles/clock.png');               // 20x18
    this.load.image('wallpainting', '/assets/tiles/WallPainting.png'); // 24x28 装饰画
    this.load.image('sticker', '/assets/tiles/Sticker.png');           // 17x22 贴纸
    this.load.image('opticaldisc', '/assets/tiles/OpticalDisc.png');   // 22x22 光盘

    // === 打印机 & 光盘 ===
    this.load.image('printer', '/assets/tiles/printer.png');           // 32x29
    this.load.image('phone', '/assets/tiles/telphone.png');            // 电话素材（用户新增）

    // === 分区隔板 ===
    this.load.image('partition_1', '/assets/tiles/Partition_1.png');   // 64x42
    this.load.image('partition_2', '/assets/tiles/Partition_2.png');   // 59x42
    this.load.image('partition_3', '/assets/tiles/Partition_3.png');   // 5x32
    this.load.image('partition_4', '/assets/tiles/Partition_4.png');   // 5x38

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
          if (GameScene.ENABLE_AUTO_PATROL) {
            setTimeout(() => {
              console.log('[巡逻] 开始自动巡逻');
              this.startPatrol(width, height);
            }, 2000);
          }
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
   * 崽崽的温馨小屋 — 丰富版布局
   *
   * 布局设计：
   * ┌────────────────────────────────────────────────────────────────────┐
   * │ [clock] [whiteboard_2] [sticker]   [opticaldisc]   [wallpainting] │  <- 墙面装饰
   * ├──────────────┬─────────────────────────┼────────────────────────────┤
   * │              │                         │                            │
   * │  bookshelf   │  desk_A (主工作台)     │   partition_1/2 (隔断)    │
   * │  (左侧书墙) │  computer + books       │                            │
   * │  + books    │                         │   休闲区:                 │
   * │              ├─────────────────────────│   sofa + 茶几             │
   * │  desk_B     │  desk_B (打印/资料台)   │   coffeemachine (靠墙)    │
   * │  printer    │  books + 光盘            │   plants                  │
   * │  books      │  chair                  │                            │
   * └──────────────┴─────────────────────────┴────────────────────────────┘
   */
  private buildCozyScene(width: number, height: number): void {
    const floorY = height * 0.5;  // 地板起始Y

    // === 辅助函数 ===
    const addYSortedImage = (x: number, y: number, key: string): Phaser.GameObjects.Image => {
      const img = this.add.image(x, y, key);
      const bottomY = y + img.displayHeight * (1 - img.originY);
      img.setDepth(bottomY);
      this.ySortedObjects.push(img);
      return img;
    };
    const addAnchoredImage = (
      x: number, y: number, key: string,
      parent: Phaser.GameObjects.Image, offset = 1
    ): Phaser.GameObjects.Image => {
      const img = this.add.image(x, y, key);
      img.setDepth(parent.depth + offset);
      this.anchoredLayerObjects.push({ child: img, parent, offset });
      return img;
    };

    // ─────────────────────────────────────────────────
    // 1. 背景 & 地板
    // ─────────────────────────────────────────────────
    this.add.rectangle(0, 0, width, height, 0x1a1a2e).setOrigin(0).setDepth(-1000);

    // 地板铺砖
    for (let x = 0; x < width; x += 32) {
      for (let y = floorY; y < height; y += 32) {
        this.add.image(x + 16, y + 16, 'floor');
      }
    }

    // 墙壁（只铺到 floorY 上方一点，留出墙面装饰空间）
    for (let x = 0; x < width; x += 96) {
      this.add.image(x + 48, height * 0.22, 'wall').setDepth(-100);
    }
    const remainingWall = width % 96;
    if (remainingWall > 32) {
      this.add.image(width - 16, height * 0.22, 'wall_short').setDepth(-100);
    }

    // ─────────────────────────────────────────────────
    // 2. 墙面装饰（挂在墙上）
    // ─────────────────────────────────────────────────
    const wallY = height * 0.28;

    // 时钟 — 墙上正中间，略高一些（20x18像素区域）
    // 用 Graphics 绘制实时时钟，放在 Container 里以便交互缩放
    const clockX = width * 0.5;
    const clockY = height * 0.18;
    const clockRadius = 9;
    this.initInteractiveClock(clockX, clockY, clockRadius);

    // 小白板（记忆物品）— 左中墙上，点击后查看 Hermes 永久记忆
    const memoryBoard = this.add.image(width * 0.18, wallY + 5, 'whiteboard_2').setDepth(-80);
    memoryBoard.setInteractive({ cursor: 'pointer' });
    memoryBoard.on('pointerdown', () => {
      window.dispatchEvent(new CustomEvent('memory-board-click'));
    });

    // 贴纸 — 左中墙偏右
    this.add.image(width * 0.28, wallY + 10, 'sticker').setDepth(-80);

    // 装饰画 — 右侧墙
    this.add.image(width * 0.88, wallY, 'wallpainting').setDepth(-80);

    // ─────────────────────────────────────────────────
    // 3. 左侧 — 书架（书墙）+ desk_B（打印机/资料台）
    // ─────────────────────────────────────────────────

    // 书架（左侧，占据从地板到墙面的高度）
    const bookshelfX = width * 0.08;
    const bookshelfY = floorY + 8;
    const bookshelf = addYSortedImage(bookshelfX, bookshelfY, 'bookshelf');
    bookshelf.setInteractive({ cursor: 'pointer' });
    bookshelf.on('pointerdown', () => {
      window.dispatchEvent(new CustomEvent('bookshelf-click'));
    });

    // 书架格子里的书籍装饰（书放书架内部，向下移）
    this.add.image(bookshelfX - 18, bookshelfY - 15, 'books_1').setDepth(bookshelf.depth - 1);
    this.add.image(bookshelfX + 22, bookshelfY - 15, 'books_3').setDepth(bookshelf.depth - 1);
    this.add.image(bookshelfX - 2, bookshelfY - 18, 'book').setDepth(bookshelf.depth - 1);

    // desk_B — 打印机/资料桌（在书架右侧，底线与书架对齐）
    const deskBX = width * 0.22;
    const deskBY = floorY + 8;
    const deskB = addYSortedImage(deskBX, deskBY, 'desk');

    // 打印机（桌上）
    const printer = addAnchoredImage(deskBX - 20, deskBY - 18, 'printer', deskB, 2);
    printer.setInteractive({ cursor: 'pointer' });
    printer.on('pointerdown', () => {
      window.dispatchEvent(new CustomEvent('printer-click'));
    });


    // 桌上书籍堆
    addAnchoredImage(deskBX + 15, deskBY - 12, 'books_1', deskB, 2);

    // 光盘（桌上）
    addAnchoredImage(deskBX + 38, deskBY - 12, 'opticaldisc', deskB, 2);

    // ─────────────────────────────────────────────────
    // 4. 中间 — desk_A（主工作台）+ 书架
    // ─────────────────────────────────────────────────

    const deskAX = width * 0.44;
    const deskAY = floorY + 6;
    const deskA = addYSortedImage(deskAX, deskAY, 'desk');
    this.deskPos = { x: deskAX, y: deskAY };

    // 主显示器
    this.computerSprite = addAnchoredImage(deskAX - 10, deskAY - 24, 'computer_idle', deskA, 2);

    // 老式显示器（叠在主显示器旁边）
    addAnchoredImage(deskAX + 12, deskAY - 22, 'computer_1', deskA, 2);

    // 电话（主办公桌上，可交互：展示 Hermes channel 配置）
    const phone = addAnchoredImage(deskAX + 36, deskAY - 18, 'phone', deskA, 3);
    phone.setInteractive({ cursor: 'pointer' });
    phone.on('pointerdown', () => {
      window.dispatchEvent(new CustomEvent('phone-click'));
    });

    // 办公椅（主工作台前）
    addYSortedImage(deskAX - 5, floorY + 30, 'office_chair');

    // ─────────────────────────────────────────────────
    // 6. 右侧休闲区 — 沙发 + 茶几 + 咖啡机 + 绿植
    // ─────────────────────────────────────────────────

    const sofaX = width * 0.76;
    const sofaY = floorY + 4;

    // 沙发
    addYSortedImage(sofaX, sofaY, 'sofa');

    // 玻璃茶几（沙发前）
    const coffeeTableX = sofaX - 20;
    const coffeeTableY = floorY + 20;
    const coffeeTable = addYSortedImage(coffeeTableX, coffeeTableY, 'glasscoffeetable');

    // 咖啡杯（茶几上，可交互）
    addAnchoredImage(coffeeTableX - 12, coffeeTableY - 10, 'coffeecup_empty', coffeeTable, 3);

    // 咖啡机 — 靠右侧墙画下方，水平镜像（朝向室内）
    const coffeeMachineX = width * 0.88;
    const coffeeMachineY = floorY + 8;
    const cmBaseImg = addYSortedImage(coffeeMachineX, coffeeMachineY, 'coffeemachinebase');
    cmBaseImg.setFlipX(true);
    const cmBase = this.ySortedObjects.find(o => o.texture.key === 'coffeemachinebase')!;
    const cmIdleImg = addAnchoredImage(coffeeMachineX, coffeeMachineY - 28, 'coffeemachine_idle', cmBase, 2);
    cmIdleImg.setFlipX(true);

    // 右侧大绿植（沙发旁角落）
    addYSortedImage(width * 0.98, floorY + 16, 'houseplants_2');

    // 沙发旁边的小绿植（休闲区，门口右侧）
    addYSortedImage(width * 0.64, floorY + 10, 'houseplants_1');

    // 氛围灯光
    const ambientLight = this.add.circle(width * 0.5, height * 0.45, width * 0.55, 0xffe4b5, 0.06);
    ambientLight.setDepth(-500);
  }

  /**
   * 创建咖啡杯交互区域
   */
  private createCoffeeCup(width: number, height: number): void {
    const floorY = height * 0.5;
    // 咖啡杯在玻璃茶几上
    const coffeeX = width * 0.76 - 20 - 12;  // sofaX - 20(table offset) - 12(cup offset)
    const coffeeY = floorY + 20 - 10;         // coffeeTableY - 10

    // 点击区域
    const coffeeZone = this.add.zone(coffeeX, coffeeY, 30, 30).setInteractive();

    coffeeZone.on('pointerdown', () => {
      console.log('[GameScene] 给崽崽加了杯咖啡！');
      // 点击咖啡时，先走到茶几旁再喝咖啡
      const standX = coffeeX + 55;
      const standY = coffeeY + 20;
      if (GameScene.ENABLE_ACTION_MOVEMENT) {
        this.caicai.walkTo(standX, standY, () => {
          window.dispatchEvent(new CustomEvent('add-coffee'));
          this.caicai.showExpression('eating', 1800);
          this.caicai.spinHappy();
        });
      } else {
        window.dispatchEvent(new CustomEvent('add-coffee'));
        this.caicai.showExpression('eating', 1800);
        this.caicai.spinHappy();
      }
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
    const setComputerWorking = (isWorking: boolean) => {
      if (!this.computerSprite) return;
      this.computerSprite.setTexture(isWorking ? 'computer_work' : 'computer_idle');
    };

    const mapExpression = (expr: string): ExpressionType => {
      const mapped: Record<string, ExpressionType> = {
        happy: 'happy',
        thinking: 'thinking',
        surprised: 'surprised',
        sweat: 'sweating',
        sweating: 'sweating',
        confused: 'surprised',
        cry: 'crying',
        crying: 'crying',
        eating: 'eating',
      };
      return mapped[expr] ?? 'happy';
    };

    const handleAction = (action: string) => {
      const { width, height } = this.scale;
      switch (action) {
        case 'wave':
        case 'wave_hand':
          this.caicai.waveHand();
          break;
        case 'spin':
          this.caicai.spinHappy();
          break;
        case 'nod_head':
          this.caicai.nodHead();
          break;
        case 'shake_head':
          this.caicai.shakeHead();
          break;
        case 'walk_to_desk':
        case 'search_documents':
          if (GameScene.ENABLE_ACTION_MOVEMENT) {
            this.caicai.walkTo(width * 0.2, height * 0.78);
          }
          this.caicai.showExpression('thinking', 2200);
          break;
        case 'type_on_keyboard':
          setComputerWorking(true);
          if (GameScene.ENABLE_ACTION_MOVEMENT) {
            this.caicai.walkTo(this.deskPos.x + 8, this.deskPos.y, () => this.caicai.showExpression('thinking', 1800));
          } else {
            this.caicai.showExpression('thinking', 1800);
          }
          this.time.delayedCall(4500, () => setComputerWorking(false));
          break;
        case 'drink_coffee':
          if (GameScene.ENABLE_ACTION_MOVEMENT) {
            this.caicai.walkTo(width * 0.72 + 55, height * 0.5 + 18, () => {
              this.caicai.showExpression('eating', 1800);
              this.caicai.spinHappy();
            });
          } else {
            this.caicai.showExpression('eating', 1800);
            this.caicai.spinHappy();
          }
          break;
        default:
          break;
      }
    };

    // 监听来自后端的表情指令
    window.addEventListener('gateway-expression', (e: Event) => {
      const detail = (e as CustomEvent).detail as { type: ExpressionType };
      if (detail?.type) {
        this.caicai.showExpression(mapExpression(detail.type));
      }
    });

    // 监听来自后端的动作指令
    window.addEventListener('gateway-action', (e: Event) => {
      const detail = (e as CustomEvent).detail as { action: string };
      if (detail?.action) handleAction(detail.action);
    });

    // 监听 ws.ts 分发的动作事件
    window.addEventListener('caicai-action', (e: Event) => {
      const detail = (e as CustomEvent).detail as { type: string; value: string };
      if (detail?.type === 'action' && detail.value) {
        handleAction(detail.value);
      }
    });

    // 监听语义标签 — 自动映射表情
    window.addEventListener('gateway-semantic', (e: Event) => {
      const detail = (e as CustomEvent).detail as { tag: string };
      if (detail?.tag) {
        this.caicai.setExpressionFromSemantic(detail.tag);
      }
    });

    // 聊天结果兜底：当没有结构化事件时，按回复文本关键词触发互动
    window.addEventListener('caicai-chat-reply', (e: Event) => {
      const detail = (e as CustomEvent).detail as { reply?: string; events?: Array<{ type: string; value: string }> };
      const now = Date.now();
      if (now - this.lastChatInteractAt < 400) return;
      this.lastChatInteractAt = now;

      if (detail?.events && detail.events.length > 0) return;
      const text = (detail?.reply || '').toLowerCase();
      if (!text) return;

      if (text.includes('咖啡')) {
        handleAction('drink_coffee');
        return;
      }
      if (text.includes('文档') || text.includes('需求') || text.includes('分析')) {
        handleAction('search_documents');
        return;
      }
      if (text.includes('谢谢') || text.includes('欢迎')) {
        this.caicai.showExpression('happy', 2000);
        this.caicai.waveHand();
        return;
      }
      this.caicai.showExpression('thinking', 1800);
    });
  }

  update(): void {
    // 按Y排序：越靠近底部，层级越高
    for (const obj of this.ySortedObjects) {
      if (!obj.active) continue;
      const bottomY = obj.y + obj.displayHeight * (1 - obj.originY);
      obj.setDepth(bottomY);
    }
    // 桌面/茶几上的物件：始终相对承载物提高一层
    for (const item of this.anchoredLayerObjects) {
      if (!item.child.active || !item.parent.active) continue;
      item.child.setDepth(item.parent.depth + item.offset);
    }
    const pos = this.caicai.getPosition();
    this.caicai.setBodyDepth(pos.y);
  }

  /**
   * 可交互的实时时钟 — 用 Graphics 绘制，hover 放大显示时间和日期
   */
  private initInteractiveClock(x: number, y: number, r: number): void {
    // 创建 Container 包裹 Graphics（用于统一缩放）
    const container = this.add.container(x, y, []);
    container.setDepth(9999);
    // 记录原始位置，供缩放中心使用
    const originX = x;
    const originY = y;

    // Graphics — 绘制时钟
    const g = this.add.graphics();
    container.add([g]);

    // ── 时钟绘制逻辑 ──────────────────────────────
    const drawClock = () => {
      g.clear();
      const now = new Date();
      const h = now.getHours() % 12;
      const m = now.getMinutes();
      const s = now.getSeconds();

      // 外框
      g.fillStyle(0x13132a, 0.85);
      g.fillCircle(0, 0, r);
      g.lineStyle(1, 0xa78bfa, 0.8);
      g.strokeCircle(0, 0, r);

      // 中心
      g.fillStyle(0xa78bfa, 1);
      g.fillCircle(0, 0, 1.2);

      // 时刻度
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
        const ir = r - 2.5;
        const or = r - 1;
        g.lineStyle(0.8, 0xc4b5fd, 0.9);
        g.beginPath();
        g.moveTo(Math.cos(angle) * ir, Math.sin(angle) * ir);
        g.lineTo(Math.cos(angle) * or, Math.sin(angle) * or);
        g.strokePath();
      }

      // 时针
      const hourAngle = ((h + m / 60) / 12) * Math.PI * 2 - Math.PI / 2;
      g.lineStyle(1, 0xd8b4fe, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(hourAngle) * r * 0.45, Math.sin(hourAngle) * r * 0.45);
      g.strokePath();

      // 分针
      const minAngle = (m / 60) * Math.PI * 2 - Math.PI / 2;
      g.lineStyle(0.8, 0xa78bfa, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(minAngle) * r * 0.65, Math.sin(minAngle) * r * 0.65);
      g.strokePath();

      // 秒针
      const secAngle = (s / 60) * Math.PI * 2 - Math.PI / 2;
      g.lineStyle(0.6, 0xf87171, 1);
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(Math.cos(secAngle) * r * 0.72, Math.sin(secAngle) * r * 0.72);
      g.strokePath();
      g.beginPath();
      g.moveTo(0, 0);
      g.lineTo(-Math.cos(secAngle) * r * 0.18, -Math.sin(secAngle) * r * 0.18);
      g.strokePath();
    };

    drawClock();
    // 每秒重绘
    this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: drawClock,
    });

    // ── 鼠标 hover 放大逻辑 ───────────────────────
    // 创建 DOM 浮层容器（隐藏）
    const el = document.createElement('div');
    el.style.cssText = `
      position: fixed;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.2s ease;
      background: rgba(19, 19, 42, 0.92);
      border: 1.5px solid rgba(167, 139, 250, 0.6);
      border-radius: 12px;
      padding: 14px 18px;
      color: #e2e8f0;
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
      text-align: center;
      box-shadow: 0 4px 24px rgba(139, 92, 246, 0.3), 0 0 0 1px rgba(139,92,246,0.1);
      z-index: 99999;
      white-space: nowrap;
    `;
    el.innerHTML = `
      <div id="clock-pop-time" style="font-size: 28px; font-weight: 700; color: #c4b5fd; line-height: 1.2; animation: clockPopPulse 1s infinite steps(1);">--:--:--</div>
      <div id="clock-pop-date" style="font-size: 12px; color: #94a3b8; margin-top: 4px;">----/--/-- --</div>
    `;
    if (!document.getElementById('clock-pop-style')) {
      const style = document.createElement('style');
      style.id = 'clock-pop-style';
      style.textContent = `
        @keyframes clockPopPulse {
          0%   { transform: scale(1);    color: #c4b5fd; }
          10%  { transform: scale(1.06); color: #e9d5ff; }
          20%  { transform: scale(1);   color: #c4b5fd; }
          100% { transform: scale(1);    color: #c4b5fd; }
        }
      `;
      document.head.appendChild(style);
    }
    document.body.appendChild(el);

    const updatePopContent = () => {
      const now = new Date();
      const timeStr = now.toLocaleTimeString('zh-CN', { hour12: false });
      const dateStr = now.toLocaleDateString('zh-CN', {
        year: 'numeric', month: '2-digit', day: '2-digit',
        weekday: 'short',
      });
      el.querySelector('#clock-pop-time')!.textContent = timeStr;
      el.querySelector('#clock-pop-date')!.textContent = dateStr;
    };
    updatePopContent();
    const popTick = this.time.addEvent({
      delay: 1000,
      loop: true,
      callback: () => {
        if (el.style.opacity !== '0') {
          updatePopContent();
        }
      },
    });

    let scaleTween: Phaser.Tweens.Tween | null = null;

    const showPopover = () => {
      if (scaleTween) scaleTween.stop();
      const canvas = this.sys.game.canvas;
      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / Number(canvas.dataset.width  || rect.width);
      const scaleY = rect.height / Number(canvas.dataset.height || rect.height);
      const screenX = rect.left + originX * scaleX;
      const screenY = rect.top  + originY * scaleY;

      updatePopContent();
      el.style.left = `${screenX}px`;
      el.style.top  = `${screenY + 36}px`;
      el.style.opacity = '1';
      // Phaser 容器放大动画
      scaleTween = this.tweens.add({
        targets: container,
        scaleX: 3.5,
        scaleY: 3.5,
        duration: 200,
        ease: 'Back.easeOut',
      });
    };

    const hidePopover = () => {
      el.style.opacity = '0';
      if (scaleTween) scaleTween.stop();
      scaleTween = this.tweens.add({
        targets: container,
        scaleX: 1,
        scaleY: 1,
        duration: 200,
        ease: 'Quad.easeOut',
      });
    };

    // 让 container 可交互（透明的 hit area 放大一些方便点击）
    const hitArea = this.add.circle(originX, originY, r * 1.5, 0xffffff, 0);
    hitArea.setDepth(-79);
    hitArea.setInteractive({ cursor: 'pointer' });
    hitArea.on('pointerover',  showPopover);
    hitArea.on('pointerout',   hidePopover);

    // 场景销毁时清理 DOM 和 timer，避免残留
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      popTick.remove(false);
      el.remove();
    });
  }
}
