import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { MAIN_MENUS } from './menuConfig';
import { MenuPanel } from './MenuPanel';
import { AgentListPanel } from './AgentListPanel';
import { TaskListPanel } from './TaskListPanel';
import { ModelListPanel } from './ModelListPanel';
import { ChannelListPanel } from './ChannelListPanel';
import { PopupSheet } from './PopupSheet';
import { colors } from './theme';

export function DockPanel() {
  const dockedPanel = useUiStore((s) => s.dockedPanel);
  const closeDockedPanel = useUiStore((s) => s.closeDockedPanel);
  const setDockedPanel = useUiStore((s) => s.setDockedPanel);
  const openFloatingWindow = useUiStore((s) => s.openFloatingWindow);
  const setSelectedTask = useUiStore((s) => s.setSelectedTask);
  const gatewayStatus = useTaskStore((s) => s.gatewayStatus);

  if (dockedPanel.kind === 'closed') return null;

  let title = '';
  let body: React.ReactNode = null;

  switch (dockedPanel.kind) {
    case 'agentList':
      title = 'Agent 管理';
      body = <AgentListPanel />;
      break;
    case 'taskList':
      title = '任务管理';
      body = <TaskListPanel />;
      break;
    case 'modelList':
      title = '模型管理';
      body = <ModelListPanel />;
      break;
    case 'channelList':
      title = '渠道管理';
      body = <ChannelListPanel />;
      break;
    case 'skills': {
      const menu = MAIN_MENUS.find((m) => m.key === 'social');
      title = menu?.label ?? '技能';
      body = <p style={{ color: colors.text, fontSize: 13, margin: 0 }}>占位：激励演说、灵感赐予等后续接入。</p>;
      break;
    }
    case 'social': {
      const menu = MAIN_MENUS.find((m) => m.key === 'social');
      title = menu?.label ?? '社交';
      body = menu ? <MenuPanel menu={menu} onItemClick={(menuKey, itemId) => {
        if (itemId === 'showEventLog') setDockedPanel({ kind: 'event' });
        else if (itemId === 'showAgentList') setDockedPanel({ kind: 'agentList' });
        else alert(`占位: ${menuKey} / ${itemId}`);
      }} /> : null;
      break;
    }
    case 'event': {
      const menu = MAIN_MENUS.find((m) => m.key === 'event');
      title = menu?.label ?? '事件';
      body = menu ? <MenuPanel menu={menu} onItemClick={(menuKey, itemId) => {
        alert(`占位: ${menuKey} / ${itemId}`);
      }} /> : null;
      break;
    }
    case 'help': {
      const menu = MAIN_MENUS.find((m) => m.key === 'help');
      title = menu?.label ?? '帮助';
      body = menu ? <MenuPanel menu={menu} onItemClick={(menuKey, itemId) => {
        if (itemId === 'showAbout') alert('Hermes 数字工作室 — 原型对齐版');
        else if (itemId === 'showDevGateway') alert(`Gateway: ${gatewayStatus}`);
        else alert(`占位: ${menuKey} / ${itemId}`);
      }} /> : null;
      break;
    }
  }

  return (
    <PopupSheet
      open
      title={title}
      onClose={closeDockedPanel}
      zIndex={500}
      variant="bottom-sheet"
      nonBlocking
      dismissible={false}
    >
      {body}
    </PopupSheet>
  );
}
