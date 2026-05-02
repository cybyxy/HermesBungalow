import { useEffect, useRef } from 'react';
import type { Agent, GameWorldSnapshot } from '../types/game';
import type { AgentInferenceState } from '../store/uiStore';
import { useUiStore } from '../store/uiStore';
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
} from './buildingLayout';

export function CenterStage(props: {
  snapshot: GameWorldSnapshot;
  selectedAgentId: string | null;
  centerInference: Record<string, AgentInferenceState>;
  onSelectAgent: (id: string) => void;
  onMoveAgent: (agentId: string, roomName: string) => void;
}) {
  const { snapshot, selectedAgentId, centerInference, onSelectAgent, onMoveAgent } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 预加载所有 Agent 头像图片
  const avatarImagesRef = useRef<Record<string, HTMLImageElement>>({});
  useEffect(() => {
    snapshot.agents.forEach((agent: Agent) => {
      if (avatarImagesRef.current[agent.id]) return;
      const img = new Image();
      img.src = `/assets/avatars/avatar128_${agent.display_name || agent.name}.png`;
      img.onload = () => {
        avatarImagesRef.current[agent.id] = img;
      };
    });
  }, [snapshot.agents]);

  // 自动清理已过期的 done 状态（多 Agent 并行支持）
  useEffect(() => {
    const checkAndClear = () => {
      const states = centerInference;
      const now = Date.now();
      Object.entries(states).forEach(([agentId, ci]) => {
        if (ci.phase === 'done' && now >= ci.doneExpiresAt) {
          useUiStore.getState().clearCenterAgentInference(agentId);
        }
      });
    };
    const interval = window.setInterval(checkAndClear, 1000);
    return () => window.clearInterval(interval);
  }, [centerInference]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const draw = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, w, h);

      const L = computeBuildingLayout(w, h);
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
        roomSlots,
      } = L;

      ctx.save();
      ctx.translate(buildingOffsetX, buildingOffsetY);

      const rect = (x: number, y: number, rw: number, rh: number, color: string) => {
        ctx.fillStyle = color;
        ctx.fillRect(x, y, rw, rh);
      };
      const stroke = (x: number, y: number, rw: number, rh: number, line: string, lw = 1) => {
        ctx.strokeStyle = line;
        ctx.lineWidth = lw;
        ctx.strokeRect(x, y, rw, rh);
      };
      const text = (s: string, x: number, y: number, color: string, size: number, align: CanvasTextAlign = 'left') => {
        ctx.fillStyle = color;
        ctx.font = `${size}px Consolas, "Microsoft YaHei", monospace`;
        ctx.textAlign = align;
        ctx.fillText(s, x, y);
        ctx.textAlign = 'left';
      };

      const corridorCenterX = ROOM_W * 2 + WALL * 2 + WALL / 2;
      const corridorX = corridorCenterX - VISUAL_CORRIDOR_W / 2;
      const doorX = corridorCenterX - DOOR / 2;

      const kingX = (BUILDING_W - KING_W) / 2;
      rect(kingX, 0, KING_W, KING_H, C.king);
      stroke(kingX, 0, KING_W, KING_H, '#4169E1', 3);
      text('城主办公室', kingX + KING_W / 2, KING_H / 2 + 4, '#fff', 12, 'center');
      rect(doorX, KING_H, DOOR, WALL, C.door);
      rect(doorX, KING_H + WALL, DOOR, V_CORR_H, C.floor);

      const drawRow = (offsetX: number, y: number, labels: string[], fixed: boolean[]) => {
        for (let i = 0; i < 4; i++) {
          const x = offsetX + i * (ROOM_W + WALL);
          const color = fixed[i] ? C.fixed : C.dynamic;
          const borderColor = fixed[i] ? '#4169E1' : '#228B22';
          rect(x, y, ROOM_W, ROOM_H, color);
          stroke(x, y, ROOM_W, ROOM_H, borderColor, 2);
          text(labels[i], x + ROOM_W / 2, y + ROOM_H / 2, '#fff', 9, 'center');
          const ddx = i === 0 || i === 2 ? x + (ROOM_W * 3) / 4 - DOOR / 2 : x + ROOM_W / 4 - DOOR / 2;
          rect(ddx, y + ROOM_H - WALL, DOOR, WALL, C.door);
        }
      };

      drawRow(0, row2Y, ['休息室', '资料室', '会议室', '机房'], [true, true, true, true]);
      rect(corridorX, row2Y, VISUAL_CORRIDOR_W, ROOM_H, C.floor);
      rect(0, row2Y + ROOM_H, corridorX + VISUAL_CORRIDOR_W, MID_CORRIDOR_H, C.floor);
      rect(corridorX + VISUAL_CORRIDOR_W, row2Y + ROOM_H, BUILDING_W - (corridorX + VISUAL_CORRIDOR_W), MID_CORRIDOR_H, C.floor);

      drawRow(0, row3Y, ['办公室1', '办公室2', '办公室3', '办公室4'], [false, false, false, false]);
      rect(corridorX, row3Y, VISUAL_CORRIDOR_W, ROOM_H, C.floor);
      rect(0, row3Y + ROOM_H, corridorX + VISUAL_CORRIDOR_W, MID_CORRIDOR_H, C.floor);
      rect(corridorX + VISUAL_CORRIDOR_W, row3Y + ROOM_H, BUILDING_W - (corridorX + VISUAL_CORRIDOR_W), MID_CORRIDOR_H, C.floor);

      drawRow(0, row4Y, ['办公室5', '办公室6', '办公室7', '办公室8'], [false, false, false, false]);
      rect(corridorX, row4Y, VISUAL_CORRIDOR_W, ROOM_H, C.floor);
      rect(0, row4Y + ROOM_H, corridorX + VISUAL_CORRIDOR_W, BOTTOM_CORRIDOR_H, C.floor);
      rect(corridorX + VISUAL_CORRIDOR_W, row4Y + ROOM_H, BUILDING_W - (corridorX + VISUAL_CORRIDOR_W), BOTTOM_CORRIDOR_H, C.floor);

      const buildingEndY = row4Y + ROOM_H + BOTTOM_CORRIDOR_H + WALL;
      rect(-8, 0, 8, buildingEndY + 8, C.wall);
      rect(BUILDING_W, 0, 8, buildingEndY + 8, C.wall);

      const inferMood = (agentId: string): 'thinking' | 'done' | 'normal' => {
        const ci = centerInference[agentId];
        if (!ci) return 'normal';
        if (ci.phase === 'thinking') return 'thinking';
        if (ci.phase === 'done' && Date.now() < ci.doneExpiresAt) return 'done';
        return 'normal';
      };

      snapshot.agents.forEach((agent: Agent) => {
        const pos = roomSlots[agent.location];
        if (!pos) return;
        const roomX = pos.col * (ROOM_W + WALL);
        const ax = roomX + pos.offsetX;
        const ay = pos.rowY + ROOM_H - 30;
        const isSelected = agent.id === selectedAgentId;
        const mood = inferMood(agent.id);

        const avatarImg = avatarImagesRef.current[agent.id];
        if (avatarImg && avatarImg.complete) {
          const imgSize = Math.min(AGENT_W, AGENT_H);
          ctx.drawImage(
            avatarImg,
            ax - imgSize / 2,
            ay - imgSize,
            imgSize,
            imgSize
          );
        } else {
          ctx.fillStyle = isSelected ? '#5a7a9a' : C.agent;
          ctx.fillRect(ax - AGENT_W / 2, ay - AGENT_H, AGENT_W, AGENT_H);
        }
        ctx.strokeStyle = isSelected ? C.gold : '#aaa';
        ctx.lineWidth = isSelected ? 2 : 1;
        ctx.strokeRect(ax - AGENT_W / 2, ay - AGENT_H, AGENT_W, AGENT_H);
        ctx.fillStyle = C.face;
        ctx.fillRect(ax - AGENT_W / 2 + 3, ay - AGENT_H + 6, AGENT_W - 6, 10);
        if (mood === 'thinking') {
          ctx.font = '14px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('🤔', ax, ay - AGENT_H + 14);
          ctx.textAlign = 'left';
        }
        ctx.fillStyle = C.gold;
        ctx.font = `8px Consolas, "Microsoft YaHei", monospace`;
        ctx.textAlign = 'center';
        if (mood === 'done') {
          const snip = centerInference[agent.id]?.doneSnippet || '推理已完成';
          ctx.font = '9px Consolas, "Microsoft YaHei", monospace';
          const tw = ctx.measureText(snip).width;
          const pad = 4;
          const bx = ax - tw / 2 - pad;
          const by = ay - AGENT_H - 18;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(bx, by, tw + pad * 2, 14);
          ctx.fillStyle = C.gold;
          ctx.fillText(snip, ax, by + 11);
        } else if (mood !== 'thinking') {
          ctx.fillText('↓', ax, ay - AGENT_H - 4);
        }
        ctx.fillStyle = isSelected ? C.gold : '#fff';
        ctx.font = `8px Consolas, "Microsoft YaHei", monospace`;
        ctx.fillText(agent.name, ax, ay + 8);
        const statusIcon = { working: '💻', idle: '🟡', resting: '😴' }[agent.status] ?? '⬜';
        ctx.font = '10px Arial';
        ctx.fillText(statusIcon, ax + AGENT_W / 2 + 8, ay - AGENT_H + 12);
        ctx.textAlign = 'left';
      });

      ctx.restore();

      text('中央活动区 · 点击 Agent 选中，选中后点击房间移动', 12, 18, '#666', 11);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [snapshot, selectedAgentId, centerInference]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const handler = (e: MouseEvent) => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight;
      const rect = canvas.getBoundingClientRect();
      const mx = ((e.clientX - rect.left) / rect.width) * w;
      const my = ((e.clientY - rect.top) / rect.height) * h;
      const regions = computeHitRegions(w, h, snapshot.agents);
      const hit = hitTest(mx, my, regions);
      if (hit?.kind === 'agent') onSelectAgent(hit.id);
      else if (hit?.kind === 'room' && selectedAgentId) void onMoveAgent(selectedAgentId, hit.name);
    };
    canvas.addEventListener('click', handler);
    return () => canvas.removeEventListener('click', handler);
  }, [snapshot.agents, selectedAgentId, onSelectAgent, onMoveAgent]);

  return (
    <div
      ref={wrapRef}
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        position: 'relative',
        background: C.bg,
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%', cursor: 'pointer' }} />
    </div>
  );
}
