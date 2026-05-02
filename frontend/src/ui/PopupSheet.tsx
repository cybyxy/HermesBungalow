import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, layoutPx } from './theme';

export function PopupSheet(props: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { open, title, onClose, children, footer } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={overlayStyle}
    >
      <div style={sheetStyle}>
        <div style={headerStyle}>
          <span style={{ color: colors.gold, fontWeight: 'bold', fontSize: 14 }}>{title}</span>
          <button type="button" onClick={onClose} style={closeStyle}>
            ×
          </button>
        </div>
        <div style={bodyStyle}>{children}</div>
        {footer ? <div style={footerStyle}>{footer}</div> : null}
      </div>
    </div>
  );
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.7)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'stretch',
  padding: `0 0 ${layoutPx.bottomBar + 3}px 0`,
  boxSizing: 'border-box',
  zIndex: 1100,
};

const sheetStyle: CSSProperties = {
  background: '#1a1a30',
  border: `2px solid ${colors.gold}`,
  borderRadius: '12px 12px 0 0',
  width: '100%',
  maxWidth: '100%',
  height: 'min(41%, calc(100% - 8px))',
  maxHeight: 'calc(100% - 8px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 -8px 40px rgba(0,0,0,0.45)',
};

const headerStyle: CSSProperties = {
  background: '#252540',
  padding: '12px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: '1px solid #333',
  flexShrink: 0,
};

const closeStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#888',
  fontSize: 20,
  cursor: 'pointer',
  fontFamily: 'inherit',
  lineHeight: 1,
};

const bodyStyle: CSSProperties = {
  padding: 16,
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
};

const footerStyle: CSSProperties = {
  padding: '12px 16px',
  borderTop: '1px solid #333',
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  flexShrink: 0,
};
