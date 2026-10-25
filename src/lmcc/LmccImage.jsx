import React, { useEffect, useMemo, useState } from 'react';
import { resolveRootRelative } from './pathUtils';

const imageCache = new Map();

function isRemoteImage(src) {
  return /^https?:\/\//i.test(src);
}

function isInlineImage(src) {
  return /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|svg\+xml);base64,/i.test(
    src
  );
}

function readLocalImage(root, relativePath) {
  const key = `${root}\u0000${relativePath}`;
  if (imageCache.has(key)) return Promise.resolve(imageCache.get(key));
  if (!window.lmcc?.readImage) {
    return Promise.resolve({
      ok: false,
      message: '当前环境不支持读取本地图片。',
    });
  }
  return window.lmcc
    .readImage(root, relativePath)
    .then((result) => {
      if (result?.ok) {
        const value = {
          ok: true,
          mime: result.mime,
          dataBase64: result.dataBase64,
        };
        imageCache.set(key, value);
        return value;
      }
      return result || { ok: false, message: '图片读取失败。' };
    })
    .catch(() => ({ ok: false, message: '图片读取失败。' }));
}

export default function LmccImage({ src, alt, root, baseDir }) {
  const remote = isRemoteImage(src);
  const inline = isInlineImage(src);
  const [state, setState] = useState({ status: 'loading' });
  const resolvedPath = useMemo(
    () => resolveRootRelative(baseDir, src),
    [baseDir, src]
  );

  useEffect(() => {
    let alive = true;

    if (remote || inline) {
      setState({ status: 'ready', url: src });
      return () => {
        alive = false;
      };
    }

    if (!root || !resolvedPath) {
      setState({ status: 'error', message: '无法解析图片路径。' });
      return () => {
        alive = false;
      };
    }

    setState({ status: 'loading' });
    readLocalImage(root, resolvedPath).then((result) => {
      if (!alive) return;
      if (result?.ok) {
        setState({
          status: 'ready',
          url: `data:${result.mime};base64,${result.dataBase64}`,
        });
      } else {
        setState({
          status: 'error',
          message: result?.message || '图片未能加载。',
        });
      }
    });

    return () => {
      alive = false;
    };
  }, [src, root, resolvedPath, remote, inline]);

  // Remote and inline images need no bridge round-trip: render them straight
  // away instead of flashing a loading placeholder.
  const effectiveState =
    (remote || inline) && state.status !== 'error'
      ? { status: 'ready', url: src }
      : state;

  if (effectiveState.status === 'loading') {
    return (
      <span className="lmcc-md-image lmcc-md-image-loading" role="img" aria-label={alt || '图片'}>
        <span className="lmcc-md-image-shimmer" />
        <span className="lmcc-md-image-label">{alt || '正在加载图片…'}</span>
      </span>
    );
  }

  if (effectiveState.status === 'error') {
    return (
      <span className="lmcc-md-image-missing" title={effectiveState.message}>
        图片未能加载：{src}
        {alt ? `（${alt}）` : ''}
      </span>
    );
  }

  return (
    <span className="lmcc-md-image">
      <img
        src={effectiveState.url}
        alt={alt || ''}
        loading="lazy"
        draggable={false}
        onError={() =>
          setState({ status: 'error', message: '图片加载失败。' })
        }
      />
      {alt ? <span className="lmcc-md-image-caption">{alt}</span> : null}
    </span>
  );
}
