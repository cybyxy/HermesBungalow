// 侧边栏导航 — 小屋/文档墙/工具架/展示区切换
interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const tabs = [
    { id: 'home', label: '🏠 小屋' },
    { id: 'docs', label: '📋 文档墙' },
    { id: 'tools', label: '🛠 工具架' },
    { id: 'showcase', label: '🏆 展示区' },
  ];

  return (
    <div className="absolute top-3 left-3 z-50 flex gap-2">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`text-[10px] px-4 py-2 rounded border-2 transition-all ${
            activeTab === tab.id
              ? 'bg-pink-600 text-white border-pink-500'
              : 'bg-gray-900/80 text-gray-300 border-indigo-700 hover:bg-pink-600/50'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

// 文档墙覆盖层
export function DocumentWall({ onClose }: { onClose: () => void }) {
  const docs = [
    { icon: '📄', title: 'PRD — 崽崽数字小屋 v1.2', meta: '2026-04-28 | 需求分析师: 崽崽' },
    { icon: '📋', title: 'IMPLEMENTATION_PLAN.md', meta: '2026-04-28 | 实现路径规划' },
    { icon: '🛠', title: '5W2H 分析框架模板', meta: '工具 | 需求分析方法论' },
    { icon: '🏆', title: 'MoSCoW 优先级标签库', meta: '工具 | Must/Should/Could/Won\'t' },
    { icon: '📋', title: '用户故事地图模板', meta: '工具 | 敏捷需求分析' },
    { icon: '🛠', title: '用例图 — 访客交互流程', meta: 'UML | 系统行为建模' },
  ];

  return (
    <div className="absolute inset-0 bg-gray-950/95 z-40 p-8 overflow-y-auto">
      <button onClick={onClose} className="absolute top-4 right-6 text-pink-500 text-xl">✕</button>
      <h2 className="text-lg text-yellow-400 mb-6 font-bold">📋 文档墙</h2>
      <div className="grid grid-cols-3 gap-3">
        {docs.map((doc, i) => (
          <div
            key={i}
            className="bg-indigo-900/50 border-2 border-indigo-700 rounded-lg p-4 cursor-pointer hover:border-pink-500 transition-colors"
          >
            <div className="text-2xl mb-2">{doc.icon}</div>
            <h3 className="text-[10px] text-gray-100 mb-1">{doc.title}</h3>
            <p className="text-[8px] text-gray-400">{doc.meta}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// 工具架覆盖层
export function ToolShelf({ onClose }: { onClose: () => void }) {
  const tools = [
    { icon: '❓', title: '5W2H分析法', desc: 'What/Why/Who/When/Where/How/How much' },
    { icon: '🎯', title: 'MoSCoW优先级', desc: 'Must have / Should have / Could have / Won\'t have' },
    { icon: '📝', title: '用户故事模板', desc: '作为...我想要...以便...' },
    { icon: '🔗', title: '需求跟踪矩阵', desc: '从提出到实现的完整链路追踪' },
  ];

  return (
    <div className="absolute inset-0 bg-gray-950/95 z-40 p-8 overflow-y-auto">
      <button onClick={onClose} className="absolute top-4 right-6 text-pink-500 text-xl">✕</button>
      <h2 className="text-lg text-yellow-400 mb-6 font-bold">🛠 工具架</h2>
      <div className="grid grid-cols-2 gap-3">
        {tools.map((tool, i) => (
          <div key={i} className="bg-indigo-900/50 border-2 border-indigo-700 rounded-lg p-4 hover:border-pink-500 transition-colors">
            <div className="text-2xl mb-2">{tool.icon}</div>
            <h3 className="text-[10px] text-gray-100 mb-1">{tool.title}</h3>
            <p className="text-[8px] text-gray-400">{tool.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// 展示区覆盖层
export function Showcase({ onClose }: { onClose: () => void }) {
  return (
    <div className="absolute inset-0 bg-gray-950/95 z-40 p-8 overflow-y-auto">
      <button onClick={onClose} className="absolute top-4 right-6 text-pink-500 text-xl">✕</button>
      <h2 className="text-lg text-yellow-400 mb-6 font-bold">🏆 展示区</h2>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-indigo-900/50 border-2 border-indigo-700 rounded-lg p-4 text-center">
          <div className="text-3xl mb-2">🏆</div>
          <h3 className="text-[10px] text-yellow-400">最佳需求分析师</h3>
          <p className="text-[8px] text-gray-400 mt-1">崽崽获得认可！</p>
        </div>
        <div className="bg-indigo-900/50 border-2 border-indigo-700 rounded-lg p-4 text-center">
          <div className="text-3xl mb-2">📊</div>
          <h3 className="text-[10px] text-gray-100">项目看板</h3>
          <p className="text-[8px] text-gray-400 mt-1">进行中: 1 | 已完成: 5</p>
        </div>
        <div className="bg-indigo-900/50 border-2 border-indigo-700 rounded-lg p-4 text-center">
          <div className="text-3xl mb-2">📈</div>
          <h3 className="text-[10px] text-gray-100">成长日志</h3>
          <p className="text-[8px] text-gray-400 mt-1">从新手到专家之路</p>
        </div>
      </div>
    </div>
  );
}
