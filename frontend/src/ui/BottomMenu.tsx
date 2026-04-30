type MenuKey = 'agent' | 'careers' | 'archive' | 'system';

interface BottomMenuProps {
  active: MenuKey | null;
  onSelect: (key: MenuKey) => void;
}

const ITEMS: Array<{ key: MenuKey; label: string }> = [
  { key: 'agent', label: '🤖 Agent' },
  { key: 'careers', label: '💼 职业' },
  { key: 'archive', label: '📚 资料室' },
  { key: 'system', label: '⚙️ 系统' },
];

export function BottomMenu({ active, onSelect }: BottomMenuProps) {
  return (
    <div className="bottom-menu-items">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          className={`menu-item ${active === item.key ? 'active' : ''}`}
          onClick={() => onSelect(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
