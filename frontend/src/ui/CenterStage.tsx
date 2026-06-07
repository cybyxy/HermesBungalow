/**
 * 卡片式 UI 中央舞台：任务管理（左）+ 办公室房间网格（中）+ 推理面板（右）。
 * 房间是纯视觉容器，agent 卡片可在房间间移动（前端状态管理，无模拟逻辑）。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Agent, TaskWorldSnapshot } from '../types/game';
import { useUiStore } from '../store/uiStore';
import { agentChatOrchestrated } from '../services/gameApi';
import { LeftStudioPanel } from './TaskMonitorPanel';
import { OfficeRoomCard } from './OfficeRoomCard';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import { BottomBar } from './BottomBar';
import { colors } from './theme';
import { buildRoomList, defaultRoomForProfession } from './officeLayout';

const ROOM_NAMES_KEY = 'hermes-bungalow-room-names';

function loadRoomNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(ROOM_NAMES_KEY);
    return raw ? JSON.parse(raw) as Record<string, string> : {};
  } catch {
    return {};
  }
}

export function CenterStage(props: {
  snapshot: TaskWorldSnapshot;
  selectedAgentId: string | null;
  gatewayStatus: string;
  loading: boolean;
  onSelectAgent: (id: string) => void;
  onOpenAgentDetail: (id: string) => void;
  onRefresh: () => void;
}) {
  const {
    snapshot,
    selectedAgentId,
    gatewayStatus,
    loading,
    onSelectAgent,
    onOpenAgentDetail,
    onRefresh,
  } = props;

  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);
  const appendInference = useUiStore((s) => s.appendInference);

  // agent -> 房间 分配（纯前端状态）
  const [agentRoom, setAgentRoom] = useState<Record<string, string>>({});

  // 房间自定义名称（localStorage 持久化）
  const [roomNames, setRoomNames] = useState<Record<string, string>>(loadRoomNames);

  const renameRoom = useCallback((roomId: string, name: string) => {
    setRoomNames((prev) => {
      const next = { ...prev, [roomId]: name };
      try { localStorage.setItem(ROOM_NAMES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  /** 新 agent 加入时自动按职业分配默认房间 */
  const agents = snapshot.agents ?? [];

  /** 动态房间列表：4 固定 + max(0, agentCount-1) 动态房间 */
  const rooms = useMemo(() => buildRoomList(agents.length), [agents.length]);
  const roomAssignments = useMemo(() => {
    const map: Record<string, string> = { ...agentRoom };
    let updated = false;
    for (const a of agents) {
      if (!map[a.id]) {
        map[a.id] = defaultRoomForProfession(a.profession || '');
        updated = true;
      }
    }
    if (updated) {
      // 异步更新避免 setState during render
      queueMicrotask(() => setAgentRoom(map));
    }
    return map;
  }, [agents, agentRoom]);

  /** 按房间分组 agent */
  const roomGroups = useMemo(() => {
    const grouped = new Map<string, Agent[]>();
    for (const r of rooms) grouped.set(r.id, []);
    for (const a of agents) {
      const roomId = roomAssignments[a.id] || 'lobby';
      const list = grouped.get(roomId);
      if (list) list.push(a);
      else (grouped.get('lobby') ?? grouped.set('lobby', []).get('lobby'))!.push(a);
    }
    return rooms.map((room) => ({
      ...room,
      agents: grouped.get(room.id) ?? [],
    }));
  }, [agents, roomAssignments, rooms]);

  const moveAgentToRoom = (agentId: string, roomId: string) => {
    setAgentRoom((prev) => ({ ...prev, [agentId]: roomId }));
  };

  // 空闲 agent 串门 + 同房间自主交流
  const roomAssignmentsRef = useRef(roomAssignments);
  roomAssignmentsRef.current = roomAssignments;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const chatCooldowns = useRef<Map<string, number>>(new Map());

  const roomsRef = useRef(rooms);
  roomsRef.current = rooms;

  /** 从 room id 找房间显示名称 */
  const roomLabel = useCallback((roomId: string) => {
    return roomsRef.current.find((r) => r.id === roomId)?.name ?? roomId;
  }, []);

  const triggerSocialChat = useCallback(
    async (speaker: Agent, listener: Agent, roomId: string) => {
      const pairKey = [speaker.id, listener.id].sort().join('::');
      const now = Date.now();
      const last = chatCooldowns.current.get(pairKey) ?? 0;
      if (now - last < 45000) return; // 45s 冷却，避免刷屏
      chatCooldowns.current.set(pairKey, now);

      const speakerName = speaker.display_name || speaker.name;
      const listenerName = listener.display_name || listener.name;
      const rname = roomLabel(roomId);
      const greeting = `${speakerName}（${speaker.profession || '同事'}）在${rname}碰到${listenerName}，主动聊了起来。随便聊聊吧～`;

      try {
        const res = await agentChatOrchestrated({
          agent_id: speaker.id,
          message: `@${listenerName} | ${greeting}`,
        });
        if (!res?.ok) {
          appendInference({
            variant: 'error',
            agentId: listener.id,
            headline: `${speakerName} → ${listenerName}   ${rname}`,
            body: '对方暂时无法回应',
          });
          return;
        }
        const delegation = res.delegations?.[0];
        const reply = delegation?.reply || '';
        appendInference({
          variant: reply ? 'reply' : 'status',
          agentId: listener.id,
          headline: `${speakerName} → ${listenerName}   ${rname}`,
          body: reply || '(对方没有说话)',
        });
      } catch {
        appendInference({
          variant: 'error',
          agentId: listener.id,
          headline: '闲聊失败',
          body: `${speakerName} → ${listenerName} 连接异常`,
        });
      }
    },
    [appendInference, roomLabel],
  );

  useEffect(() => {
    let pending = false;
    const tick = () => {
      if (pending) return; // 上一个 API 调用还没回来则跳过
      const curAgents = agentsRef.current;
      const curRooms = roomAssignmentsRef.current;
      const idle = curAgents.filter((a) => !a.current_task_id);
      if (idle.length === 0) return;
      const agent = idle[Math.floor(Math.random() * idle.length)];
      const currentRoom = curRooms[agent.id] || 'lobby';
      const isLord = agent.name === 'default'; // 崽崽（城主）可自由进出经理室
      const otherRooms = roomsRef.current.map((r) => r.id).filter((id) => {
        if (id === currentRoom) return false;
        if (id === 'manager' && !isLord) return false; // 非城主不能随意进经理室
        return true;
      });
      if (otherRooms.length === 0) return;
      const nextRoom = otherRooms[Math.floor(Math.random() * otherRooms.length)];

      setAgentRoom((prev) => ({ ...prev, [agent.id]: nextRoom }));

      // 检查目标房间是否有其他空闲 agent，有则触发自主交流
      const mates = idle.filter((a) => {
        if (a.id === agent.id) return false;
        const r = curRooms[a.id] || 'lobby';
        return r === nextRoom;
      });
      if (mates.length > 0) {
        const mate = mates[Math.floor(Math.random() * mates.length)];
        pending = true;
        triggerSocialChat(agent, mate, nextRoom).finally(() => { pending = false; });
      }
    };

    const id = setInterval(tick, 180000 + Math.random() * 120000);
    return () => clearInterval(id);
  }, [triggerSocialChat]);

  const handleChatAgent = (agentId: string) => {
    onSelectAgent(agentId);
    openFloatingWindow({ kind: 'agent', agentId });
  };

  const handleDetailAgent = (agentId: string) => {
    onSelectAgent(agentId);
    openFloatingWindow({ kind: 'agent', agentId });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, minWidth: 0 }}>
      <TopBar
        snapshot={snapshot}
        gatewayStatus={gatewayStatus}
        loading={loading}
        onRefresh={onRefresh}
        selectedAgentId={selectedAgentId}
        onOpenAgentDetail={onOpenAgentDetail}
      />
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 左侧：任务管理面板 */}
        <div style={{ position: 'relative', flexShrink: 0, height: '100%' }}>
          <LeftStudioPanel snapshot={snapshot} />
        </div>

        {/* 中央：办公室房间网格 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 14,
            display: 'flex',
            flexWrap: 'wrap',
            alignContent: 'flex-start',
            gap: 14,
            background: `
              linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px),
              #0d0d1a
            `,
            backgroundSize: '40px 40px',
          }}
        >
          {roomGroups.map((room) => (
            <OfficeRoomCard
              key={room.id}
              room={{ ...room, name: roomNames[room.id] || room.name }}
              allRooms={rooms}
              selectedAgentId={selectedAgentId}
              onSelectAgent={onSelectAgent}
              onChatAgent={handleChatAgent}
              onDetailAgent={handleDetailAgent}
              onMoveAgent={moveAgentToRoom}
              onRenameRoom={renameRoom}
            />
          ))}
        </div>

        {/* 右侧：推理面板 */}
        <div
          style={{
            width: 380,
            flexShrink: 0,
            borderLeft: `1px solid ${colors.border}`,
            overflowY: 'auto',
            background: '#0a0a15',
          }}
        >
          <RightPanel snapshot={snapshot} />
        </div>
      </div>

      {/* 底部：聊天输入栏 */}
      <BottomBar snapshot={snapshot} gatewayStatus={gatewayStatus} />
    </div>
  );
}
