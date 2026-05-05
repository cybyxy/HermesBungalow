import { useEffect } from 'react';
import { useGameStore } from './store/gameStore';
import { useUiStore } from './store/uiStore';
import * as gameApi from './services/gameApi';
import { CenterStage } from './ui/CenterStage';
import { BottomSheetHost } from './ui/BottomSheetHost';
import { NewTaskModal } from './ui/NewTaskModal';
import { ClarifyModal } from './ui/ClarifyModal';
/** 5 秒真实时间 ≈ 1 游戏分钟 */
const GAME_TICK_MS = 5000;

export function App() {
  const snapshot = useGameStore((s) => s.snapshot);
  const loading = useGameStore((s) => s.loading);
  const error = useGameStore((s) => s.error);
  const gatewayStatus = useGameStore((s) => s.gatewayStatus);
  const loadState = useGameStore((s) => s.loadState);
  const moveAgent = useGameStore((s) => s.moveAgent);
  const connectGateway = useGameStore((s) => s.connectGateway);
  const disconnectGateway = useGameStore((s) => s.disconnectGateway);

  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgent = useUiStore((s) => s.setSelectedAgent);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const openBottomSheet = useUiStore((s) => s.openBottomSheet);

  useEffect(() => {
    void loadState();
    connectGateway();
    return () => disconnectGateway();
  }, [loadState, connectGateway, disconnectGateway]);

  useEffect(() => {
    if (!snapshot) return;
    const id = window.setInterval(() => {
      void gameApi.postGameTick().then(() => loadState()).catch(() => {});
    }, GAME_TICK_MS);
    return () => window.clearInterval(id);
  }, [snapshot, loadState]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: '#0a0a15',
        color: '#eee',
      }}
    >
      {error && (
        <div style={{ color: '#f66', padding: '8px 16px', fontSize: 13 }}>
          {error}（请先启动后端：<code>cd backend && PYTHONPATH=. python3 server.py</code>）
        </div>
      )}

      {loading && !snapshot && !error && (
        <p style={{ color: '#888', padding: 16, fontSize: 14 }}>正在从后端加载游戏状态…</p>
      )}

      {snapshot && (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
          <CenterStage
            snapshot={snapshot}
            selectedAgentId={selectedAgentId}
            gatewayStatus={gatewayStatus}
            loading={loading}
            onSelectAgent={setSelectedAgent}
            onMoveAgent={(id, room) => void moveAgent(id, room)}
            onOpenAgentDetail={(id) => {
              setSelectedAgent(id);
              openBottomSheet({ kind: 'agent', agentId: id });
            }}
            onRefresh={() => void loadState()}
          />
        </div>
      )}
      <BottomSheetHost />
      <NewTaskModal />
      <ClarifyModal />
    </div>
  );
}
