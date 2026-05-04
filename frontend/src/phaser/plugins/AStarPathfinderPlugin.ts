import Phaser from 'phaser';
import { astarFindPath, type AStarOptions, type GridCoord } from './astarCore';

export type { AStarOptions, GridCoord } from './astarCore';
export { astarFindPath } from './astarCore';

/**
 * Phaser 3 场景级插件：网格 A*，可选从 TilemapLayer 生成阻挡表。
 *
 * 注册方式见 `studioGame.ts` 的 `plugins.scene`；映射名为 `aStar`，场景内 `this.aStar`。
 */
export class AStarPathfinderPlugin extends Phaser.Plugins.ScenePlugin {
  constructor(scene: Phaser.Scene, pluginManager: Phaser.Plugins.PluginManager, pluginKey: string) {
    super(scene, pluginManager, pluginKey);
  }

  boot(): void {
    this.systems?.events.once(Phaser.Scenes.Events.DESTROY, this.onSceneDestroy, this);
  }

  private onSceneDestroy(): void {
    this.systems?.events.off(Phaser.Scenes.Events.DESTROY, this.onSceneDestroy, this);
  }

  override destroy(): void {
    this.systems?.events.off(Phaser.Scenes.Events.DESTROY, this.onSceneDestroy, this);
    super.destroy();
  }

  /** 与 {@link astarFindPath} 相同 */
  findTilePath(
    grid: readonly (readonly number[])[],
    start: GridCoord,
    goal: GridCoord,
    options?: AStarOptions,
  ): GridCoord[] {
    return astarFindPath(grid, start, goal, options);
  }

  /**
   * 用回调生成 `grid[y][x]`：`0` 可走，`1` 阻挡。
   */
  buildBinaryGrid(width: number, height: number, isBlocked: (x: number, y: number) => boolean): number[][] {
    const grid: number[][] = [];
    for (let y = 0; y < height; y++) {
      const row: number[] = [];
      for (let x = 0; x < width; x++) row.push(isBlocked(x, y) ? 1 : 0);
      grid.push(row);
    }
    return grid;
  }

  /**
   * 从 Phaser `TilemapLayer` 生成二值网格：`tile.collides` 或 `blockedTileIndexes` 命中为墙。
   */
  buildGridFromTilemapLayer(
    layer: Phaser.Tilemaps.TilemapLayer,
    blockedTileIndexes?: ReadonlySet<number>,
  ): number[][] {
    const w = layer.layer.width;
    const h = layer.layer.height;
    return this.buildBinaryGrid(w, h, (x, y) => {
      const tile = layer.getTileAt(x, y, false);
      if (!tile || !tile.visible) return true;
      if (tile.collides) return true;
      if (blockedTileIndexes?.has(tile.index)) return true;
      return false;
    });
  }

  /** 格子中心世界坐标（与 Phaser Tilemap 对齐习惯一致） */
  tileToWorld(
    layer: Phaser.Tilemaps.TilemapLayer,
    tileX: number,
    tileY: number,
    out?: Phaser.Math.Vector2,
  ): Phaser.Math.Vector2 {
    const wx = layer.tileToWorldX(tileX) + layer.tilemap.tileWidth / 2;
    const wy = layer.tileToWorldY(tileY) + layer.tilemap.tileHeight / 2;
    if (out) return out.set(wx, wy);
    return new Phaser.Math.Vector2(wx, wy);
  }

  worldToTile(layer: Phaser.Tilemaps.TilemapLayer, worldX: number, worldY: number): GridCoord {
    return {
      x: layer.worldToTileX(worldX),
      y: layer.worldToTileY(worldY),
    };
  }
}
