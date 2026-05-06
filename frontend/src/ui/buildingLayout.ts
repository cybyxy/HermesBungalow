/**
 * Building geometry aligned with docs/原型/prototype-complete.html (simplified constants).
 * Coordinates are relative to the canvas top-left (center stage area).
 */

import type { Agent } from '../types/game';
import { layoutPx } from './theme';

export const LAYOUT = { top: 44, bottom: 56, left: 260, right: 260 } as const;

/**
 * Phaser 中央舞台固定逻辑分辨率：宽同 PRD（1920 − 左右各 260）；
 * 高从 1000 稿面高度扣除 theme 顶栏/底栏，与 App 一致；画布在 flex 容器内整区等比缩放、保持比例。
 */
export const STUDIO_LOGIC_W = 1920 - LAYOUT.left - LAYOUT.right;
export const STUDIO_LOGIC_H = 1000 - layoutPx.topBar - layoutPx.bottomBar;

export const WALL = 6;
export const DOOR = 24;
export const VISUAL_CORRIDOR_W = 32;
export const MID_CORRIDOR_H = 32;
export const BOTTOM_CORRIDOR_H = 32;
export const KING_H_RATIO = 1.2;
export const V_CORR_H = 14;
/**
 * 中央画布人物占位：与雪碧单格 **32×48** 一致（`sprites/sheets/*.png` 3×4 网格）。
 * 仍用散图的角色若较窄，绘制时用 naturalWidth/Height，点击区可略大于身形。
 */
export const AGENT_W = 32;
export const AGENT_H = 48;

export const C = {
  bg: '#0a0a15',
  wall: '#654321',
  door: '#DAA520',
  floor: '#1e1e35',
  king: '#1a2a4a',
  fixed: '#1a2a4a',
  dynamic: '#1a3a2a',
  border: '#333355',
  text: '#aaa',
  bright: '#fff',
  gold: '#FFD700',
  agent: '#4169E1',
  face: '#FFE4B5',
} as const;

const ROOM_LABELS_ROW2 = ['休息室', '资料室', '会议室', '机房'] as const;
const ROOM_LABELS_ROW3 = ['办公室1', '办公室2', '办公室3', '办公室4'] as const;
const ROOM_LABELS_ROW4 = ['办公室5', '办公室6', '办公室7', '办公室8'] as const;

const ROOM_GRID: Record<string, { row: number; col: number }> = {};
ROOM_LABELS_ROW2.forEach((name, col) => {
  ROOM_GRID[name] = { row: 0, col };
});
ROOM_LABELS_ROW3.forEach((name, col) => {
  ROOM_GRID[name] = { row: 1, col };
});
ROOM_LABELS_ROW4.forEach((name, col) => {
  ROOM_GRID[name] = { row: 2, col };
});

/** 用于移动朝向：row 增大 = 建筑内更靠下（屏幕 y 增大）。 */
export function getRoomGridCell(roomName: string): { row: number; col: number } | null {
  return ROOM_GRID[roomName] ?? null;
}

export type RoomSlot = {
  name: string;
  rowY: number;
  col: number;
  offsetX: number;
};

export function computeBuildingLayout(canvasW: number, canvasH: number) {
  const centerW = canvasW;
  const centerH = canvasH;
  const ROOM_H = Math.floor((centerH - V_CORR_H - BOTTOM_CORRIDOR_H - 2 * MID_CORRIDOR_H - WALL * 5) / (3 + KING_H_RATIO));
  const ROOM_W = Math.floor((centerW - WALL * 5) / 4);
  const BUILDING_W = ROOM_W * 4 + WALL * 5;
  const KING_W = Math.floor(ROOM_W * 1.5);
  const KING_H = Math.floor(ROOM_H * KING_H_RATIO);
  const BUILDING_H = KING_H + V_CORR_H + ROOM_H * 3 + MID_CORRIDOR_H * 2 + BOTTOM_CORRIDOR_H + WALL * 5;
  const buildingOffsetX = (centerW - BUILDING_W) / 2;
  const buildingOffsetY = centerH - BUILDING_H;

  const row2Y = KING_H + WALL + V_CORR_H + WALL;
  const row3Y = row2Y + ROOM_H + MID_CORRIDOR_H + WALL;
  const row4Y = row3Y + ROOM_H + MID_CORRIDOR_H + WALL;

  const roomSlots: Record<string, RoomSlot> = {};
  const addRow = (rowY: number, labels: readonly string[]) => {
    labels.forEach((name, col) => {
      roomSlots[name] = { name, rowY, col, offsetX: 40 };
    });
  };
  addRow(row2Y, ROOM_LABELS_ROW2);
  addRow(row3Y, ROOM_LABELS_ROW3);
  addRow(row4Y, ROOM_LABELS_ROW4);

  return {
    canvasW,
    canvasH,
    ROOM_W,
    ROOM_H,
    BUILDING_W,
    BUILDING_H,
    KING_W,
    KING_H,
    buildingOffsetX,
    buildingOffsetY,
    row2Y,
    row3Y,
    row4Y,
    roomSlots,
  };
}

