/**
 * 网格 A*（与 Phaser 解耦，供 {@link AStarPathfinderPlugin} 与其它逻辑复用）。
 *
 * - `grid[y][x]`：`0` 可走，`>= 1` 阻挡（整数可扩展为进入代价，见 {@link AStarOptions}）。
 * - 返回路径为 **含起点与终点** 的格子序列；无路径时返回 `[]`。
 */

export type GridCoord = { x: number; y: number };

export type AStarOptions = {
  /** 默认 `false`（四邻）；`true` 为八邻，且禁止切角（两侧邻格须可走）。 */
  allowDiagonal?: boolean;
  /**
   * 当 `grid[y][x] > 0` 且 `< maxTraverseCost` 时，进入该格的代价为该数值（用于加权地图）。
   * 默认仅支持 0/1：`0` 可走，`>= maxTraverseCost` 为墙。
   */
  maxTraverseCost?: number;
  /** 防止异常大图卡死，默认 200_000 */
  maxIterations?: number;
};

type HeapNode = { x: number; y: number; g: number; f: number };

function heapPush(heap: HeapNode[], n: HeapNode): void {
  heap.push(n);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].f <= n.f) break;
    heap[i] = heap[p];
    i = p;
  }
  heap[i] = n;
}

function heapPop(heap: HeapNode[]): HeapNode | undefined {
  if (heap.length === 0) return undefined;
  const out = heap[0];
  const last = heap.pop()!;
  if (heap.length === 0) return out;
  heap[0] = last;
  let i = 0;
  const lf = last.f;
  for (;;) {
    let j = i * 2 + 1;
    if (j >= heap.length) break;
    let k = j + 1;
    if (k < heap.length && heap[k].f < heap[j].f) j = k;
    if (heap[j].f >= lf) break;
    heap[i] = heap[j];
    i = j;
  }
  heap[i] = last;
  return out;
}

function inBounds(grid: readonly (readonly number[])[], x: number, y: number): boolean {
  return y >= 0 && y < grid.length && x >= 0 && x < (grid[y]?.length ?? 0);
}

function cellCost(
  grid: readonly (readonly number[])[],
  x: number,
  y: number,
  maxTraverseCost: number,
): number {
  const v = grid[y][x];
  if (v <= 0) return 1;
  if (v >= maxTraverseCost) return Number.POSITIVE_INFINITY;
  return v;
}

function heuristic(ax: number, ay: number, bx: number, by: number, octile: boolean): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  if (!octile) return dx + dy;
  const m = Math.min(dx, dy);
  return dx + dy + (Math.SQRT2 - 2) * m;
}

const k = (x: number, y: number) => `${x},${y}`;

/**
 * 在矩形网格上求 A* 路径。
 */
export function astarFindPath(
  grid: readonly (readonly number[])[],
  start: GridCoord,
  goal: GridCoord,
  options: AStarOptions = {},
): GridCoord[] {
  const allowDiagonal = options.allowDiagonal ?? false;
  const maxTraverseCost = options.maxTraverseCost ?? 1;
  const maxIterations = options.maxIterations ?? 200_000;

  if (!inBounds(grid, start.x, start.y) || !inBounds(grid, goal.x, goal.y)) return [];
  if (cellCost(grid, start.x, start.y, maxTraverseCost) === Number.POSITIVE_INFINITY) return [];
  if (cellCost(grid, goal.x, goal.y, maxTraverseCost) === Number.POSITIVE_INFINITY) return [];
  if (start.x === goal.x && start.y === goal.y) return [{ ...start }];

  const octile = allowDiagonal;
  const open: HeapNode[] = [];
  const gScore = new Map<string, number>();
  const came = new Map<string, GridCoord>();

  const sx = start.x;
  const sy = start.y;
  const gx = goal.x;
  const gy = goal.y;
  const h0 = heuristic(sx, sy, gx, gy, octile);
  gScore.set(k(sx, sy), 0);
  heapPush(open, { x: sx, y: sy, g: 0, f: h0 });

  const cardinals: GridCoord[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  const diagonals: GridCoord[] = [
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 },
  ];

  let iterations = 0;
  while (open.length > 0 && iterations < maxIterations) {
    iterations++;
    const cur = heapPop(open);
    if (!cur) break;
    const curKey = k(cur.x, cur.y);
    const knownG = gScore.get(curKey);
    if (knownG === undefined || cur.g > knownG) continue;

    if (cur.x === gx && cur.y === gy) {
      const path: GridCoord[] = [];
      let cx = gx;
      let cy = gy;
      path.push({ x: cx, y: cy });
      while (cx !== sx || cy !== sy) {
        const prev = came.get(k(cx, cy));
        if (!prev) return [];
        cx = prev.x;
        cy = prev.y;
        path.push({ x: cx, y: cy });
      }
      path.reverse();
      return path;
    }

    const tryNeighbor = (nx: number, ny: number, stepCost: number) => {
      if (!inBounds(grid, nx, ny)) return;
      const enter = cellCost(grid, nx, ny, maxTraverseCost);
      if (enter === Number.POSITIVE_INFINITY) return;
      const tentative = cur.g + stepCost * enter;
      const nk = k(nx, ny);
      const prevG = gScore.get(nk);
      if (prevG !== undefined && tentative >= prevG) return;
      came.set(nk, { x: cur.x, y: cur.y });
      gScore.set(nk, tentative);
      const f = tentative + heuristic(nx, ny, gx, gy, octile);
      heapPush(open, { x: nx, y: ny, g: tentative, f });
    };

    for (const d of cardinals) {
      tryNeighbor(cur.x + d.x, cur.y + d.y, 1);
    }
    if (allowDiagonal) {
      for (const d of diagonals) {
        const nx = cur.x + d.x;
        const ny = cur.y + d.y;
        if (!inBounds(grid, nx, ny)) continue;
        if (
          cellCost(grid, cur.x + d.x, cur.y, maxTraverseCost) === Number.POSITIVE_INFINITY ||
          cellCost(grid, cur.x, cur.y + d.y, maxTraverseCost) === Number.POSITIVE_INFINITY
        ) {
          continue;
        }
        tryNeighbor(nx, ny, Math.SQRT2);
      }
    }
  }

  return [];
}
