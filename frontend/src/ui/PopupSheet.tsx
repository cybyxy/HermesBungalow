import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { colors, layoutPx, studioGlass } from './theme';

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
};

function clampDrag(dx: number, dy: number): { x: number; y: number } {
  const w = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const h = typeof window !== 'undefined' ? window.innerHeight : 768;
  const maxX = Math.max(80, w * 0.48);
  const maxY = Math.max(80, h * 0.45);
  return {
    x: Math.max(-maxX, Math.min(maxX, dx)),
    y: Math.max(-maxY, Math.min(maxY, dy)),
  };
}

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
  /** 仅 `variant="overlay"`：按住标题栏（除关闭按钮）拖动窗体。 */
  draggable?: boolean;
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
    draggable = false,
  } = props;

  const isBottomSheet = variant !== 'overlay';
  const dismissible = dismissibleProp ?? !isBottomSheet;
  const nonBlocking = nonBlockingProp ?? isBottomSheet;

  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragOffsetRef = useRef(dragOffset);
  dragOffsetRef.current = dragOffset;
  const dragSession = useRef<DragSession | null>(null);

  useEffect(() => {
    if (open && draggable && !isBottomSheet) setDragOffset({ x: 0, y: 0 });
  }, [open, draggable, isBottomSheet]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, dismissible]);

  const onOverlayHeaderPointerDown = useCallback((e: PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const o = dragOffsetRef.current;
    dragSession.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originX: o.x,
      originY: o.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [draggable]);

  const onOverlayHeaderPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const s = dragSession.current;
    if (!s || e.pointerId !== s.pointerId) return;
    const nx = s.originX + (e.clientX - s.startX);
    const ny = s.originY + (e.clientY - s.startY);
    setDragOffset(clampDrag(nx, ny));
  }, []);

  const onOverlayHeaderPointerUp = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const s = dragSession.current;
    if (!s || e.pointerId !== s.pointerId) return;
    dragSession.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  if (!open) return null;

  if (!isBottomSheet) {
    const headerDragStyle: CSSProperties = draggable
      ? {
          ...headerStyle,
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
        }
      : headerStyle;

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
            transform: draggable ? `translate(${dragOffset.x}px, ${dragOffset.y}px)` : undefined,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={headerDragStyle}
            onPointerDown={draggable ? onOverlayHeaderPointerDown : undefined}
            onPointerMove={draggable ? onOverlayHeaderPointerMove : undefined}
            onPointerUp={draggable ? onOverlayHeaderPointerUp : undefined}
            onPointerCancel={draggable ? onOverlayHeaderPointerUp : undefined}
          >
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
  ...studioGlass.panel,
  border: `2px solid ${colors.border}`,
  borderRadius: '12px 12px 0 0',
  width: '100%',
  height: 'min(42vh, 100%)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 -8px 32px rgba(0,0,0,0.35)',
};

const sheetStyleOverlay: CSSProperties = {
  ...studioGlass.panel,
  border: `2px solid ${colors.border}`,
  borderRadius: 12,
  width: 'min(90vw, 520px)',
  maxHeight: 'min(85vh, 720px)',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
};

const headerStyle: CSSProperties = {
  ...studioGlass.muted,
  padding: '12px 16px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  borderBottom: `1px solid ${colors.border}`,
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
  background: 'rgba(10,10,21,0.2)',
};

const footerStyle: CSSProperties = {
  ...studioGlass.muted,
  padding: '12px 16px',
  borderTop: `1px solid ${colors.border}`,
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 10,
  flexShrink: 0,
};
