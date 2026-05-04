/**
 * Dynamic sprite selection based on Agent gender + personality.
 * Optionally overridden by agent's own `avatar` field.
 *
 * **整表**：`/assets/person/{base}.png`（96×192，3×4）由 Phaser `spritesheet` 裁帧。
 * **散图**：`/assets/sprites/{base}_{dir}_{f}.png`
 * **对齐**：`/assets/sprites/aligned/{base}_down_{f}.png`（已按重心对齐的三帧）
 */

const SPRITE_BASE = '/assets/sprites/';

/** 行走方向（雪碧 3×4 行或散图文件名后缀）。 */
export type Direction = 'down' | 'up' | 'left' | 'right' | 'idle';

/** 已有 `aligned/{base}_down_{0..2}.png` 的 base，走对齐散图。 */
const SPRITE_ALIGNED_DOWN_BASES = new Set<string>([]);

interface SpriteEntry {
  files: string[];
  personalityKeywords: string[];
}

/** 无 avatar、性格未命中关键词时：按 id/名 稳定哈希分配，避免全员同一套默认图。 */
const FALLBACK_FEMALE = [
  'student_01',
  'student_02',
  'student_03',
  'student_04',
  'student_05',
  'student_06',
  'student_07',
  'student_08',
  'student_09',
  'citizen_01',
  'citizen_02',
  'hero_01',
] as const;
const FALLBACK_MALE = [
  'suit_01',
  'suit_02',
  'suit_03',
  'suit_04',
  'suit_05',
  'citizen_01',
  'citizen_02',
  'citizen_03',
  'badboy',
  'brother',
  'hero_01',
  'chickenboy',
] as const;
const FALLBACK_NEUTRAL = [...new Set([...FALLBACK_FEMALE, ...FALLBACK_MALE])] as readonly string[];

function stringHash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** 从 SOUL/配置 来的路径或裸 base，统一成雪碧 base（如 `student_03`）。 */
export function normalizeAvatarBase(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).trim();
  if (!s) return undefined;
  s = s.replace(/^["'「」]|["'」]$/g, '').trim();
  const tail = s.split(/[/\\]/).pop() ?? s;
  const noExt = tail.replace(/\.(png|webp|jpg|jpeg|gif)$/i, '');
  if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(noExt)) return noExt;
  const m = s.match(/(?:person|sprites)(?:[/\\]+)([a-zA-Z0-9_-]+)\.(?:png|webp|jpe?g)/i);
  if (m?.[1]) return m[1];
  return undefined;
}

function pickFallbackSprite(gender: string | undefined, seed: string): string {
  const pool =
    gender === 'female' ? FALLBACK_FEMALE : gender === 'male' ? FALLBACK_MALE : FALLBACK_NEUTRAL;
  const idx = stringHash(seed) % pool.length;
  return pool[idx] ?? 'citizen_01';
}

const SPRITE_TABLE: SpriteEntry[] = [
  {
    files: ['badboy'],
    personalityKeywords: ['叛逆', '反叛', 'rebel', 'rebellious', '调皮', '痞气'],
  },
  {
    files: ['hero_01'],
    personalityKeywords: ['勇敢', '英雄', 'hero', '热血', '正义'],
  },
  {
    files: ['student_01', 'student_02', 'student_03', 'student_04',
            'student_05', 'student_06', 'student_07', 'student_08', 'student_09'],
    personalityKeywords: ['学生', '学习', '活泼', '年轻', '青春', 'student', '元气', '阳光'],
  },
  {
    files: ['suit_01', 'suit_02', 'suit_03', 'suit_04', 'suit_05'],
    personalityKeywords: ['正式', '严肃', '职场', '商务', 'professional', '白领', '沉稳', '冷静'],
  },
  {
    files: ['citizen_01', 'citizen_02', 'citizen_03'],
    personalityKeywords: ['市民', '公民', '普通人', 'normal', '普通'],
  },
];

/**
 * Resolve the sprite base name.
 * Priority: avatar（规范化后）> 性格关键词表 > 按性别池 + 稳定 seed 哈希（避免全员 suit_01）。
 * `extraSeed` 建议传 `agent.profile` 或 `agent.id`，保证同人不同档也稳定区分。
 */
export function resolveSpriteBase(
  avatar: string | undefined,
  gender: string | undefined,
  personality: string | undefined,
  fallbackName: string,
  extraSeed = '',
): string {
  const fromAvatar = normalizeAvatarBase(avatar);
  if (fromAvatar) return fromAvatar;

  const p = personality ?? '';

  // 2. Match by personality keywords
  for (const entry of SPRITE_TABLE) {
    const matched = entry.personalityKeywords.some(
      (kw) => p.includes(kw) || p.toLowerCase().includes(kw.toLowerCase()),
    );
    if (!matched) continue;
    const idx = Math.abs(
      fallbackName.split('').reduce((a, c) => a + c.charCodeAt(0), 0),
    ) % entry.files.length;
    return entry.files[idx];
  }

  // 3. Stable variety by agent identity (not a single gender-default sprite)
  const seed = `${fallbackName}\0${p}\0${gender ?? ''}\0${extraSeed}`;
  return pickFallbackSprite(gender, seed);
}

export function getSpriteFrame(
  avatar: string | undefined,
  gender: string | undefined,
  personality: string | undefined,
  fallbackName: string,
  dir: Direction = 'down',
  frame: number = 0,
  extraSeed = '',
): string {
  const base = resolveSpriteBase(avatar, gender, personality, fallbackName, extraSeed);
  const f = Math.min(Math.max(frame, 0), 2);
  if (SPRITE_ALIGNED_DOWN_BASES.has(base) && dir === 'down') {
    return `${SPRITE_BASE}aligned/${base}_down_${f}.png`;
  }
  return `${SPRITE_BASE}${base}_${dir}_${f}.png`;
}

/** 根目录散图 URL */
export function getSpriteSliceUrl(base: string, dir: Direction, frame: number): string {
  const f = Math.min(Math.max(frame, 0), 2);
  return `${SPRITE_BASE}${base}_${dir}_${f}.png`;
}

/** 3×4 雪碧行索引：down / idle →0，left→1，right→2，up→3 */
export function spriteSheetRow(dir: Direction): number {
  switch (dir) {
    case 'down':
    case 'idle':
      return 0;
    case 'left':
      return 1;
    case 'right':
      return 2;
    case 'up':
      return 3;
    default:
      return 0;
  }
}

export function getSpritePath(
  avatar: string | undefined,
  gender: string | undefined,
  personality: string | undefined,
  fallbackName: string,
  extraSeed = '',
): string {
  return getSpriteFrame(avatar, gender, personality, fallbackName, 'down', 0, extraSeed);
}
