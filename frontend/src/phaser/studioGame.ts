import Phaser from 'phaser';

/** 与 `office_layer.json` 一致的设计分辨率（60×28 格 ×32px）；Phaser `Scale.FIT` 等比套入宿主。 */
export const STUDIO_GAME_BASE_WIDTH = 1920;
export const STUDIO_GAME_BASE_HEIGHT = 896;
import type { Agent, GameWorldSnapshot } from '../types/game';
import type { AgentInferenceState, BottomSheetState } from '../store/uiStore';
import {
  AGENT_H,
  AGENT_W,
  BOTTOM_CORRIDOR_H,
  C,
  DOOR,
  MID_CORRIDOR_H,
  VISUAL_CORRIDOR_W,
  V_CORR_H,
  WALL,
  computeBuildingLayout,
  computeHitRegions,
  hitTest,
  isPeerVisitorAgent,
  PEER_VISITOR_OFFICE_FEET_PX,
  PEER_VISITOR_OFFICE_FEET_PY,
} from '../ui/buildingLayout';
import { useUiStore } from '../store/uiStore';
import { computePhaserParentLayout, type FullPageLayout } from '../ui/fullPageLayout';
import { StudioShellUi } from './studioShellUi';
import type { Direction } from '../ui/spriteMap';
import { resolveSpriteBase } from '../ui/spriteMap';
import {
  PERSON_FRAME_H,
  PERSON_FRAME_W,
  PERSON_SHEET_BASES,
  getPersonSheetUrl,
  personFrameIndex,
  personTextureKey,
} from '../ui/personSprites';
import {
  collectOfficeSpawnsFromMap,
  collectOfficeTilesFromMap,
  createOfficeTileContainer,
  officeMapPixelExtent,
  type OfficeSceneSpawn,
  type OfficeTileInst,
  type ResolvedOfficeTileset,
} from './officeTiledMap';
import { publicAssetUrl } from '../utils/publicAssetUrl';
import { studioFontUi, studioInk } from '../ui/theme';
import { makeOfficeObstacleGrid } from './officeObstacleGrid';
import { findOfficePeerApproachFootSteps, findOfficeReturnFootSteps } from './officeApproachPath';
import { AStarPathfinderPlugin } from './plugins/AStarPathfinderPlugin';

/** `new Phaser.Game` 同步执行 Scene.create 时尚无法从外部写入 registry，用模块变量传入 bridge。 */
let pendingStudioCtxBridge: StudioCtxBridge | null = null;

/** Phaser Loader 404 时 preload 不会注册贴图，用 Image 再试一次。 */
function loadOfficeImageTexture(scene: Phaser.Scene, key: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        if (scene.textures.exists(key)) scene.textures.remove(key);
        scene.textures.addImage(key, img);
        resolve(true);
      } catch {
        resolve(false);
      }
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** 将 tileset 图加载为独立精灵表 key（与单张 office.png 流程一致）。 */
async function loadOfficeTilesetSpriteSheet(
  scene: Phaser.Scene,
  textureKey: string,
  imageUrl: string,
  tw: number,
  th: number,
): Promise<boolean> {
  const rawKey = `${textureKey}__raw`;
  const ok = await loadOfficeImageTexture(scene, rawKey, imageUrl);
  if (!ok) return false;
  const srcTex = scene.textures.get(rawKey);
  const imageEl = srcTex.getSourceImage() as HTMLImageElement;
  scene.textures.remove(rawKey);
  if (scene.textures.exists(textureKey)) scene.textures.remove(textureKey);
  scene.textures.addSpriteSheet(textureKey, imageEl, { frameWidth: tw, frameHeight: th });
  return true;
}

