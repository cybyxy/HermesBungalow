import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useGameStore } from '../store/gameStore';
import { useUiStore } from '../store/uiStore';
import { AddAgentPanel } from './AddAgentPanel';
import { AgentDetailPanel } from './AgentDetailPanel';
import { MAIN_MENUS } from './menuConfig';
import { MenuPanel } from './MenuPanel';
import { PopupSheet } from './PopupSheet';
import { colors, layoutPx } from './theme';

export function BottomSheetHost() {
  const bottomSheet = useUiStore((s) => s.bottomSheet);
  const closeBottomSheet = useUiStore((s) => s.closeBottomSheet);
  const openNewTaskModal = useUiStore((s) => s.openNewTaskModal);
  const openBottomSheet = useUiStore((s) => s.openBottomSheet);
  const snapshot = useGameStore((s) => s.snapshot);
  const loadState = useGameStore((s) => s.loadState);
  const gatewayStatus = useGameStore((s) => s.gatewayStatus);
  const studioLeftPanelCollapsed = useUiStore((s) => s.studioLeftPanelCollapsed);
  const toggleStudioLeftPanelCollapsed = useUiStore((s) => s.toggleStudioLeftPanelCollapsed);

  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onMenuItemClick = useCallback(
    (menuKey: string, itemId: string) => {
      if (itemId === 'showNewTask') openNewTaskModal();
      else if (itemId === 'showAddAgent') openBottomSheet({ kind: 'addAgent' });
      else if (itemId === 'showAbout') window.alert('Hermes 数字工作室 — 原型对齐版');
      else if (itemId === 'showDevGateway') setToast(`Gateway: ${gatewayStatus}`);
      else if (itemId === 'showEventLog') setToast('事件日志在右侧面板');
      else if (itemId === 'showAgentList') setToast('请在左侧栏查看 Agent 列表');
      else if (itemId === 'showTaskList') {
        if (studioLeftPanelCollapsed) toggleStudioLeftPanelCollapsed();
        setToast('工作室任务已在左侧展开');
      } else window.alert(`占位: ${menuKey} / ${itemId}`);
    },
    [gatewayStatus, openBottomSheet, openNewTaskModal, studioLeftPanelCollapsed, toggleStudioLeftPanelCollapsed],
  );

  const open = bottomSheet.kind !== 'closed';

  let title = '';
  let body: ReactNode = null;

  if (bottomSheet.kind === 'menu') {
    const menu = MAIN_MENUS.find((m) => m.key === bottomSheet.menuKey);
    title = menu?.label ?? '菜单';
    body = menu ? <MenuPanel menu={menu} onItemClick={onMenuItemClick} /> : <div style={{ color: '#888', fontSize: 12 }}>未知菜单</div>;
  } else if (bottomSheet.kind === 'agent') {
    const agent = snapshot?.agents.find((a) => a.id === bottomSheet.agentId);
    title = agent ? `${agent.name} · 详情` : 'Agent 详情';
    body = (
      <AgentDetailPanel
        key={bottomSheet.agentId}
        snapshot={snapshot}
        agentId={bottomSheet.agentId}
        active
        onProfileUpdated={() => void loadState()}
      />
    );
  } else if (bottomSheet.kind === 'addAgent') {
    title = '添加 Agent';
    body = (
      <AddAgentPanel
        snapshot={snapshot}
        onCancel={closeBottomSheet}
        onCreated={() => void loadState()}
      />
    );
  } else if (bottomSheet.kind === 'skills') {
    title = '城主技能';
    body = <p style={{ color: colors.text, fontSize: 13, margin: 0 }}>占位：激励演说、灵感赐予等后续接入。</p>;
  }

  return (
    <>
      <PopupSheet
        open={open}
        title={title}
        onClose={closeBottomSheet}
        zIndex={1100}
        variant="bottom-sheet"
        nonBlocking
        dismissible={false}
      >
        {body}
      </PopupSheet>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: layoutPx.bottomBar + 12,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(26,26,48,0.95)',
            border: `1px solid ${colors.gold}`,
            color: colors.bright,
            padding: '8px 16px',
            borderRadius: 8,
            zIndex: 1210,
            fontSize: 12,
            maxWidth: '80vw',
          }}
        >
          {toast}
        </div>
      )}
    </>
  );
}
