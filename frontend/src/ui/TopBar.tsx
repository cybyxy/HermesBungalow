import { useGameState } from '../store/gameState';

export function TopBar() {
  const agents = useGameState((s) => s.agents);
  const cityLordPoints = useGameState((s) => s.cityLordPoints);
  const cityLordLevel = useGameState((s) => s.cityLordLevel);
  const weekCompleted = useGameState((s) => s.weekCompleted);
  const weekTarget = useGameState((s) => s.weekTarget);

  return (
    <header className="top-bar panel">
      <div className="title">崽崽数字小屋</div>
      <div className="avatar-strip">
        {agents.map((agent) => (
          <span key={agent.id} className={`avatar-chip ${agent.role === '城主' ? 'main' : ''}`}>
            {agent.role === '城主' ? '⭐' : '•'} {agent.name}
          </span>
        ))}
      </div>
      <div>积分 {cityLordPoints}</div>
      <div>城主 Lv.{cityLordLevel}</div>
      <div>周目标 {weekCompleted}/{weekTarget}</div>
    </header>
  );
}
