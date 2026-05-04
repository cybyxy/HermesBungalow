import { AGENT_H, AGENT_W } from '../ui/buildingLayout';
import { astarFindPath, type GridCoord } from './plugins/astarCore';
import { makeOfficeObstacleGrid, type OfficeFootprint } from './officeObstacleGrid';
import type { OfficeSceneSpawn, OfficeTileInst } from './officeTiledMap';

function footCell(spawn: OfficeSceneSpawn, tw: number, th: number): GridCoord {
  return { x: Math.floor(spawn.px / tw), y: Math.floor(spawn.py / th) };
}

export function footCellFromPxPy(px: number, py: number, tw: number, th: number): GridCoord {
  return { x: Math.floor(px / tw), y: Math.floor(py / th) };
}

/** 与寻路格 (tx,ty) 对齐的脚底像素（办公室本地，与 `OfficeSceneSpawn` 同系） */
function footAtTileCell(tx: number, ty: number, tw: number, th: number): OfficeFootprint {
  return { px: tx * tw + tw / 2, py: (ty + 1) * th - 1 };
}

/** 两角色脚底为下沿中心、宽 AGENT_W 高 AGENT_H 的轴对齐包围盒是否相交 */
function invaderAndPeerOverlap(invFoot: OfficeFootprint, peerFoot: OfficeSceneSpawn): boolean {
  const hw = AGENT_W / 2;
  const il = invFoot.px - hw;
  const ir = invFoot.px + hw;
  const it = invFoot.py - AGENT_H;
  const ib = invFoot.py;
  const pl = peerFoot.px - hw;
  const pr = peerFoot.px + hw;
  const pt = peerFoot.py - AGENT_H;
  const pb = peerFoot.py;
  return !(ir < pl || il > pr || ib < pt || it > pb);
}

const CARD: GridCoord[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * 从发起人当前脚底到「同伴脚底四邻」中可走、**与同伴包围盒不相交**且最短的一条路。
 * `fromFootOverride`：链式转交时从上一站立点继续走；为 `null` 时用 `fromSpawn` 的 px/py。
 */
export function findOfficePeerApproachFootSteps(
  pixelW: number,
  pixelH: number,
  tw: number,
  th: number,
  obstacleTiles: readonly OfficeTileInst[],
  agentFeetBlocking: readonly OfficeFootprint[],
  fromSpawn: OfficeSceneSpawn,
  peerSpawn: OfficeSceneSpawn,
  fromFootOverride?: OfficeFootprint | null,
): { steps: OfficeFootprint[] } | null {
  const tw0 = Math.max(1, tw);
  const th0 = Math.max(1, th);
  const grid0 = makeOfficeObstacleGrid(
    pixelW,
    pixelH,
    tw0,
    th0,
    obstacleTiles,
    agentFeetBlocking,
    AGENT_W,
    AGENT_H,
  );
  const gh = grid0.length;
  const gw = grid0[0]?.length ?? 0;
  if (gw < 1 || gh < 1) return null;

  const startFoot: OfficeFootprint = fromFootOverride ?? { px: fromSpawn.px, py: fromSpawn.py };
  const start = footCellFromPxPy(startFoot.px, startFoot.py, tw0, th0);
  const peerC = footCell(peerSpawn, tw0, th0);

  const rawGoals: GridCoord[] = [];
  for (const d of CARD) {
    const gx = peerC.x + d.x;
    const gy = peerC.y + d.y;
    if (gx < 0 || gx >= gw || gy < 0 || gy >= gh) continue;
    if (grid0[gy]![gx] !== 0) continue;
    rawGoals.push({ x: gx, y: gy });
  }
  if (rawGoals.length === 0) return null;

  const goals = rawGoals.filter((g) => {
    const cand = footAtTileCell(g.x, g.y, tw0, th0);
    return !invaderAndPeerOverlap(cand, peerSpawn);
  });
  const useGoals = goals.length > 0 ? goals : rawGoals;

  let best: GridCoord[] | null = null;
  for (const goal of useGoals) {
    const g = grid0.map((row) => [...row]);
    if (start.y >= 0 && start.y < gh && start.x >= 0 && start.x < gw) g[start.y]![start.x] = 0;
    const path = astarFindPath(g, start, goal, { allowDiagonal: false });
    if (path.length === 0) continue;
    if (!best || path.length < best.length) best = path;
  }
  if (!best || best.length === 0) return null;

  const steps: OfficeFootprint[] = [{ px: startFoot.px, py: startFoot.py }];
  for (let i = 1; i < best.length; i++) {
    const c = best[i]!;
    steps.push(footAtTileCell(c.x, c.y, tw0, th0));
  }
  return { steps };
}

/** 走回出生 `toSpawn`：动态挡格为除行走者外的所有人脚底 */
export function findOfficeReturnFootSteps(
  pixelW: number,
  pixelH: number,
  tw: number,
  th: number,
  obstacleTiles: readonly OfficeTileInst[],
  agentFeetBlocking: readonly OfficeFootprint[],
  fromFoot: OfficeFootprint,
  toSpawn: OfficeSceneSpawn,
): { steps: OfficeFootprint[] } | null {
  const tw0 = Math.max(1, tw);
  const th0 = Math.max(1, th);
  const grid0 = makeOfficeObstacleGrid(
    pixelW,
    pixelH,
    tw0,
    th0,
    obstacleTiles,
    agentFeetBlocking,
    AGENT_W,
    AGENT_H,
  );
  const gh = grid0.length;
  const gw = grid0[0]?.length ?? 0;
  if (gw < 1 || gh < 1) return null;

  const start = footCellFromPxPy(fromFoot.px, fromFoot.py, tw0, th0);
  const goal = footCell(toSpawn, tw0, th0);
  const g = grid0.map((row) => [...row]);
  if (start.y >= 0 && start.y < gh && start.x >= 0 && start.x < gw) g[start.y]![start.x] = 0;
  const path = astarFindPath(g, start, goal, { allowDiagonal: false });
  if (path.length === 0) return null;

  const steps: OfficeFootprint[] = [{ px: fromFoot.px, py: fromFoot.py }];
  for (let i = 1; i < path.length; i++) {
    const c = path[i]!;
    steps.push(footAtTileCell(c.x, c.y, tw0, th0));
  }
  const last = steps[steps.length - 1]!;
  last.px = toSpawn.px;
  last.py = toSpawn.py;
  return { steps };
}