/** Tiled 常引用 .tsx，仓库里多为同名 .json。 */
function tilesetSourceToJsonCandidates(source: string): string[] {
  const s = source.replace(/^\.\//, '').trim();
  const out: string[] = [];
  if (s.toLowerCase().endsWith('.tsx')) {
    out.push(s.replace(/\.tsx$/i, '.json'));
    out.push(s);
  } else {
    out.push(s);
  }
  return [...new Set(out)];
}

/** 图集 JSON 里 `image` 与磁盘不一致时多试几个候选（如 SST- vs ST-）。 */
function imageFileCandidates(tilesetSourceFile: string, imageField: string): string[] {
  const img0 = imageField.replace(/^\.\//, '');
  const out: string[] = [img0];
  const stem = tilesetSourceFile.replace(/\.(json|tsx)$/i, '');
  const derived = `${stem}.png`;
  if (!out.includes(derived)) out.push(derived);
  if (/^SST-/i.test(img0)) {
    const alt = img0.replace(/^SST-/i, 'ST-');
    if (!out.includes(alt)) out.push(alt);
  }
  return [...new Set(out)];
}

export type AgentSpriteVisual = { dir: Direction; frame: number };

export type StudioSyncPack = {
  w: number;
  h: number;
  fullLayout: FullPageLayout;
  /** 与 `fullLayout` 一致，供壳层控制折叠 UI */
  rightPanelCollapsed: boolean;
  snapshot: GameWorldSnapshot;
  selectedAgentId: string | null;
  selectedTaskId: number | null;
  centerInference: Record<string, AgentInferenceState>;
  agentVisuals: Record<string, AgentSpriteVisual>;
  gatewayStatus: string;
  loading: boolean;
  bottomSheet: BottomSheetState;
};

export type StudioCtxBridge = {
  getPack: () => StudioSyncPack;
  handlers: {
    onSelectAgent: (id: string) => void;
    onMoveAgent: (agentId: string, roomName: string) => void;
    onOpenAgentDetail: (id: string) => void;
    onRefresh: () => void;
    onToggleMenu: (key: string) => void;
    onQuickNewTask: () => void;
    onQuickAssign: () => void;
    onQuickSkills: () => void;
  };
};

function hx(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

type AgentUi = {
  image: Phaser.GameObjects.Image;
  nameText: Phaser.GameObjects.Text;
  stateBubble: Phaser.GameObjects.Graphics;
  stateText: Phaser.GameObjects.Text;
};

class StudioScene extends Phaser.Scene {
  /**
   * 人物精灵挂在 Scene 上（不放进 centerRoot），否则整棵 centerRoot depth=1
   * 会先于壳层 batch 绘制；子节点 depth 无法压过 StudioShellUi 的 depth 50/400。
   */
  private static readonly AGENT_SCENE_DEPTH = 5000;

  private centerRoot!: Phaser.GameObjects.Container;
  private buildingG!: Phaser.GameObjects.Graphics;
  private labelTexts: Phaser.GameObjects.Text[] = [];
  private agentUi = new Map<string, AgentUi>();
  private lastLayoutKey = '';
  private officeRoot: Phaser.GameObjects.Container | null = null;
  private officePixelSize = { w: 0, h: 0 };
  /** 寻路静态障碍：非地板图层的瓦片（地板层 `floot`/`floor` 等见 `isFloorTileLayer`） */
  private officeObstacleTilesCache: OfficeTileInst[] = [];
  /** 多 tileset 时注册的 Phaser 精灵表 key，下次挂载前移除 */
  private officeTilesetTextureKeys: string[] = [];
  /** 地图 JSON 的 tilewidth，用于布局像素偏移 */
  private officeMapTileW = 32;
  private officeMapTileH = 32;
  /** office_layer.json 中 objectgroup（class 为 sp）里对象 properties 解析出的人物站位 */
  private officeMapSpawns: OfficeSceneSpawn[] = [];
  /** 人物坐标/朝向控制台输出节流（毫秒） */
  private lastAgentPlacementConsoleLog = 0;
  /** 办公室瓦片异步加载完成前不画旧矢量建筑，避免刷新时先闪一代布局再切 office */
  private officeMapStatus: 'loading' | 'ready' | 'fallback' = 'loading';
  private shellUi: StudioShellUi | null = null;
  /** 协作走近：办公室本地脚底像素，覆盖 Tiled spawn 仅用于绘制 */
  private collabWalkFootOverride = new Map<string, { ox: number; oy: number }>();
  private collabWalkBusy = new Set<string>();
  /** 协作对话时朝向对方；与 {@link collabFacingPeer} 成对清除 */
  private collabFacingOverride = new Map<string, Direction>();
  private collabFacingPeer = new Map<string, string>();

  /** 右键 / 中键 / Shift+左键拖拽平移相机 */
  private scenePanPointerId: number | null = null;
  private scenePanLastX = 0;
  private scenePanLastY = 0;

  constructor() {
    super({ key: 'StudioScene' });
  }

  preload(): void {
    for (const base of PERSON_SHEET_BASES) {
      const key = personTextureKey(base);
      this.load.spritesheet(key, getPersonSheetUrl(base), {
        frameWidth: PERSON_FRAME_W,
        frameHeight: PERSON_FRAME_H,
      });
    }
  }

  create(): void {
    if (pendingStudioCtxBridge) {
      this.game.registry.set('studioCtx', pendingStudioCtxBridge);
      pendingStudioCtxBridge = null;
    }
    this.cameras.main.setBackgroundColor(hx(C.bg));
    this.cameras.main.setRoundPixels(true);
    const L0 = computePhaserParentLayout(this.scale.width, this.scale.height);
    this.centerRoot = this.add.container(L0.center.x, L0.center.y);
    this.centerRoot.setDepth(1);

    this.buildingG = this.add.graphics();
    this.centerRoot.add(this.buildingG);
    this.buildingG.setDepth(0);

    const canvasEl = this.game.canvas;
    if (canvasEl) {
      canvasEl.addEventListener('contextmenu', (ev) => ev.preventDefault());
    }

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.scenePanPointerId !== pointer.id || !pointer.isDown) return;
      const ev = pointer.event as PointerEvent | undefined;
      let mdx = ev?.movementX;
      let mdy = ev?.movementY;
      if (mdx === undefined) mdx = pointer.x - this.scenePanLastX;
      if (mdy === undefined) mdy = pointer.y - this.scenePanLastY;
      this.scenePanLastX = pointer.x;
      this.scenePanLastY = pointer.y;
      if (mdx === 0 && mdy === 0) return;
      const cam = this.cameras.main;
      const b = this.game.scale.canvasBounds;
      const bw = Math.max(1, b.width);
      const bh = Math.max(1, b.height);
      cam.scrollX -= (mdx * cam.width) / bw;
      cam.scrollY -= (mdy * cam.height) / bh;
    });

    const endScenePan = (pointer: Phaser.Input.Pointer) => {
      if (this.scenePanPointerId === pointer.id) {
        this.scenePanPointerId = null;
        this.input.setDefaultCursor('default');
        if (canvasEl) canvasEl.style.cursor = 'pointer';
      }
    };
    this.input.on('pointerup', endScenePan);
    this.input.on('pointerupoutside', endScenePan);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const bridge = this.game.registry.get('studioCtx') as StudioCtxBridge | undefined;
      if (!bridge) return;
      const gx = pointer.x;
      const gy = pointer.y;
      if (this.shellUi?.pointerDown(gx, gy)) return;

      const panByButtons =
        pointer.rightButtonDown() ||
        pointer.middleButtonDown() ||
        (pointer.leftButtonDown() &&
          Boolean((pointer.event as MouseEvent | undefined)?.shiftKey));
      if (panByButtons) {
        this.scenePanPointerId = pointer.id;
        this.scenePanLastX = gx;
        this.scenePanLastY = gy;
        this.input.setDefaultCursor('grabbing');
        if (canvasEl) canvasEl.style.cursor = 'grabbing';
        return;
      }

      const pack = bridge.getPack();
      const cx = pack.fullLayout.center.x;
      const cy = pack.fullLayout.center.y;
      const cw = pack.fullLayout.center.w;
      const ch = pack.fullLayout.center.h;
      const lx = gx - cx;
      const ly = gy - cy;
      if (lx < 0 || ly < 0 || lx > cw || ly > ch) return;
      const hit = hitTest(
        lx,
        ly,
        computeHitRegions(
          cw,
          ch,
          pack.snapshot.agents,
          this.officeRoot && this.officeMapSpawns.length
            ? { rootX: this.officeRoot.x, rootY: this.officeRoot.y, spawns: this.officeMapSpawns }
            : null,
        ),
      );
      if (hit?.kind === 'agent') bridge.handlers.onSelectAgent(hit.id);
      else if (hit?.kind === 'room' && pack.selectedAgentId)
        void bridge.handlers.onMoveAgent(pack.selectedAgentId, hit.name);
    });

    void this.tryMountOfficeTiledMap();
  }

  /** office 加载失败或解析失败时退回矢量房间图 */
  private applyVectorBuildingFallback(): void {
    this.officeMapStatus = 'fallback';
    this.lastLayoutKey = '';
    this.officeMapSpawns = [];
    this.officeObstacleTilesCache = [];
    for (const k of this.officeTilesetTextureKeys) {
      if (this.textures.exists(k)) this.textures.remove(k);
    }
    this.officeTilesetTextureKeys = [];
    const page = computePhaserParentLayout(this.scale.width, this.scale.height);
    const L = computeBuildingLayout(page.center.w, page.center.h);
    this.rebuildBuilding(page.center.w, page.center.h, L);
  }

  /** 办公室图层 1:1 图块像素；与 Tiled 原点一致左上角对齐 (0,·)，竖直仅在视口更高时居中。 */
  private layoutOfficeTiledMap(viewW: number, viewH: number): void {
    const root = this.officeRoot;
    if (!root || this.officePixelSize.w < 8 || viewW < 32 || viewH < 32) return;
    const mh = this.officePixelSize.h;
    root.setScale(1);
    root.setPosition(0, Math.max(0, (viewH - mh) / 2));
  }

  private async tryMountOfficeTiledMap(): Promise<void> {
    if (this.officeRoot) return;
    for (const k of this.officeTilesetTextureKeys) {
      if (this.textures.exists(k)) this.textures.remove(k);
    }
    this.officeTilesetTextureKeys = [];
    this.officeMapSpawns = [];
    this.officeObstacleTilesCache = [];

    try {
      const mapRes = await fetch(publicAssetUrl('assets/tiles/office_layer.json'));
      if (!mapRes.ok) {
        console.warn(`[office map] office_layer.json 读取失败 ${mapRes.status}`);
        this.applyVectorBuildingFallback();
        return;
      }
      const mapData = (await mapRes.json()) as {
        layers?: unknown[];
        tilewidth?: number;
        tileheight?: number;
        width?: number;
        height?: number;
        tilesets?: { firstgid?: number; source?: string }[];
      };
      const tw = Number(mapData.tilewidth ?? 32);
      const th = Number(mapData.tileheight ?? 32);
      this.officeMapTileW = tw;
      this.officeMapTileH = th;

      const tsRefs = (mapData.tilesets ?? [])
        .filter((t) => Number(t.firstgid) > 0 && typeof t.source === 'string')
        .sort((a, b) => Number(a.firstgid) - Number(b.firstgid)) as { firstgid: number; source: string }[];

      if (!tsRefs.length) {
        console.warn('[office map] office_layer 未声明 tilesets');
        this.applyVectorBuildingFallback();
        return;
      }

      const resolved: ResolvedOfficeTileset[] = [];

      for (let i = 0; i < tsRefs.length; i++) {
        const ref = tsRefs[i]!;
        const firstGid = Number(ref.firstgid);
        const source = ref.source;
        const sourceBase = source.split('/').pop() ?? 'tileset.json';

        type TsDocShape = { image?: string; tilecount?: number; tilewidth?: number; tileheight?: number };
        let tsDoc: TsDocShape | null = null;
        for (const rel of tilesetSourceToJsonCandidates(source)) {
          const r = await fetch(publicAssetUrl(`assets/tiles/${rel}`));
          if (r.ok) {
            tsDoc = (await r.json()) as TsDocShape;
            break;
          }
        }
        if (!tsDoc?.image) {
          console.warn(`[office map] 无法读取 tileset（${source}）`);
          this.applyVectorBuildingFallback();
          return;
        }

        const nextFirst = i + 1 < tsRefs.length ? Number(tsRefs[i + 1]!.firstgid) : null;
        const tileCount = Number(tsDoc.tilecount ?? 0);
        const lastGidExclusive =
          nextFirst != null && nextFirst > firstGid ? nextFirst : firstGid + (tileCount > 0 ? tileCount : 512);

        const tsw = Number(tsDoc.tilewidth ?? tw);
        const tsh = Number(tsDoc.tileheight ?? th);
        const textureKey = `office-ts-${firstGid}`;
        let loaded = false;
        for (const img of imageFileCandidates(sourceBase, tsDoc.image)) {
          const url = publicAssetUrl(`assets/tiles/${img}`);
          if (await loadOfficeTilesetSpriteSheet(this, textureKey, url, tsw, tsh)) {
            this.officeTilesetTextureKeys.push(textureKey);
            resolved.push({
              firstGid,
              lastGidExclusive,
              textureKey,
              tileW: tsw,
              tileH: tsh,
            });
            loaded = true;
            break;
          }
        }
        if (!loaded) {
          const tried = imageFileCandidates(sourceBase, tsDoc.image)
            .map((f) => publicAssetUrl(`assets/tiles/${f}`))
            .join(', ');
          console.warn(`[office map] tileset「${sourceBase}」PNG 加载失败，已尝试：${tried}`);
          if (import.meta.env.DEV) {
            console.error('[office map] tileset PNG failed', { source, sourceBase, tried });
          }
          this.applyVectorBuildingFallback();
          return;
        }
      }

      if (!resolved.length) {
        this.applyVectorBuildingFallback();
        return;
      }

      const cr = collectOfficeTilesFromMap(
        mapData as Parameters<typeof collectOfficeTilesFromMap>[0],
        resolved,
      );
      const tiles = cr.tiles;
      const unmappedCount = cr.unmappedCount;
      const unmappedGidSamples = cr.unmappedGidSamples;
      const extentMeta: { width?: number; height?: number } = mapData;
      const tileWUse = tw;
      const tileHUse = th;
      this.officeMapSpawns = collectOfficeSpawnsFromMap(
        mapData as Parameters<typeof collectOfficeSpawnsFromMap>[0],
      );

      if (unmappedCount > 0) {
        console.warn(
          `[office map] ${unmappedCount} 个瓦片无对应已加载 tileset（GID 样例）:`,
          unmappedGidSamples,
        );
      }
      if (!tiles.length) {
        console.warn('[office map] office_layer 解析后无图块，请检查图层/chunks');
        this.applyVectorBuildingFallback();
        return;
      }
      const c = createOfficeTileContainer(this, tiles, tileWUse, tileHUse);
      this.officeRoot = c;
      this.officeObstacleTilesCache = cr.obstacleTiles.slice();
      this.officeMapStatus = 'ready';
      this.centerRoot.add(c);
      this.officePixelSize = officeMapPixelExtent(extentMeta, tileWUse, tileHUse, tiles);
      this.lastLayoutKey = '';
      const page = computePhaserParentLayout(this.scale.width, this.scale.height);
      const L = computeBuildingLayout(page.center.w, page.center.h);
      this.rebuildBuilding(page.center.w, page.center.h, L);
      this.layoutOfficeTiledMap(page.center.w, page.center.h);
    } catch (e) {
      console.warn(`[office map] 办公室地图失败：${(e as Error).message}`);
      this.applyVectorBuildingFallback();
    }
  }

  private clearLabels(): void {
    for (const t of this.labelTexts) t.destroy();
    this.labelTexts = [];
  }

  private addLabel(x: number, y: number, text: string, size: number, color: string, originX = 0, originY = 0): void {
    const t = this.add.text(x, y, text, {
      fontSize: `${size}px`,
      color,
      fontFamily: studioFontUi,
    });
    t.setOrigin(originX, originY);
    t.setDepth(0.5);
    this.centerRoot.add(t);
    this.labelTexts.push(t);
  }

  private rebuildBuilding(w: number, h: number, L: ReturnType<typeof computeBuildingLayout>): void {
    this.clearLabels();
    const g = this.buildingG;
    g.clear();

    g.fillStyle(hx(C.bg), 1);
    g.fillRect(0, 0, w, h);
    if (this.officeRoot) return;
    if (this.officeMapStatus === 'loading') {
      return;
    }

    const {
      ROOM_W,
      ROOM_H,
      BUILDING_W,
      KING_W,
      KING_H,
      buildingOffsetX,
      buildingOffsetY,
      row2Y,
      row3Y,
      row4Y,
    } = L;
    const ox = buildingOffsetX;
    const oy = buildingOffsetY;

    const rect = (x: number, y: number, rw: number, rh: number, color: string) => {
      g.fillStyle(hx(color), 1);
      g.fillRect(ox + x, oy + y, rw, rh);
    };
    const stroke = (x: number, y: number, rw: number, rh: number, color: string, lw = 1) => {
      g.lineStyle(lw, hx(color), 1);
      g.strokeRect(ox + x, oy + y, rw, rh);
    };

    const corridorCenterX = ROOM_W * 2 + WALL * 2 + WALL / 2;
    const corridorX = corridorCenterX - VISUAL_CORRIDOR_W / 2;
    const doorX = corridorCenterX - DOOR / 2;

    rect((BUILDING_W - KING_W) / 2, 0, KING_W, KING_H, C.king);
    stroke((BUILDING_W - KING_W) / 2, 0, KING_W, KING_H, '#4169E1', 3);
    this.addLabel(ox + BUILDING_W / 2, oy + KING_H / 2 + 4, '城主办公室', 12, '#ffffff', 0.5, 0.5);
    rect(doorX, KING_H, DOOR, WALL, C.door);
    rect(doorX, KING_H + WALL, DOOR, V_CORR_H, C.floor);

    const drawRow = (y: number, labels: string[], fixed: boolean[]) => {
      for (let i = 0; i < 4; i++) {
        const x = i * (ROOM_W + WALL);
        rect(x, y, ROOM_W, ROOM_H, fixed[i] ? C.fixed : C.dynamic);
        stroke(x, y, ROOM_W, ROOM_H, fixed[i] ? '#4169E1' : '#228B22', 2);
        this.addLabel(ox + x + ROOM_W / 2, oy + y + ROOM_H / 2, labels[i]!, 11, '#ffffff', 0.5, 0.5);
        const ddx = i === 0 || i === 2 ? x + (ROOM_W * 3) / 4 - DOOR / 2 : x + ROOM_W / 4 - DOOR / 2;
        rect(ddx, y + ROOM_H - WALL, DOOR, WALL, C.door);
      }
    };

    drawRow(row2Y, ['休息室', '资料室', '会议室', '机房'], [true, true, true, true]);
    rect(corridorX, row2Y, VISUAL_CORRIDOR_W, ROOM_H, C.floor);
    rect(0, row2Y + ROOM_H, corridorX + VISUAL_CORRIDOR_W, MID_CORRIDOR_H, C.floor);
    rect(corridorX + VISUAL_CORRIDOR_W, row2Y + ROOM_H, BUILDING_W - (corridorX + VISUAL_CORRIDOR_W), MID_CORRIDOR_H, C.floor);

    drawRow(row3Y, ['办公室1', '办公室2', '办公室3', '办公室4'], [false, false, false, false]);
    rect(corridorX, row3Y, VISUAL_CORRIDOR_W, ROOM_H, C.floor);
    rect(0, row3Y + ROOM_H, corridorX + VISUAL_CORRIDOR_W, MID_CORRIDOR_H, C.floor);
    rect(corridorX + VISUAL_CORRIDOR_W, row3Y + ROOM_H, BUILDING_W - (corridorX + VISUAL_CORRIDOR_W), MID_CORRIDOR_H, C.floor);

    drawRow(row4Y, ['办公室5', '办公室6', '办公室7', '办公室8'], [false, false, false, false]);
    rect(corridorX, row4Y, VISUAL_CORRIDOR_W, ROOM_H, C.floor);
    rect(0, row4Y + ROOM_H, corridorX + VISUAL_CORRIDOR_W, BOTTOM_CORRIDOR_H, C.floor);
    rect(corridorX + VISUAL_CORRIDOR_W, row4Y + ROOM_H, BUILDING_W - (corridorX + VISUAL_CORRIDOR_W), BOTTOM_CORRIDOR_H, C.floor);

    const buildingEndY = row4Y + ROOM_H + BOTTOM_CORRIDOR_H + WALL;
    rect(-8, 0, 8, buildingEndY + 8, C.wall);
    rect(BUILDING_W, 0, 8, buildingEndY + 8, C.wall);
  }

  applySync(pack: StudioSyncPack): void {
    if (!this.buildingG || !this.centerRoot) return;
    const z = useUiStore.getState().studioCenterPixelZoom;
    const clampZ = Number.isFinite(z) ? Math.min(3, Math.max(0.25, z)) : 1;
    this.cameras.main.setZoom(clampZ);
    const { w, h, fullLayout } = pack;
    if (w < 32 || h < 32) return;

    const bridge = this.game.registry.get('studioCtx') as StudioCtxBridge | undefined;
    if (!this.shellUi && bridge) {
      this.shellUi = new StudioShellUi(
        this,
        () => {
          const b = this.game.registry.get('studioCtx') as StudioCtxBridge;
          const p = b.getPack();
          return {
            layout: p.fullLayout,
            snapshot: p.snapshot,
            gatewayStatus: p.gatewayStatus,
            loading: p.loading,
            bottomSheet: p.bottomSheet,
            selectedAgentId: p.selectedAgentId,
            selectedTaskId: p.selectedTaskId,
          };
        },
        () => (this.game.registry.get('studioCtx') as StudioCtxBridge).handlers,
      );
    }
    try {
      this.shellUi?.sync();
    } catch (e) {
      console.error('StudioShellUi.sync', e);
    }

    this.centerRoot.setPosition(fullLayout.center.x, fullLayout.center.y);

    const cw = fullLayout.center.w;
    const ch = fullLayout.center.h;
    const L = computeBuildingLayout(cw, ch);
    const key = `${cw}x${ch}`;
    if (key !== this.lastLayoutKey) {
      this.lastLayoutKey = key;
      this.cameras.main.setScroll(0, 0);
      this.rebuildBuilding(cw, ch, L);
    }
    if (this.officeRoot && this.officePixelSize.w > 0) {
      this.layoutOfficeTiledMap(cw, ch);
    }

    const {
      roomSlots,
      ROOM_W,
      ROOM_H,
      buildingOffsetX,
      buildingOffsetY,
    } = L;

    const inferMood = (agentId: string): 'thinking' | 'tool' | 'done' | 'normal' => {
      const ci = pack.centerInference[agentId];
      if (!ci) return 'normal';
      if (ci.phase === 'tool') return 'tool';
      if (ci.phase === 'thinking') return 'thinking';
      if (ci.phase === 'done' && Date.now() < ci.doneExpiresAt) return 'done';
      return 'normal';
    };

    const alive = new Set<string>();

    const nowMs = Date.now();
    const logAgentPlacement = nowMs - this.lastAgentPlacementConsoleLog >= 1000;
    if (logAgentPlacement) {
      this.lastAgentPlacementConsoleLog = nowMs;
      console.log('[HermesStudio/agent] tick', {
        officeRoot: this.officeRoot
          ? { x: this.officeRoot.x, y: this.officeRoot.y, visible: this.officeRoot.visible }
          : null,
        officeMapSpawnsCount: this.officeMapSpawns.length,
        centerRoot: { x: this.centerRoot.x, y: this.centerRoot.y },
        canvas: { w: pack.fullLayout.center.w, h: pack.fullLayout.center.h },
      });
    }

    const cwx = this.centerRoot.x;
    const cwy = this.centerRoot.y;

    for (const agent of pack.snapshot.agents) {
      const spawn = StudioScene.matchOfficeSpawn(agent, this.officeMapSpawns);

      const pos = roomSlots[agent.location];
      /** 仅有 Tiled sp 点位、无矢量房间名命中时仍要画人，否则 location 与中文房间名不一致会整段 continue */
      if (!spawn && !pos) continue;

      let ax: number;
      let ay: number;
      if (spawn && this.officeRoot) {
        const wlk = this.collabWalkFootOverride.get(agent.id);
        const ox = wlk?.ox ?? spawn.px;
        const oy = wlk?.oy ?? spawn.py;
        ax = this.officeRoot.x + ox;
        ay = this.officeRoot.y + oy;
      } else if (pos) {
        const roomX = pos.col * (ROOM_W + WALL);
        ax = buildingOffsetX + roomX + pos.offsetX;
        ay = buildingOffsetY + pos.rowY + ROOM_H - 30;
      } else {
        continue;
      }
      const nw = AGENT_W;
      const nh = AGENT_H;
      const spriteTop = ay - nh;
      const worldX = cwx + ax;
      const worldY = cwy + ay;
      const worldSpriteTop = cwy + spriteTop;

      const base = resolveSpriteBase(
        agent.avatar,
        agent.gender,
        agent.personality,
        agent.name,
        agent.profile ?? agent.id,
      );
      let texKey = personTextureKey(base);
      const hadPrimaryTexture = this.textures.exists(texKey);
      if (!hadPrimaryTexture) {
        texKey = personTextureKey('citizen_01');
      }

      const vis = pack.agentVisuals[agent.id] ?? { dir: 'down' as Direction, frame: 0 };
      const useMapFacing = !!spawn && this.officeRoot && agent.status !== 'walking';
      const convFace = this.collabFacingOverride.get(agent.id);
      const dirForFrame = convFace ? convFace : useMapFacing ? spawn.direction : vis.dir;
      const frame = personFrameIndex(dirForFrame, vis.frame);
      if (logAgentPlacement) {
        const hasTexture = this.textures.exists(texKey);
        console.log('[HermesStudio/agent]', {
          id: agent.id,
          name: agent.name,
          profile: agent.profile ?? '(none)',
          location: agent.location,
          status: agent.status,
          matchedSpawnAgentAttr: spawn?.agentAttr ?? null,
          spawnMapPx: spawn ? { px: spawn.px, py: spawn.py, direction: spawn.direction } : null,
          worldPx: { ax, ay },
          visDir: vis.dir,
          useMapFacing,
          dirForFrame,
          frame,
          spriteBase: base,
          texKey,
          hadPrimaryTexture,
          hasTexture,
          skippedNoTexture: !hasTexture,
        });
      }
      if (!this.textures.exists(texKey)) continue;

      const isSelected = agent.id === pack.selectedAgentId;
      const mood = inferMood(agent.id);

      alive.add(agent.id);
      let ui = this.agentUi.get(agent.id);
      if (!ui) {
        const image = this.add.image(worldX, worldY, texKey, frame);
        image.setOrigin(0.5, 1);
        image.setDepth(StudioScene.AGENT_SCENE_DEPTH);

        const nameText = this.add.text(worldX, worldSpriteTop - 4, agent.name, {
          fontSize: '12px',
          color: isSelected ? C.gold : studioInk.body,
          fontFamily: studioFontUi,
        });
        nameText.setLetterSpacing(0.06);
        nameText.setOrigin(0.5, 1);
        nameText.setDepth(StudioScene.AGENT_SCENE_DEPTH + 0.1);

        const stateBubble = this.add.graphics();
        stateBubble.setDepth(StudioScene.AGENT_SCENE_DEPTH + 0.1);
        stateBubble.setVisible(false);

        const stateText = this.add.text(worldX, worldSpriteTop - 12, '', {
          fontSize: '11px',
          color: C.gold,
          fontFamily: studioFontUi,
        });
        stateText.setLetterSpacing(0.04);
        stateText.setOrigin(0.5, 0.5);
        stateText.setDepth(StudioScene.AGENT_SCENE_DEPTH + 0.2);
        stateText.setVisible(false);

        ui = { image, nameText, stateBubble, stateText };
        this.agentUi.set(agent.id, ui);
      }

      ui.image.setTexture(texKey, frame);
      ui.image.setPosition(worldX, worldY);
      ui.image.setDepth(StudioScene.AGENT_SCENE_DEPTH);
      ui.nameText.setDepth(StudioScene.AGENT_SCENE_DEPTH + 0.1);
      ui.stateBubble.setDepth(StudioScene.AGENT_SCENE_DEPTH + 0.1);
      ui.stateText.setDepth(StudioScene.AGENT_SCENE_DEPTH + 0.2);
      if (isSelected) ui.image.setTint(0xffe8a0);
      else ui.image.clearTint();

      ui.nameText.setText(agent.name);
      ui.nameText.setPosition(worldX, worldSpriteTop - 4);
      ui.nameText.setStyle({ color: isSelected ? C.gold : '#ffffff' });

      // 统一气泡状态：thinking → 思考中...，tool → 工具使用中...，done → 推理结果
      const stateLabel: string =
        mood === 'thinking' ? '思考中...' :
        mood === 'tool' ? (pack.centerInference[agent.id]?.toolSnippet ? pack.centerInference[agent.id].toolSnippet + '...' : '工具使用中...') :
        mood === 'done' ? (pack.centerInference[agent.id]?.doneSnippet || '推理已完成') :
        '';
      if (mood !== 'normal') {
        ui.stateText.setText(stateLabel);
        const tw = Math.max(ui.stateText.width + 10, 28);
        const th = 18;
        const pad = 5;
        const lineColor = mood === 'done' ? C.gold : mood === 'tool' ? '#4fc3f7' : '#ffffff';
        const bubbleW = tw + pad * 2;
        const bubbleH = th + pad * 2;
        ui.stateBubble.clear();
        ui.stateBubble.fillStyle(0x000000, 0.7);
        ui.stateBubble.fillRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 6);
        ui.stateBubble.lineStyle(1, hx(lineColor), 0.9);
        ui.stateBubble.strokeRoundedRect(-bubbleW / 2, -bubbleH / 2, bubbleW, bubbleH, 6);
        ui.stateBubble.setPosition(worldX, worldSpriteTop - 38);
        ui.stateText.setPosition(worldX, worldSpriteTop - 38);
        ui.stateBubble.setVisible(true);
        ui.stateText.setVisible(true);
      } else {
        ui.stateBubble.setVisible(false);
        ui.stateText.setVisible(false);
      }
    }

    for (const [id, ui] of this.agentUi) {
      if (!alive.has(id)) {
        ui.image.destroy();
        ui.nameText.destroy();
        ui.stateBubble.destroy();
        ui.stateText.destroy();
        this.agentUi.delete(id);
      }
    }
  }

  private static readonly COLLAB_WALK_STEP_MS = 95;

  /** 脚底连线方向：谁脚在谁哪一侧（与 CenterStage `dirFromDelta` 一致） */
  private static directionTowardDelta(dx: number, dy: number): Direction {
    if (dx === 0 && dy === 0) return 'down';
    if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  /** 解除「与某 Agent 面对面」状态（双方恢复 Tiled 默认朝向） */
  private clearCollabFacingPair(agentId: string): void {
    const peer = this.collabFacingPeer.get(agentId);
    this.collabFacingOverride.delete(agentId);
    this.collabFacingPeer.delete(agentId);
    if (peer) {
      this.collabFacingOverride.delete(peer);
      this.collabFacingPeer.delete(peer);
    }
  }

  /** 走近后双方脚底互视朝向 */
  private applyCollabConversationFacing(
    fromAgentId: string,
    peerAgentId: string,
    fromSpawn: OfficeSceneSpawn,
    peerSpawn: OfficeSceneSpawn,
  ): void {
    this.clearCollabFacingPair(fromAgentId);
    this.clearCollabFacingPair(peerAgentId);
    const fromW = this.collabWalkFootOverride.get(fromAgentId);
    const peerW = this.collabWalkFootOverride.get(peerAgentId);
    const fromPx = fromW?.ox ?? fromSpawn.px;
    const fromPy = fromW?.oy ?? fromSpawn.py;
    const peerPx = peerW?.ox ?? peerSpawn.px;
    const peerPy = peerW?.oy ?? peerSpawn.py;
    const fromDir = StudioScene.directionTowardDelta(peerPx - fromPx, peerPy - fromPy);
    const peerDir = StudioScene.directionTowardDelta(fromPx - peerPx, fromPy - peerPy);
    this.collabFacingOverride.set(fromAgentId, fromDir);
    this.collabFacingOverride.set(peerAgentId, peerDir);
    this.collabFacingPeer.set(fromAgentId, peerAgentId);
    this.collabFacingPeer.set(peerAgentId, fromAgentId);
  }

  /** 清除协作行走覆盖（进入新一轮转交前调用） */
  clearCollabWalkFootOverride(agentId: string): void {
    this.collabWalkFootOverride.delete(agentId);
    this.clearCollabFacingPair(agentId);
  }

  /** 脚底路径动画；`clearOverrideWhenDone` 为 true 时结束时删除覆盖（走回出生点） */
  private runCollabFootAnimation(
    agentId: string,
    steps: { px: number; py: number }[],
    stepMs: number,
    clearOverrideWhenDone: boolean,
  ): Promise<void> {
    return new Promise((resolve) => {
      if (steps.length === 0) {
        this.collabWalkBusy.delete(agentId);
        resolve();
        return;
      }
      if (steps.length === 1) {
        const s = steps[0]!;
        this.collabWalkFootOverride.set(agentId, { ox: s.px, oy: s.py });
        if (clearOverrideWhenDone) this.collabWalkFootOverride.delete(agentId);
        this.collabWalkBusy.delete(agentId);
        resolve();
        return;
      }
      this.collabWalkBusy.add(agentId);
      let idx = 1;
      const finish = () => {
        if (clearOverrideWhenDone) this.collabWalkFootOverride.delete(agentId);
        this.collabWalkBusy.delete(agentId);
        resolve();
      };
      const tick = () => {
        if (idx >= steps.length) {
          finish();
          return;
        }
        const s = steps[idx]!;
        this.collabWalkFootOverride.set(agentId, { ox: s.px, oy: s.py });
        idx += 1;
        this.time.delayedCall(stepMs, tick);
      };
      this.time.delayedCall(0, tick);
    });
  }

  /**
   * 多协作转交前：发起人沿 A* 走到同伴邻格（与同伴包围盒不重叠）；**不**清除脚底覆盖，便于批内走向下一人。
   * `chainFromCurrent`：从当前覆盖脚底继续走（上一同伴对话结束后）。
   */
  async runCollabApproachWalk(
    fromAgentId: string,
    peerAgentId: string,
    opts?: { chainFromCurrent?: boolean },
  ): Promise<boolean> {
    const bridge = this.game.registry.get('studioCtx') as StudioCtxBridge | undefined;
    const pack = bridge?.getPack();
    if (!pack || !this.officeRoot || this.officePixelSize.w < 8) {
      return false;
    }
    if (this.collabWalkBusy.has(fromAgentId)) {
      return false;
    }
    const fromA = pack.snapshot.agents.find((a) => a.id === fromAgentId);
    const peerA = pack.snapshot.agents.find((a) => a.id === peerAgentId);
    if (!fromA || !peerA) return false;
    const fromSpawn = StudioScene.matchOfficeSpawn(fromA, this.officeMapSpawns);
    const peerSpawn = StudioScene.matchOfficeSpawn(peerA, this.officeMapSpawns);
    if (!fromSpawn || !peerSpawn) return false;

    /** 同伴若在地图上已有行走覆盖，以其当前脚底为准，避免仍走向 Tiled 出生工位 */
    const peerO = this.collabWalkFootOverride.get(peerAgentId);
    const peerTargetFoot: OfficeSceneSpawn = peerO
      ? { ...peerSpawn, px: peerO.ox, py: peerO.oy }
      : peerSpawn;

    const feetBlock: { px: number; py: number }[] = [];
    for (const a of pack.snapshot.agents) {
      if (a.id === fromAgentId) continue;
      const s = StudioScene.matchOfficeSpawn(a, this.officeMapSpawns);
      if (!s) continue;
      const wlk = this.collabWalkFootOverride.get(a.id);
      feetBlock.push({ px: wlk?.ox ?? s.px, py: wlk?.oy ?? s.py });
    }
    const o = opts?.chainFromCurrent ? this.collabWalkFootOverride.get(fromAgentId) : undefined;
    const fromFootOverride = o ? { px: o.ox, py: o.oy } : null;
    const plan = findOfficePeerApproachFootSteps(
      this.officePixelSize.w,
      this.officePixelSize.h,
      this.officeMapTileW,
      this.officeMapTileH,
      this.officeObstacleTilesCache,
      feetBlock,
      fromSpawn,
      peerTargetFoot,
      fromFootOverride,
    );
    if (!plan) return false;
    this.clearCollabFacingPair(fromAgentId);
    this.clearCollabFacingPair(peerAgentId);
    if (plan.steps.length <= 1) {
      this.applyCollabConversationFacing(fromAgentId, peerAgentId, fromSpawn, peerSpawn);
      return true;
    }
    await this.runCollabFootAnimation(
      fromAgentId,
      plan.steps,
      StudioScene.COLLAB_WALK_STEP_MS,
      false,
    );
    this.applyCollabConversationFacing(fromAgentId, peerAgentId, fromSpawn, peerSpawn);
    return true;
  }

  /** 批内同伴全部对话完后，走回该 Agent 的 Tiled 出生点并清除覆盖 */
  async runCollabWalkReturnToSpawn(fromAgentId: string): Promise<boolean> {
    const bridge = this.game.registry.get('studioCtx') as StudioCtxBridge | undefined;
    const pack = bridge?.getPack();
    if (!pack || !this.officeRoot || this.officePixelSize.w < 8) {
      return false;
    }
    if (this.collabWalkBusy.has(fromAgentId)) {
      return false;
    }
    const fromA = pack.snapshot.agents.find((a) => a.id === fromAgentId);
    if (!fromA) return false;
    const fromSpawn = StudioScene.matchOfficeSpawn(fromA, this.officeMapSpawns);
    if (!fromSpawn) return false;

    const feetBlock: { px: number; py: number }[] = [];
    for (const a of pack.snapshot.agents) {
      if (a.id === fromAgentId) continue;
      const s = StudioScene.matchOfficeSpawn(a, this.officeMapSpawns);
      if (!s) continue;
      const wlk = this.collabWalkFootOverride.get(a.id);
      feetBlock.push({ px: wlk?.ox ?? s.px, py: wlk?.oy ?? s.py });
    }
    const o = this.collabWalkFootOverride.get(fromAgentId);
    const fromFoot = o ? { px: o.ox, py: o.oy } : { px: fromSpawn.px, py: fromSpawn.py };
    const plan = findOfficeReturnFootSteps(
      this.officePixelSize.w,
      this.officePixelSize.h,
      this.officeMapTileW,
      this.officeMapTileH,
      this.officeObstacleTilesCache,
      feetBlock,
      fromFoot,
      fromSpawn,
    );
    if (!plan || plan.steps.length <= 1) {
      this.collabWalkFootOverride.delete(fromAgentId);
      this.clearCollabFacingPair(fromAgentId);
      return plan !== null;
    }
    await this.runCollabFootAnimation(
      fromAgentId,
      plan.steps,
      StudioScene.COLLAB_WALK_STEP_MS,
      true,
    );
    this.clearCollabFacingPair(fromAgentId);
    return true;
  }

  /**
   * 办公室 **地图本地** 像素系下的寻路障碍格：`1` = 非地板图层的瓦片或与人物占位（`AGENT_W`×`AGENT_H`）相交。
   * 地板层（`floot`/`floor` 等，见 `isFloorTileLayer`）不计障碍；人物每帧从 `pack` 计算，为动态障碍。
   * 仅含 Tiled `sp` 站位的角色；纯矢量房间小人不在此网格中。
   */
  buildOfficeObstacleGrid(pack: StudioSyncPack, excludeAgentId?: string | null): number[][] | null {
    if (!this.officeRoot || this.officePixelSize.w < 8 || this.officePixelSize.h < 8) return null;
    const feet: { px: number; py: number }[] = [];
    for (const agent of pack.snapshot.agents) {
      if (excludeAgentId && agent.id === excludeAgentId) continue;
      const spawn = StudioScene.matchOfficeSpawn(agent, this.officeMapSpawns);
      if (spawn) feet.push({ px: spawn.px, py: spawn.py });
    }
    return makeOfficeObstacleGrid(
      this.officePixelSize.w,
      this.officePixelSize.h,
      this.officeMapTileW,
      this.officeMapTileH,
      this.officeObstacleTilesCache,
      feet,
      AGENT_W,
      AGENT_H,
    );
  }

  private static matchOfficeSpawn(agent: Agent, spawns: OfficeSceneSpawn[]): OfficeSceneSpawn | undefined {
    if (isPeerVisitorAgent(agent)) {
      return {
        agentAttr: '__peer_visitor__',
        px: PEER_VISITOR_OFFICE_FEET_PX,
        py: PEER_VISITOR_OFFICE_FEET_PY,
        direction: 'down',
      };
    }
    return spawns.find((s) => {
      const a = s.agentAttr.trim();
      const p = (agent.profile?.trim() ?? '').toLowerCase();
      return p === a.toLowerCase() || agent.id.trim() === a || agent.name.trim() === a;
    });
  }
}

