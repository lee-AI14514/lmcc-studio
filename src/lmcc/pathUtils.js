/**
 * Small path helpers for the renderer (no Node `path` module available).
 * All `.lmcc` relative paths use `/`; absolute filesystem paths may use either
 * separator depending on the platform.
 */
export function toPosixPath(value) {
  return String(value ?? '').replace(/\\/g, '/');
}

export function basenameOf(value) {
  const posix = toPosixPath(value).replace(/\/+$/, '');
  const index = posix.lastIndexOf('/');
  return index === -1 ? posix : posix.slice(index + 1);
}

export function dirnameOf(value) {
  const posix = toPosixPath(value).replace(/\/+$/, '');
  const index = posix.lastIndexOf('/');
  if (index === -1) return '.';
  if (index === 0) return '/';
  return posix.slice(0, index);
}

export function joinAbsolute(base, relativePath) {
  const normalizedBase = toPosixPath(base).replace(/\/+$/, '');
  const normalizedRelative = toPosixPath(relativePath).replace(/^\/+/, '');
  if (!normalizedBase) return normalizedRelative;
  return `${normalizedBase}/${normalizedRelative}`;
}

/**
 * Resolve `src` against `baseDir` and return a root-relative path.
 * Returns null when the path escapes the question root.
 */
export function resolveRootRelative(baseDir, src) {
  const cleanedSrc = toPosixPath(src)
    .split('#')[0]
    .split('?')[0]
    .trim();
  if (!cleanedSrc) return null;

  const combined = cleanedSrc.startsWith('/')
    ? cleanedSrc.replace(/^\/+/, '')
    : [toPosixPath(baseDir), cleanedSrc].filter(Boolean).join('/');

  const stack = [];
  for (const segment of combined.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!stack.length) return null;
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.length ? stack.join('/') : null;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function extensionOf(value) {
  const name = basenameOf(value);
  const index = name.lastIndexOf('.');
  return index <= 0 ? '' : name.slice(index).toLowerCase();
}
