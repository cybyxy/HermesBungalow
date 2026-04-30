import { useGameState } from '../store/gameState';

const CAREERS = ['设计', '开发', '测试', '分析', '协作'];

function getRatio(role: string, career: string): string {
  const table: Record<string, Record<string, number>> = {
    设计师: { 设计: 92, 开发: 36, 测试: 45, 分析: 62, 协作: 75 },
    程序员: { 设计: 35, 开发: 94, 测试: 68, 分析: 54, 协作: 72 },
    测试员: { 设计: 40, 开发: 66, 测试: 93, 分析: 58, 协作: 70 },
    分析师: { 设计: 64, 开发: 42, 测试: 56, 分析: 95, 协作: 77 },
    城主: { 设计: 70, 开发: 70, 测试: 70, 分析: 82, 协作: 96 },
  };
  return `${table[role]?.[career] ?? 60}%`;
}

export function CareersPopup({ onClose }: { onClose: () => void }) {
  const agents = useGameState((s) => s.agents);
  const selectedTaskType = useGameState((s) => s.selectedTaskType);
  const highlightCareerMap: Record<string, string> = {
    design: '设计',
    code: '开发',
    test: '测试',
    analyze: '分析',
    review: '协作',
  };
  const highlightCareer = highlightCareerMap[selectedTaskType];

  return (
    <div className="popup-mask" onClick={onClose}>
      <div className="popup-card wide" onClick={(e) => e.stopPropagation()}>
        <div className="popup-head">
          <strong>职业匹配矩阵</strong>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="popup-body">
          <table className="career-table">
            <thead>
              <tr>
                <th>Agent</th>
                {CAREERS.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a.id}>
                  <td>{a.name} ({a.role})</td>
                  {CAREERS.map((c) => (
                    <td
                      key={`${a.id}-${c}`}
                      style={c === highlightCareer ? { background: 'rgba(200,160,96,0.2)', color: '#c8a060', fontWeight: 700 } : undefined}
                    >
                      {getRatio(a.role, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