export type HitRegion =
  | { kind: 'room'; name: string; x: number; y: number; w: number; h: number }
  | { kind: 'agent'; id: string; x: number; y: number; w: number; h: number };

/** 与 office_layer.json 中 objectgroup（class 为 sp）的对象对齐的点击覆盖（脚底像素相对 office 根容器） */
export type OfficeSpawnHit = { agentAttr: string; px: number; py: number };

/** Rooms first, then agents — hitTest iterates reverse so agents take priority over overlapping rooms。 */
export function computeHitRegions(
  canvasW: number,
  canvasH: number,
  agents: Agent[],
  officeHit?: { rootX: number; rootY: number; spawns: OfficeSpawnHit[] } | null,
): HitRegion[] {
  const L = computeBuildingLayout(canvasW, canvasH);
  const { ROOM_W, ROOM_H, buildingOffsetX, buildingOffsetY, roomSlots } = L;
  const roomRegions: HitRegion[] = [];
  for (const pos of Object.values(roomSlots)) {
    const xb = pos.col * (ROOM_W + WALL);
    roomRegions.push({
      kind: 'room',
      name: pos.name,
      x: buildingOffsetX + xb,
      y: buildingOffsetY + pos.rowY,
      w: ROOM_W,
      h: ROOM_H,
    });
  }
  const agentRegions: HitRegion[] = [];
  for (const agent of agents) {
    const pos = roomSlots[agent.location];
    const spawn =
      officeHit?.spawns?.find((s) => {
        const a = s.agentAttr.trim();
        const p = (agent.profile?.trim() ?? '').toLowerCase();
        return p === a.toLowerCase() || agent.id.trim() === a || agent.name.trim() === a;
      }) ?? undefined;

    if (!spawn && !pos) continue;

    let ax: number;
    let ay: number;
    if (spawn && officeHit) {
      ax = officeHit.rootX + spawn.px;
      ay = officeHit.rootY + spawn.py;
    } else if (pos) {
      const roomX = pos.col * (ROOM_W + WALL);
      ax = buildingOffsetX + roomX + pos.offsetX;
      ay = buildingOffsetY + pos.rowY + ROOM_H - 30;
    } else {
      continue;
    }
    agentRegions.push({
      kind: 'agent',
      id: agent.id,
      x: ax - AGENT_W / 2,
      y: ay - AGENT_H,
      w: AGENT_W,
      h: AGENT_H + 20,
    });
  }
  return [...roomRegions, ...agentRegions];
}

export function hitTest(mx: number, my: number, regions: HitRegion[]): HitRegion | null {
  for (let i = regions.length - 1; i >= 0; i--) {
    const r = regions[i];
    if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
  }
  return null;
}

/** 跨机访客：不可作为本机编排入口（与底栏 / 任务重跑一致）。 */
export function isPeerVisitorAgent(agent: Agent): boolean {
  const url = (agent.peer_relay_base_url ?? '').trim();
  const rid = (agent.peer_relay_agent_id ?? '').trim();
  if (url && rid) return true;
  if (agent.bungalow_peer_api != null && Number(agent.bungalow_peer_api) === 1) return true;
  return false;
}
