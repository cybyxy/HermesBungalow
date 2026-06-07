import { useEffect, useMemo, useState } from 'react';
import type { TaskWorldSnapshot } from '../types/game';
import { useTaskStore } from '../store/taskStore';
import { colors, studioGlass } from './theme';
import { AgentProfileSidebar } from './AgentProfileSidebar';
import { AgentBasicTab } from './AgentBasicTab';
import { AgentConfigTab } from './AgentConfigTab';
import { SkillsEditor } from './SkillsEditor';
import { AgentTaskTab } from './AgentTaskTab';

type DetailTab = 'basic' | 'config' | 'skill' | 'task' | 'achieve';

export function AgentDetailPanel(props: {
  snapshot: TaskWorldSnapshot | null;
  agentId: string | null;
  /** 当前是否在底部弹层中展示（用于拉取 profile 等副作用） */
  active: boolean;
  onProfileUpdated?: () => void;
}) {
  const { snapshot, agentId, active, onProfileUpdated } = props;
  const [tab, setTab] = useState<DetailTab>('basic');
  const [editName, setEditName] = useState<string | null>(null);
  const [editProf, setEditProf] = useState<string | null>(null);

  // 全局模型列表（App 启动时加载一次）
  const modelOptions = useTaskStore((s) => s.configuredModels);
  const loadConfiguredModels = useTaskStore((s) => s.loadConfiguredModels);
  const channelOptions = useTaskStore((s) => s.configuredChannels);
  const loadConfiguredChannels = useTaskStore((s) => s.loadConfiguredChannels);

  const agent = useMemo(
    () => snapshot?.agents.find((a) => a.id === agentId) ?? null,
    [snapshot, agentId],
  );
  const tasks = useMemo(
    () => (snapshot?.tasks ?? []).filter((t) => t.assignee_id === agent?.id),
    [snapshot, agent?.id],
  );

  // 确保模型列表已加载（App 启动时异步加载，此处兜底）
  useEffect(() => {
    void loadConfiguredModels();
  }, [loadConfiguredModels]);

  useEffect(() => {
    void loadConfiguredChannels();
  }, [loadConfiguredChannels]);

  useEffect(() => {
    setEditName(agent?.display_name || agent?.name || '');
    setEditProf(agent?.profession ?? '');
  }, [agent?.id, agent?.display_name, agent?.name, agent?.profession]);

  if (!agent) {
    return <div style={{ color: '#888', fontSize: 12, padding: 8 }}>未找到该 Agent。</div>;
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 200px) minmax(0, 1fr)', gap: 12, height: '100%', overflow: 'hidden' }}>
      <AgentProfileSidebar
        agent={agent}
        modelOptions={modelOptions}
        channelOptions={channelOptions}
        editName={editName}
        setEditName={setEditName}
        editProf={editProf}
        setEditProf={setEditProf}
        onProfileUpdated={onProfileUpdated}
      />

      <div
        style={{
          ...studioGlass.muted,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
          border: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ display: 'flex', borderBottom: `1px solid ${colors.border}`, overflowX: 'auto' }}>
          {(
            [
              ['basic', '📋 基本'],
              ['config', '⚙️ 配置'],
              ['skill', '⭐ 技能'],
              ['task', '📋 任务'],
              ['achieve', '🏆 成就'],
            ] as const
          ).map(([k, label]) => {
            const act = tab === k;
            return (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k as DetailTab)}
                style={{
                  padding: '8px 8px',
                  border: 'none',
                  background: act ? studioGlass.tabActive.background : 'transparent',
                  color: act ? colors.gold : '#888',
                  borderBottom: act ? `2px solid ${colors.gold}` : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 10,
                  fontFamily: 'inherit',
                  whiteSpace: 'nowrap',
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div className="rb-scroll" style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
          {tab === 'basic' && <AgentBasicTab agent={agent} />}
          {tab === 'config' && <AgentConfigTab agent={agent} onProfileUpdated={onProfileUpdated} />}
          {tab === 'skill' && <SkillsEditor agent={agent} onUpdated={() => onProfileUpdated?.()} />}
          {tab === 'task' && <AgentTaskTab tasks={tasks} />}
          {tab === 'achieve' && <div style={{ color: '#888', fontSize: 11 }}>成就面板占位（后续接成就系统）。</div>}
        </div>
      </div>
    </div>
  );
}
