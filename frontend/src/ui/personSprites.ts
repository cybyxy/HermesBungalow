import { spriteSheetRow, type Direction } from './spriteMap';

/** 与 `public/assets/person/*.png` 文件名一致（96×192，3×4 格） */
export const PERSON_SHEET_BASES = [
  'badboy',
  'brother',
  'chickenboy',
  'citizen_01',
  'citizen_02',
  'citizen_03',
  'hero_01',
  'student_01',
  'student_02',
  'student_03',
  'student_04',
  'student_05',
  'student_06',
  'student_07',
  'student_08',
  'student_09',
  'suit_01',
  'suit_02',
  'suit_03',
  'suit_04',
  'suit_05',
] as const;

export function isPersonSheetBase(base: string): boolean {
  return (PERSON_SHEET_BASES as readonly string[]).includes(base);
}

export const PERSON_FRAME_W = 32;
export const PERSON_FRAME_H = 48;

export function getPersonSheetUrl(base: string): string {
  return `/assets/person/${base}.png`;
}

/** Phaser texture key，避免与其它资源重名 */
export function personTextureKey(base: string): string {
  return `person__${base}`;
}

/** 雪碧 3×4：行=朝向，列=帧，Phaser 帧号行优先 0..11 */
export function personFrameIndex(dir: Direction, colFrame: number): number {
  const col = Math.max(0, Math.min(2, colFrame));
  return spriteSheetRow(dir) * 3 + col;
}
