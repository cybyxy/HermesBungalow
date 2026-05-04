import type { MenuDef, MenuItemDef } from './menuConfig';

export function MenuPanel(props: { menu: MenuDef; onItemClick: (menuKey: string, itemId: string) => void }) {
  const { menu, onItemClick } = props;

  const renderItem = (item: MenuItemDef, idx: number) => {
    if (item.type === 'separator') {
      return <div key={`sep-${idx}`} style={{ height: 1, background: '#333', margin: '6px 0' }} />;
    }
    const tip = item.tooltip ?? item.label;
    return (
      <button
        key={item.id}
        type="button"
        disabled={item.disabled}
        title={tip}
        onClick={() => {
          if (!item.disabled) onItemClick(menu.key, item.id);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          width: '100%',
          padding: '10px 16px',
          border: 'none',
          background: 'transparent',
          color: item.disabled ? '#555' : '#eee',
          fontSize: 12,
          fontFamily: 'inherit',
          cursor: item.disabled ? 'not-allowed' : 'pointer',
          textAlign: 'left',
        }}
        onMouseEnter={(e) => {
          if (!item.disabled) (e.currentTarget.style.background = 'rgba(255, 215, 0, 0.15)');
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
        }}
      >
        <span>{item.label}</span>
        {item.hotkey && <span style={{ marginLeft: 'auto', color: '#666', fontSize: 10 }}>{item.hotkey}</span>}
      </button>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {menu.items.map((it, i) => renderItem(it, i))}
    </div>
  );
}
