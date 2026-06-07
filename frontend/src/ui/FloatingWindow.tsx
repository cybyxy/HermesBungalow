import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { colors, studioGlass, studioFontUi } from './theme';

interface FloatingWindowProps {
  id: string;
  title: ReactNode;
  x: number;
  y: number;
  width: number;
  height: number;
  minWidth?: number;
  minHeight?: number;
  zIndex: number;
  onClose: () => void;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (width: number, height: number) => void;
  children: ReactNode;
}

type DragState = { startX: number; startY: number; startPosX: number; startPosY: number };
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type ResizeState = {
  edge: ResizeEdge;
  startX: number; startY: number;
  startW: number; startH: number;
  startPosX: number; startPosY: number;
};

const MIN_W = 360;
const MIN_H = 260;

export function FloatingWindow(props: FloatingWindowProps) {
  const { id, title, x, y, width, height, minWidth = MIN_W, minHeight = MIN_H, zIndex,
    onClose, onFocus, onMove, onResize, children } = props;

  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);
  const frameRef = useRef<HTMLDivElement>(null);

  // ── drag ──
  const onHeaderDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setDrag({ startX: e.clientX, startY: e.clientY, startPosX: x, startPosY: y });
  }, [x, y]);

  // ── resize ──
  const onResizeDown = useCallback((edge: ResizeEdge) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setResize({ edge, startX: e.clientX, startY: e.clientY, startW: width, startH: height,
      startPosX: x, startPosY: y });
  }, [x, y, width, height]);

  useEffect(() => {
    if (!drag && !resize) return;

    const onMoveE = (e: MouseEvent) => {
      if (drag) {
        const nx = drag.startPosX + (e.clientX - drag.startX);
        const ny = drag.startPosY + (e.clientY - drag.startY);
        // clamp to viewport
        const cx = Math.max(-width + 100, Math.min(window.innerWidth - 100, nx));
        const cy = Math.max(0, Math.min(window.innerHeight - 48, ny));
        onMove(cx, cy);
      }
      if (resize) {
        let nw = resize.startW;
        let nh = resize.startH;
        let nx = resize.startPosX;
        let ny = resize.startPosY;
        const dx = e.clientX - resize.startX;
        const dy = e.clientY - resize.startY;
        if (resize.edge.includes('e')) { nw = Math.max(minWidth, resize.startW + dx); }
        if (resize.edge.includes('w')) { nw = Math.max(minWidth, resize.startW - dx); nx = resize.startPosX + (resize.startW - nw); }
        if (resize.edge.includes('s')) { nh = Math.max(minHeight, resize.startH + dy); }
        if (resize.edge.includes('n')) { nh = Math.max(minHeight, resize.startH - dy); ny = resize.startPosY + (resize.startH - nh); }
        // clamp
        nx = Math.max(-nw + 100, Math.min(window.innerWidth - 100, nx));
        ny = Math.max(0, Math.min(window.innerHeight - 48, ny));
        onMove(nx, ny);
        onResize(nw, nh);
      }
    };

    const onUp = () => { setDrag(null); setResize(null); };

    window.addEventListener('mousemove', onMoveE);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMoveE);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, resize, width, height, minWidth, minHeight, onMove, onResize]);

  const headerH = 36;
  const bodyH = height - headerH;

  const wrap: CSSProperties = {
    position: 'fixed',
    left: x, top: y,
    width, height,
    zIndex,
    borderRadius: 12,
    border: `2px solid ${colors.border}`,
    ...studioGlass.panel,
    boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: studioFontUi,
    cursor: drag ? 'grabbing' : 'default',
  };

  const headerStyle: CSSProperties = {
    height: headerH, minHeight: headerH,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 12px',
    ...studioGlass.muted,
    cursor: 'grab',
    userSelect: 'none',
  };

  const bodyStyle: CSSProperties = {
    height: bodyH,
    overflowY: 'auto',
    padding: 12,
    color: colors.text,
    fontSize: 12,
  };

  const closeBtn: CSSProperties = {
    border: 'none', background: 'transparent',
    color: colors.text, fontSize: 18, cursor: 'pointer',
    padding: 0, lineHeight: 1, width: 24, height: 24,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    borderRadius: 4,
  };

  const resizeHandle: CSSProperties = {
    position: 'absolute', zIndex: 1,
  };

  const h = (edge: ResizeEdge, cursor: string, style: CSSProperties) => (
    <div key={edge} style={{ ...resizeHandle, ...style, cursor }}
      onMouseDown={onResizeDown(edge)} />
  );

  return (
    <div ref={frameRef} style={wrap} onMouseDown={onFocus}>
      <div style={headerStyle} onMouseDown={onHeaderDown}>
        <span style={{ color: colors.gold, fontSize: 13, fontWeight: 600 }}>{title}</span>
        <button style={closeBtn} onClick={onClose}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = '#f66'; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = colors.text; }}
        >×</button>
      </div>
      <div style={bodyStyle}>{children}</div>
      {/* resize handles */}
      {h('n',  'ns-resize',  { top: 0, left: 6, right: 6, height: 6 })}
      {h('s',  'ns-resize',  { bottom: 0, left: 6, right: 6, height: 6 })}
      {h('e',  'ew-resize',  { right: 0, top: 6, bottom: 6, width: 6 })}
      {h('w',  'ew-resize',  { left: 0, top: 6, bottom: 6, width: 6 })}
      {h('ne', 'nesw-resize',{ top: 0, right: 0, width: 12, height: 12 })}
      {h('nw', 'nwse-resize',{ top: 0, left: 0, width: 12, height: 12 })}
      {h('se', 'nwse-resize',{ bottom: 0, right: 0, width: 12, height: 12 })}
      {h('sw', 'nesw-resize',{ bottom: 0, left: 0, width: 12, height: 12 })}
    </div>
  );
}
