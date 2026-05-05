import { layoutPx } from './theme';

export type PageRect = { x: number; y: number; w: number; h: number };

export type FullPageLayout = {
  W: number;
  H: number;
  top: PageRect;
  right: PageRect;
  bottom: PageRect;
  center: PageRect;
};

export type FullPageLayoutOptions = {
  rightPanelCollapsed?: boolean;
};

/**
 * Phaser 挂载父元素为顶栏与底栏之间的全宽区域（画布铺在左右侧栏下方，便于侧栏毛玻璃叠在画面上）。
 * 传入的 W×H 即画布尺寸，`center` 与画布同大。
 */
export function computePhaserParentLayout(W: number, H: number): FullPageLayout {
  const tw = Math.max(32, W);
  const th = Math.max(32, H);
  return {
    W: tw,
    H: th,
    top: { x: 0, y: 0, w: tw, h: 0 },
    right: { x: 0, y: 0, w: 0, h: th },
    bottom: { x: 0, y: th, w: tw, h: 0 },
    center: { x: 0, y: 0, w: tw, h: th },
  };
}

/** 整页分区：顶栏、底栏、右侧栏、中央 Phaser 游戏区（办公室 + 建筑）。 */
export function computeFullPageLayout(
  W: number,
  H: number,
  opts?: FullPageLayoutOptions,
): FullPageLayout {
  const tw = Math.max(32, W);
  const th = Math.max(32, H);
  const topH = layoutPx.topBar;
  const botH = layoutPx.bottomBar;
  const midH = th - topH - botH;
  const sideFull = layoutPx.sidePanel;
  const sideStrip = layoutPx.sidePanelCollapsed;
  /**
   * 中央区逻辑宽度 = 总宽 − 展开侧栏；极窄窗口时至少保留侧条宽度，避免出现负宽度、
   * 右侧「填缝」矩形从负 x 铺满画布导致整屏发黑。
   */
  const cw = Math.max(sideStrip, tw - sideFull);
  const collapsed = Boolean(opts?.rightPanelCollapsed);
  let rw: number;
  let rx: number;
  if (collapsed) {
    rw = sideStrip;
    rx = tw - sideStrip;
  } else {
    rw = Math.min(sideFull, Math.max(sideStrip, tw - cw));
    rx = cw;
  }
  return {
    W: tw,
    H: th,
    top: { x: 0, y: 0, w: tw, h: topH },
    right: { x: rx, y: topH, w: rw, h: midH },
    bottom: { x: 0, y: th - botH, w: tw, h: botH },
    center: { x: 0, y: topH, w: cw, h: midH },
  };
}
