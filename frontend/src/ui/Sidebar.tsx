// 侧边栏导航 — 小屋/文档墙/工具架/展示区切换
interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
}

export function Sidebar({ activeTab, onTabChange }: SidebarProps) {
  const tabs = [
    { id: 'home', label: '🏠 小屋', desc: '返回首页' },
    { id: 'docs', label: '📋 文档墙', desc: '需求文档' },
    { id: 'tools', label: '🛠 工具架', desc: '分析方法' },
    { id: 'showcase', label: '🏆 展示区', desc: '成果展示' },
  ];

  return (
    <div
      className="absolute top-3 left-3 z-50 flex gap-2"
      style={{
        background: 'rgba(13,13,26,0.85)',
        backdropFilter: 'blur(12px)',
        padding: '6px',
        borderRadius: '16px',
        border: '1px solid rgba(139,92,246,0.25)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            className="relative text-[10px] px-4 py-2 rounded-xl transition-all hover:scale-105 active:scale-95 group"
            style={{
              background: isActive
                ? 'linear-gradient(135deg, rgba(139,92,246,0.35), rgba(167,139,250,0.35))'
                : 'transparent',
              border: isActive
                ? '1px solid rgba(139,92,246,0.5)'
                : '1px solid transparent',
              color: isActive ? '#e2e8f0' : '#94a3b8',
              boxShadow: isActive ? '0 0 16px rgba(139,92,246,0.2)' : 'none',
            }}
            title={tab.desc}
          >
            <span className="relative z-10">{tab.label}</span>
            {isActive && (
              <div
                className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full"
                style={{ background: 'linear-gradient(90deg, #a78bfa, #67e8f9)' }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ===== 文档墙覆盖层 =====
export function DocumentWall({ onClose }: { onClose: () => void }) {
  const docs = [
    { icon: '📄', title: 'PRD — 崽崽数字小屋 v1.2', meta: '2026-04-28 | 需求分析师: 崽崽', color: '#a78bfa' },
    { icon: '📋', title: 'IMPLEMENTATION_PLAN.md', meta: '2026-04-28 | 实现路径规划', color: '#67e8f9' },
    { icon: '🛠', title: '5W2H 分析框架模板', meta: '工具 | 需求分析方法论', color: '#f472b6' },
    { icon: '🏆', title: 'MoSCoW 优先级标签库', meta: '工具 | Must/Should/Could/Won\'t', color: '#fbbf24' },
    { icon: '📋', title: '用户故事地图模板', meta: '工具 | 敏捷需求分析', color: '#4ade80' },
    { icon: '🛠', title: '用例图 — 访客交互流程', meta: 'UML | 系统行为建模', color: '#f87171' },
  ];

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center p-8"
      style={{
        background: 'rgba(13,13,26,0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(139,92,246,0.2)',
      }}
    >
      {/* 关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-6 right-8 w-9 h-9 rounded-xl flex items-center justify-center text-[18px] transition-all hover:scale-110 active:scale-95 z-10"
        style={{
          background: 'rgba(139,92,246,0.15)',
          border: '1px solid rgba(139,92,246,0.3)',
          color: '#a78bfa',
        }}
      >
        ✕
      </button>

      <div className="w-full max-w-4xl">
        <h2
          className="text-xl font-bold mb-6 text-center"
          style={{ color: '#e2e8f0' }}
        >
          📋 文档墙
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {docs.map((doc, i) => (
            <div
              key={i}
              className="group cursor-pointer rounded-2xl p-5 transition-all hover:scale-[1.02] hover:-translate-y-1"
              style={{
                background: 'linear-gradient(135deg, rgba(19,19,42,0.95), rgba(26,26,56,0.95))',
                border: '1px solid rgba(139,92,246,0.2)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              }}
            >
              <div
                className="text-3xl mb-3 transition-transform group-hover:scale-110"
                style={{ filter: `drop-shadow(0 0 8px ${doc.color}40)` }}
              >
                {doc.icon}
              </div>
              <h3 className="text-[11px] font-semibold text-slate-100 mb-1 leading-snug">{doc.title}</h3>
              <p className="text-[10px] text-slate-500">{doc.meta}</p>
              <div
                className="h-[2px] mt-3 rounded-full transition-all group-hover:scale-x-110"
                style={{ background: doc.color, opacity: 0.5 }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== 工具架覆盖层 =====
export function ToolShelf({ onClose }: { onClose: () => void }) {
  const tools = [
    { icon: '❓', title: '5W2H分析法', desc: 'What/Why/Who/When/Where/How/How much — 全面理解需求的经典框架', color: '#a78bfa' },
    { icon: '🎯', title: 'MoSCoW优先级', desc: 'Must have / Should have / Could have / Won\'t have — 需求排序神器', color: '#67e8f9' },
    { icon: '📝', title: '用户故事模板', desc: '作为...我想要...以便... — 敏捷需求表达的标准化方式', color: '#f472b6' },
    { icon: '🔗', title: '需求跟踪矩阵', desc: '从提出到实现的完整链路追踪 — 确保不遗漏每一个需求', color: '#4ade80' },
  ];

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center p-8"
      style={{
        background: 'rgba(13,13,26,0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(139,92,246,0.2)',
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-8 w-9 h-9 rounded-xl flex items-center justify-center text-[18px] transition-all hover:scale-110 active:scale-95 z-10"
        style={{
          background: 'rgba(139,92,246,0.15)',
          border: '1px solid rgba(139,92,246,0.3)',
          color: '#a78bfa',
        }}
      >
        ✕
      </button>

      <div className="w-full max-w-3xl">
        <h2 className="text-xl font-bold mb-6 text-center" style={{ color: '#e2e8f0' }}>
          🛠 工具架
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {tools.map((tool, i) => (
            <div
              key={i}
              className="group rounded-2xl p-5 transition-all hover:scale-[1.02] hover:-translate-y-1"
              style={{
                background: 'linear-gradient(135deg, rgba(19,19,42,0.95), rgba(26,26,56,0.95))',
                border: '1px solid rgba(139,92,246,0.2)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
              }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="text-2xl mt-0.5 transition-transform group-hover:scale-110"
                  style={{ filter: `drop-shadow(0 0 8px ${tool.color}40)` }}
                >
                  {tool.icon}
                </div>
                <div>
                  <h3 className="text-[12px] font-bold text-slate-100 mb-1">{tool.title}</h3>
                  <p className="text-[10px] text-slate-400 leading-relaxed">{tool.desc}</p>
                </div>
              </div>
              <div
                className="h-[2px] mt-3 rounded-full"
                style={{ background: tool.color, opacity: 0.4 }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===== 展示区覆盖层 =====
export function Showcase({ onClose }: { onClose: () => void }) {
  const items = [
    { icon: '🏆', title: '最佳需求分析师', sub: '崽崽获得认可！', color: '#fbbf24', gradient: 'rgba(251,191,36,0.15)' },
    { icon: '📊', title: '项目看板', sub: '进行中: 1 | 已完成: 5', color: '#67e8f9', gradient: 'rgba(103,232,249,0.15)' },
    { icon: '📈', title: '成长日志', sub: '从新手到专家之路', color: '#4ade80', gradient: 'rgba(74,222,128,0.15)' },
  ];

  return (
    <div
      className="absolute inset-0 z-40 flex items-center justify-center p-8"
      style={{
        background: 'rgba(13,13,26,0.92)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(139,92,246,0.2)',
      }}
    >
      <button
        onClick={onClose}
        className="absolute top-6 right-8 w-9 h-9 rounded-xl flex items-center justify-center text-[18px] transition-all hover:scale-110 active:scale-95 z-10"
        style={{
          background: 'rgba(139,92,246,0.15)',
          border: '1px solid rgba(139,92,246,0.3)',
          color: '#a78bfa',
        }}
      >
        ✕
      </button>

      <div className="w-full max-w-3xl">
        <h2 className="text-xl font-bold mb-6 text-center" style={{ color: '#e2e8f0' }}>
          🏆 展示区
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {items.map((item, i) => (
            <div
              key={i}
              className="rounded-2xl p-6 text-center transition-all hover:scale-[1.03] hover:-translate-y-1"
              style={{
                background: `linear-gradient(135deg, ${item.gradient}, rgba(19,19,42,0.95))`,
                border: '1px solid rgba(139,92,246,0.2)',
                boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
              }}
            >
              <div
                className="text-4xl mb-3"
                style={{ filter: `drop-shadow(0 0 12px ${item.color}50)` }}
              >
                {item.icon}
              </div>
              <h3 className="text-[12px] font-bold mb-1" style={{ color: item.color }}>{item.title}</h3>
              <p className="text-[10px] text-slate-400">{item.sub}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
