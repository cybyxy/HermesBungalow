/** Vite `public/` 资源 URL（支持 `base` 非 `/` 的部署）。 */
export function publicAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL;
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const path = relativePath.replace(/^\//, '');
  return `${normalizedBase}${path}`;
}
