import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, layoutPx } from './theme';

export function PopupSheet(props: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** Overlay stacking; clarify / blocking dialogs should sit above the bottom bar (≈1200). */
  zIndex?: number;
  /** 'bottom-sheet' (default) anchors to bottom; 'overlay' centers on screen. */
  variant?: 'bottom-sheet' | 'overlay';
}) {
  const { open, title, onClose, children, footer, zIndex = 1100, variant } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const isBottomSheet = variant !== 'overlay';
  const overlayAlign = isBottomSheet ? 'flex-end' : 'center';
  const overlayJustify = isBottomSheet ? 'stretch' : 'center';
  const overlayPadding = isBottomSheet ? `${layoutPx.bottomBar + 3}px 0 0 0` : '0';
  const sheetMaxWidth = isBottomSheet ? '100%' : 520;
  const sheetHeight = isBottomSheet ? 'min(41%, calc(100% - 8px))' : 'auto';
  const sheetBorderRadius = isBottomSheet ? '12px 12px 0 0' : 12;
  const overlayBg = isBottomSheet ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.75)';

  return (
    <div
      role="presentation"
      onClick={isBottomSheet ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}
      style={{ ...overlayStyle, zIndex, alignItems: overlayAlign, justifyContent: overlayJustify, padding: overlayPadding, background: overlayBg }}
    >
      <div style={{ ...sheetStyle, maxWidth: sheetMaxWidth, height: sheetHeight, borderRadius: sheetBorderRadius, width: isBottomSheet ? '100%' : 'min(90vw, 520px)' }}>
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
