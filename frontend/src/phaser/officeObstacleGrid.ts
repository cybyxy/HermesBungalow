import type { OfficeTileInst } from './officeTiledMap';

/** 人物脚底在 **办公室根节点本地** 像素坐标（与 `OfficeTileInst.px/py` 同系） */
export type OfficeFootprint = { px: number; py: number };

/**
 * 寻路用二值网格：`grid[y][x] === 1` 为障碍。
 * - `obstacleTiles`：仅含静态障碍图块（已排除地板层）；按图块左上角落格标记。
 * - `agentFeet`：动态障碍，每帧传入；按 `agentW × agentH` 轴对齐包围盒覆盖到的格标记。
 */
export function makeOfficeObstacleGrid(
  pixelW: number,
  pixelH: number,
  tileW: number,
  tileH: number,
  obstacleTiles: readonly OfficeTileInst[],
  agentFeet: readonly OfficeFootprint[],
  agentW: number,
  agentH: number,
): number[][] {
  const tw = Math.max(1, tileW);
  const th = Math.max(1, tileH);
  const gw = Math.max(1, Math.ceil(Math.max(1, pixelW) / tw));
  const gh = Math.max(1, Math.ceil(Math.max(1, pixelH) / th));
  const grid: number[][] = Array.from({ length: gh }, () => Array.from({ length: gw }, () => 0));

  const mark = (tx: number, ty: number) => {
    if (tx >= 0 && tx < gw && ty >= 0 && ty < gh) grid[ty]![tx] = 1;
  };

  for (const t of obstacleTiles) {
    mark(Math.floor(t.px / tw), Math.floor(t.py / th));
  }

  const halfW = agentW / 2;
  for (const a of agentFeet) {
    const left = a.px - halfW;
    const top = a.py - agentH;
    const right = a.px + halfW;
    const bottom = a.py;
    const tx0 = Math.floor(left / tw);
    const tx1 = Math.floor((right - 1e-6) / tw);
    const ty0 = Math.floor(top / th);
    const ty1 = Math.floor((bottom - 1e-6) / th);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) mark(tx, ty);
    }
  }

  return grid;
}
