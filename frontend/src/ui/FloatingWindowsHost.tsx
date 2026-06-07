import { useTaskStore } from '../store/taskStore';
import { useUiStore } from '../store/uiStore';
import { AgentDetailPanel } from './AgentDetailPanel';
import { AddAgentPanel } from './AddAgentPanel';
import { ModelFormPanel } from './ModelFormPanel';
import { ChannelConfigPanel } from './ChannelConfigPanel';
import { AddChannelPanel } from './AddChannelPanel';
import { NewTaskPanel } from './NewTaskPanel';
import { FloatingWindow } from './FloatingWindow';

export function FloatingWindowsHost() {
  const floatingWindows = useUiStore((s) => s.floatingWindows);
  const closeFloatingWindow = useUiStore((s) => s.closeFloatingWindow);
  const focusFloatingWindow = useUiStore((s) => s.focusFloatingWindow);
  const updateFloatingWindowPosition = useUiStore((s) => s.updateFloatingWindowPosition);
  const updateFloatingWindowSize = useUiStore((s) => s.updateFloatingWindowSize);
  const snapshot = useTaskStore((s) => s.snapshot);
  const loadState = useTaskStore((s) => s.loadState);

  if (floatingWindows.length === 0) return null;

  return (
    <>
      {floatingWindows.map((w) => {
        let title = '';
        let body: React.ReactNode = null;

        switch (w.kind) {
          case 'agent': {
            const agent = snapshot?.agents.find((a) => a.id === w.agentId);
            title = agent ? `${agent.display_name || agent.name} · 详情` : 'Agent 详情';
            body = (
              <AgentDetailPanel
                key={w.agentId}
                snapshot={snapshot}
                agentId={w.agentId!}
                active
                onProfileUpdated={() => void loadState()}
              />
            );
            break;
          }
          case 'newTask':
            title = '新建任务';
            body = <NewTaskPanel onClose={() => closeFloatingWindow(w.id)} />;
            break;
          case 'addAgent':
            title = '添加 Agent';
            body = (
              <AddAgentPanel
                snapshot={snapshot}
                onCancel={() => closeFloatingWindow(w.id)}
                onCreated={() => { closeFloatingWindow(w.id); void loadState(); }}
              />
            );
            break;
          case 'addModel':
            title = '添加模型';
            body = <ModelFormPanel onClose={() => closeFloatingWindow(w.id)} />;
            break;
          case 'addChannel':
            title = '添加渠道';
            body = <AddChannelPanel onClose={() => closeFloatingWindow(w.id)} />;
            break;
          case 'modelDetail':
            title = '模型详情';
            body = <ModelFormPanel providerId={w.providerId} onClose={() => closeFloatingWindow(w.id)} />;
            break;
          case 'channelConfig':
            title = '渠道配置';
            body = <ChannelConfigPanel channelId={w.channelId || ''} onClose={() => closeFloatingWindow(w.id)} />;
            break;
        }

        return (
          <FloatingWindow
            key={w.id}
            id={w.id}
            title={title}
            x={w.x}
            y={w.y}
            width={w.width}
            height={w.height}
            zIndex={w.zIndex}
            onClose={() => closeFloatingWindow(w.id)}
            onFocus={() => focusFloatingWindow(w.id)}
            onMove={(x, y) => updateFloatingWindowPosition(w.id, x, y)}
            onResize={(width, height) => updateFloatingWindowSize(w.id, width, height)}
          >
            {body}
          </FloatingWindow>
        );
      })}
    </>
  );
}
