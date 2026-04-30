import { useGameState } from '../store/gameState';

function statusText(status: string) {
  if (status === 'working') return '工作中';
  if (status === 'slacking') return '怠工';
  if (status === 'social') return '社交';
  if (status === 'offline') return '离线';
  return '待机';
}

export function ModelUsagePanel() {
  const agents = useGameState((s) => s.agents);
  return (
    <aside className="left-panel panel">
      <div className="panel-title">模型与需求面板</div>
      {agents.map((agent) => (
        <div key={agent.id} className="agent-row">
          <strong>{agent.name}</strong>
          <span>{agent.role}</span>
          <span>{statusText(agent.status)}</span>
          <span>饱食 {agent.energy.toFixed(0)}</span>
          <span>配额 {agent.quota.toFixed(0)}</span>
          <span>社交 {agent.socialNeed.toFixed(0)}</span>
          <span>匹配 {agent.roleMatch.toFixed(0)}%</span>
        </div>
      ))}
    </aside>
  );
}
