import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import * as gameApi from '../services/gameApi';
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
  const openBottomSheet = useUiStore((s) => s.openBottomSheet);
  const snapshot = useGameStore((s) => s.snapshot);
  const loadState = useGameStore((s) => s.loadState);
  const gatewayStatus = useGameStore((s) => s.gatewayStatus);

  const [newTaskName, setNewTaskName] = useState('新任务');
  const [newTaskProf, setNewTaskProf] = useState('程序员');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const onMenuItemClick = useCallback(
    (menuKey: string, itemId: string) => {
      if (itemId === 'showNewTask') openBottomSheet({ kind: 'newTask' });
      else if (itemId === 'showAddAgent') openBottomSheet({ kind: 'addAgent' });
      else if (itemId === 'showAbout') window.alert('Hermes 数字工作室 — 原型对齐版');
      else if (itemId === 'showDevGateway') setToast(`Gateway: ${gatewayStatus}`);
      else if (itemId === 'showEventLog') setToast('事件日志在右侧面板');
      else if (itemId === 'showAgentList' || itemId === 'showTaskList') setToast('请在左/右栏查看列表');
      else window.alert(`占位: ${menuKey} / ${itemId}`);
    },
    [gatewayStatus, openBottomSheet],
  );

  const onCreateTask = async () => {
    try {
      await gameApi.postCreateTask({
        name: newTaskName.trim() || '新任务',
        required_profession: newTaskProf,
        difficulty: 2,
        reward: 100,
      });
      closeBottomSheet();
      void loadState();
    } catch (e) {
      setToast((e as Error).message);
    }
  };

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
  } else if (bottomSheet.kind === 'newTask') {
    title = '新建任务';
    body = (
      <div>
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>名称</label>
        <input
          value={newTaskName}
          onChange={(e) => setNewTaskName(e.target.value)}
          style={{
            width: '100%',
            marginBottom: 12,
            padding: 8,
            background: '#0a0a15',
            color: '#fff',
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            boxSizing: 'border-box',
          }}
        />
        <label style={{ display: 'block', color: colors.text, fontSize: 12, marginBottom: 6 }}>职业要求</label>
        <select
          value={newTaskProf}
          onChange={(e) => setNewTaskProf(e.target.value)}
          style={{
            width: '100%',
            marginBottom: 16,
            padding: 8,
            background: '#0a0a15',
            color: '#fff',
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            boxSizing: 'border-box',
          }}
        >
          {['程序员', '设计师', '测试员', '分析师'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void onCreateTask()}>
          创建
        </button>
      </div>
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
