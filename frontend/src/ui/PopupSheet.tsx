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
  /** 'bottom-sheet'：停靠在 footer 正上方，宽度与主画布列一致；'overlay'：屏幕居中。 */
  variant?: 'bottom-sheet' | 'overlay';
  /**
   * 主画布列右侧占用像素，默认 `layoutPx.sidePanel`。
   * 弹层宽度 = `calc(100vw - insetRightPx)`。
   */
  insetRightPx?: number;
  /**
   * 为 true：不挡背后点击（非模态）。底部弹层默认 true；居中 overlay 默认 false。
   */
  nonBlocking?: boolean;
  /**
   * 为 true：点遮罩 / Escape 可关闭。底部弹层默认 false（仅右上角 × 关闭）；overlay 默认 true。
   */
  dismissible?: boolean;
}) {
  const {
    open,
    title,
    onClose,
    children,
    footer,
    zIndex = 1100,
    variant,
    insetRightPx,
    nonBlocking: nonBlockingProp,
    dismissible: dismissibleProp,
  } = props;

  const isBottomSheet = variant !== 'overlay';
  const dismissible = dismissibleProp ?? !isBottomSheet;
  const nonBlocking = nonBlockingProp ?? isBottomSheet;

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  if (!open) return null;

  if (!isBottomSheet) {
    return (
      <div
        role="presentation"
        onClick={dismissible ? (e) => e.target === e.currentTarget && onClose() : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          boxSizing: 'border-box',
          background: nonBlocking ? 'transparent' : 'rgba(0,0,0,0.75)',
          pointerEvents: nonBlocking ? 'none' : 'auto',
        }}
      >
        <div
          role="dialog"
          aria-modal={!nonBlocking}
          style={{
            ...sheetStyleOverlay,
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
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

  const rightInset = insetRightPx ?? layoutPx.sidePanel;
  const canvasColWidth = `calc(100vw - ${rightInset}px)`;
  const sheetMaxH = `calc(100vh - ${layoutPx.topBar}px - ${layoutPx.bottomBar}px - 12px)`;

  const sheetInner = (
    <div
      style={{
        ...sheetStyleBottom,
        maxHeight: sheetMaxH,
      }}
    >
      <div style={headerStyle}>
        <span style={{ color: colors.gold, fontWeight: 'bold', fontSize: 14 }}>{title}</span>
        <button type="button" onClick={onClose} style={closeStyle}>
          ×
        </button>
      </div>
      <div style={bodyStyle}>{children}</div>
      {footer ? <div style={footerStyle}>{footer}</div> : null}
    </div>
  );

  if (nonBlocking) {
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex,
          pointerEvents: 'none',
        }}
      >
        <div
          role="dialog"
          aria-modal={false}
          style={{
            position: 'absolute',
            left: 0,
            bottom: layoutPx.bottomBar,
            width: canvasColWidth,
            maxWidth: canvasColWidth,
            boxSizing: 'border-box',
            pointerEvents: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {sheetInner}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex,
        pointerEvents: 'auto',
      }}
    >
      <div
        role="presentation"
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0,0,0,0.62)',
          pointerEvents: 'auto',
        }}
        onClick={dismissible ? () => onClose() : undefined}
      />
      <div
        role="dialog"
        aria-modal
        style={{
          position: 'absolute',
          left: 0,
          bottom: layoutPx.bottomBar,
          width: canvasColWidth,
          maxWidth: canvasColWidth,
          boxSizing: 'border-box',
          zIndex: 1,
          pointerEvents: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {sheetInner}
      </div>
    </div>
  );
}

const sheetStyleBottom: CSSProperties = {
  background: '#1a1a30',
  border: `2px solid ${colors.gold}`,
  borderRadius: '12px 12px 0 0',
  width: '100%',
  height: 'min(42vh, 100%)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 -8px 40px rgba(0,0,0,0.45)',
};

const sheetStyleOverlay: CSSProperties = {
  background: '#1a1a30',
  border: `2px solid ${colors.gold}`,
  borderRadius: 12,
  width: 'min(90vw, 520px)',
  maxHeight: 'min(85vh, 720px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 40px rgba(0,0,0,0.45)',
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
