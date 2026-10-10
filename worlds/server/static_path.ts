import * as path from 'path';

export function staticClientPath(dist: string, url: string):
  { ok: true; file: string; urlPath: string } | { ok: false; status: 400 | 403 } {
  let urlPath: string;
  try { urlPath = decodeURIComponent(url.split('?')[0]); }
  catch { return { ok: false, status: 400 }; }
  if (urlPath.includes('\0')) return { ok: false, status: 400 };
  if (!urlPath.startsWith('/')) return { ok: false, status: 400 };
  if (urlPath === '/') urlPath = '/index.html';
  const root = path.resolve(dist), file = path.resolve(root, `.${urlPath}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) return { ok: false, status: 403 };
  return { ok: true, file, urlPath };
}