export type StudioGameApi = {
  sync: (pack: StudioSyncPack) => void;
  /** 将 Phaser 画布尺寸与父元素对齐（整页 1:1 像素） */
  layoutToHost: () => void;
  /**
   * 当前办公室障碍网格（非地板瓦片 + 人物脚底占位，人物每帧重算）；无办公室地图时为 `null`。
   * `excludeAgentId` 用于给该角色自身寻路时临时挖空其占用格。
   */
  buildOfficeObstacleGrid: (excludeAgentId?: string | null) => number[][] | null;
  /** 发起人走到同伴邻格；`chainFromCurrent` 为 true 时从当前站立点继续 */
  runCollabApproachWalk: (
    fromAgentId: string,
    peerAgentId: string,
    opts?: { chainFromCurrent?: boolean },
  ) => Promise<boolean>;
  /** 协作批结束后走回 Tiled 出生点并清除脚底覆盖 */
  runCollabWalkReturnToSpawn: (fromAgentId: string) => Promise<boolean>;
  clearCollabWalkFootOverride: (fromAgentId: string) => void;
  destroy: () => void;
};

export function mountStudioGame(parent: HTMLElement, ctx: StudioCtxBridge): StudioGameApi {
  parent.style.position = parent.style.position || 'relative';
  pendingStudioCtxBridge = ctx;
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: STUDIO_GAME_BASE_WIDTH,
    height: STUDIO_GAME_BASE_HEIGHT,
    transparent: false,
    backgroundColor: hx(C.bg),
    banner: false,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    render: {
      antialias: false,
      pixelArt: true,
    },
    scene: [StudioScene],
    plugins: {
      scene: [{ key: 'AStarPathfinder', plugin: AStarPathfinderPlugin, mapping: 'aStar' }],
    },
  });

  const canvas = game.canvas;
  if (canvas) {
    canvas.style.cursor = 'pointer';
    canvas.style.imageRendering = 'pixelated';
  }

  const getScene = (): StudioScene | null => {
    try {
      const s = game.scene?.getScene('StudioScene');
      return s ? (s as StudioScene) : null;
    } catch {
      return null;
    }
  };

  return {
    sync: (pack) => {
      const scene = getScene();
      if (!scene) return;
      scene.applySync(pack);
    },
    buildOfficeObstacleGrid: (excludeAgentId) => {
      const scene = getScene();
      if (!scene) return null;
      return scene.buildOfficeObstacleGrid(ctx.getPack(), excludeAgentId ?? null);
    },
    runCollabApproachWalk: (fromAgentId, peerAgentId, opts) => {
      const scene = getScene();
      if (!scene) return Promise.resolve(false);
      return scene.runCollabApproachWalk(fromAgentId, peerAgentId, opts);
    },
    runCollabWalkReturnToSpawn: (fromAgentId) => {
      const scene = getScene();
      if (!scene) return Promise.resolve(false);
      return scene.runCollabWalkReturnToSpawn(fromAgentId);
    },
    clearCollabWalkFootOverride: (fromAgentId) => {
      getScene()?.clearCollabWalkFootOverride(fromAgentId);
    },
    layoutToHost: () => {
      const w = Math.max(32, parent.clientWidth);
      const h = Math.max(32, parent.clientHeight);
      try {
        game.scale.setParentSize(w, h);
      } catch {
        /* torn down */
      }
      if (game.canvas) game.canvas.style.imageRendering = 'pixelated';
    },
    destroy: () => {
      game.destroy(true, false);
    },
  };
}
