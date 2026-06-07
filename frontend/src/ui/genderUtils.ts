/** Pure functions — no React dependency. */

export function genderEmoji(g: string | undefined): string {
  const x = (g || '').trim().toLowerCase();
  if (x === 'female' || x === 'f' || x === '女') return '👩';
  if (x === 'male' || x === 'm' || x === '男') return '👨';
  if (x === 'random') return '🎲';
  return '⚧';
}

export function genderTitle(g: string | undefined): string {
  const x = (g || '').trim().toLowerCase();
  if (x === 'female' || x === 'f' || x === '女') return '性别：女';
  if (x === 'male' || x === 'm' || x === '男') return '性别：男';
  if (x === 'random') return '性别：随机';
  return x ? `性别：${g}` : '性别：未设置';
}
