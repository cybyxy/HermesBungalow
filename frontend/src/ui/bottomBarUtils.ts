import type { CSSProperties } from 'react';

export const MENU_BTN_W = 70;
/** 与左侧主菜单按钮同高，保证底栏一行内所有按钮水平对齐 */
export const FOOTER_BTN_H = 34;
/** 底栏输入行占位高度（多行时输入框由此向上浮出，不撑高底栏主行） */
export const INPUT_ROW_H = FOOTER_BTN_H;
export const TEXTAREA_MAX_H = 220;

/** 与「新建」及左侧菜单同高、同一条基线对齐 */
export const footerBarBtn: CSSProperties = {
  fontSize: 10,
  height: FOOTER_BTN_H,
  padding: '0 10px',
  boxSizing: 'border-box',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
  cursor: 'pointer',
};

export function clipboardFileKey(f: File): string {
  return `${f.size}\0${f.lastModified}\0${f.name}`;
}

export function hasImageMime(type: string): boolean {
  const t = (type || '').toLowerCase();
  if (t.startsWith('image/')) return true;
  return (
    t.includes('png') ||
    t.includes('jpeg') ||
    t.includes('jpg') ||
    t.includes('gif') ||
    t.includes('webp') ||
    t.includes('tiff') ||
    t.includes('heic') ||
    t === 'image/x-png' ||
    t === 'image/pjpeg'
  );
}

export function fileLooksLikeImageByMeta(f: File): boolean {
  if (hasImageMime(f.type)) return true;
  if (f.name && /\.(png|jpe?g|gif|webp|bmp|tif|tiff|heic|heif)$/i.test(f.name)) return true;
  return false;
}

export async function sniffImageFormat(blob: Blob): Promise<'png' | 'jpeg' | 'gif' | 'webp' | null> {
  const buf = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (buf.length < 4) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x52 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  )
    return 'webp';
  return null;
}

/** 剪贴板未带 image/* MIME 时，按魔数补全类型，便于走游戏上传接口与模型识别。 */
export async function normalizePastedImageFile(f: File): Promise<File | null> {
  if (f.type.startsWith('image/')) return f;
  const sig = await sniffImageFormat(f);
  if (!sig) return null;
  const mime = sig === 'jpeg' ? 'image/jpeg' : `image/${sig}`;
  const ext = sig === 'jpeg' ? 'jpg' : sig;
  const base =
    (f.name && /\.[a-z0-9]+$/i.test(f.name) ? f.name.replace(/\.[^/.]+$/, '') : f.name) || 'paste';
  return new File([f], `${base}.${ext}`, { type: mime, lastModified: f.lastModified });
}

/** 同步可判定的图片：item / files 上已有 image/* 或扩展名。 */
export function syncCollectPastedImages(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (f: File | null) => {
    if (!f || f.size < 16) return;
    if (!fileLooksLikeImageByMeta(f)) return;
    const k = clipboardFileKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const f = item.getAsFile();
    if (!f) continue;
    if (!hasImageMime(item.type || '') && !fileLooksLikeImageByMeta(f)) continue;
    add(f);
  }
  for (const f of Array.from(dt.files ?? [])) {
    add(f);
  }
  return out;
}

/** 疑似截图：无 MIME/无文件名，需异步读魔数（避免误把非图文件当图）。 */
export function ambiguousPastedImageBlobs(dt: DataTransfer): File[] {
  const out: File[] = [];
  const seen = new Set<string>();
  const add = (f: File | null) => {
    if (!f || f.size < 32) return;
    if (fileLooksLikeImageByMeta(f)) return;
    const t = (f.type || '').trim();
    const name = (f.name || '').trim();
    if (t !== '' && t !== 'application/octet-stream') return;
    if (name && !/^image\.(png|jpe?g|gif|webp)$/i.test(name) && name.includes('.')) return;
    const k = clipboardFileKey(f);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(f);
  };

  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const it = item.type || '';
    if (hasImageMime(it)) continue;
    add(item.getAsFile());
  }
  for (const f of Array.from(dt.files ?? [])) {
    add(f);
  }
  return out.slice(0, 4);
}

/** Phaser 画布等会抢走焦点，paste 到不到底栏 textarea；焦点不在其它表单控件时由全局捕获把图片交给会话输入。 */
export function shouldDelegatePasteToFocusedField(
  target: EventTarget | null,
  chatTextarea: HTMLTextAreaElement | null,
): boolean {
  if (!(target instanceof Element)) return false;
  if (chatTextarea && (target === chatTextarea || chatTextarea.contains(target))) return true;
  const field = target.closest(
    'textarea, select, [contenteditable="true"], input[type="text"], input[type="search"], input[type="url"], input[type="email"], input[type="password"], input[type="tel"], input[type="number"], input:not([type])',
  );
  if (field) return true;
  return Boolean(target.closest('input[type="file"]'));
}
