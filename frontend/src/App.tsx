import { useEffect } from 'react';
import { useTaskStore } from './store/taskStore';
import { useUiStore } from './store/uiStore';
import { CenterStage } from './ui/CenterStage';
import { ClarifyModal } from './ui/ClarifyModal';
import { DockPanel } from './ui/DockPanel';
import { FloatingWindowsHost } from './ui/FloatingWindowsHost';

export function App() {
  const snapshot = useTaskStore((s) => s.snapshot);
  const loading = useTaskStore((s) => s.loading);
  const error = useTaskStore((s) => s.error);
  const gatewayStatus = useTaskStore((s) => s.gatewayStatus);
  const loadState = useTaskStore((s) => s.loadState);
  const loadConfiguredModels = useTaskStore((s) => s.loadConfiguredModels);
  const loadConfiguredChannels = useTaskStore((s) => s.loadConfiguredChannels);
  const connectGateway = useTaskStore((s) => s.connectGateway);
  const disconnectGateway = useTaskStore((s) => s.disconnectGateway);

  const selectedAgentId = useUiStore((s) => s.selectedAgentId);
  const setSelectedAgent = useUiStore((s) => s.setSelectedAgent);
  const clearSelection = useUiStore((s) => s.clearSelection);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);

  useEffect(() => {
    void loadState();
    void loadConfiguredModels();
    void loadConfiguredChannels();
    connectGateway();
    return () => disconnectGateway();
  }, [loadState, loadConfiguredModels, loadConfiguredChannels, connectGateway, disconnectGateway]);

  // 初始自动选择城主 agent
  useEffect(() => {
    if (!snapshot || selectedAgentId) return;
    const lord = snapshot.agents.find(
      (a) => (a.profile ?? '') === 'default' || (a.profession ?? '') === '城主',
    );
    if (lord) setSelectedAgent(lord.id);
  }, [snapshot, selectedAgentId, setSelectedAgent]);

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
      <style>{`
        *::-webkit-scrollbar { width: 5px; height: 5px; }
        *::-webkit-scrollbar-track { background: transparent; }
        *::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 10px; }
        *::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.18); }
        * { scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.08) transparent; }
      `}</style>
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
            onOpenAgentDetail={(id) => {
              setSelectedAgent(id);
              openFloatingWindow({ kind: 'agent', agentId: id });
            }}
            onRefresh={() => void loadState()}
          />
        </div>
      )}
      <DockPanel />
      <FloatingWindowsHost />
      <ClarifyModal />
    </div>
  );
}
