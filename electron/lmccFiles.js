/**
 * File access for `.lmcc` question files.
 *
 * The renderer parses the question itself; this module is the only place that
 * touches the filesystem for statements, answer-file status, images and the
 * native "open question" dialog. Every relative path is resolved segment by
 * segment (checkedPath), so a symlink can never escape the question root.
 */
const { dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_STAT_PATHS = 1000;
const MAX_RELATIVE_PATH_LENGTH = 512;

const IMAGE_MIME_BY_EXTENSION = {
  '.png': 'image/png',
  '.apng': 'image/apng',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

let registered = false;

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function pathFailure(rel, code, message) {
  return failure(code, message, { path: rel });
}

function mb(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function isAbsoluteFilePath(value) {
  return typeof value === 'string' && value.length > 0 && path.isAbsolute(value);
}

async function realDirectory(directoryPath) {
  if (!isAbsoluteFilePath(directoryPath)) {
    return failure('unsafe-root', '题目目录无效。');
  }
  let real;
  try {
    real = await fs.promises.realpath(directoryPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return failure('missing-root', '题目目录不存在。');
    }
    return failure('io', '无法访问题目目录。');
  }
  try {
    const stat = await fs.promises.stat(real);
    if (!stat.isDirectory()) {
      return failure('not-directory', '题目路径不是目录。');
    }
  } catch {
    return failure('io', '无法访问题目目录。');
  }
  return { ok: true, directory: real };
}

async function resolveWithinRoot(rootReal, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length < 1 ||
    relativePath.length > MAX_RELATIVE_PATH_LENGTH ||
    relativePath.includes('\\') ||
    relativePath.includes('\u0000')
  ) {
    return pathFailure(
      String(relativePath),
      'unsafe',
      `不支持的相对文件路径：${relativePath}`
    );
  }

  const segments = relativePath.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      return pathFailure(
        relativePath,
        'unsafe',
        `不支持的相对文件路径：${relativePath}`
      );
    }
  }

  let current = rootReal;
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
    const relativeToRoot = path.relative(rootReal, current);
    if (
      relativeToRoot === '' ||
      relativeToRoot.startsWith('..') ||
      path.isAbsolute(relativeToRoot)
    ) {
      return pathFailure(
        relativePath,
        'unsafe',
        `不支持的相对文件路径：${relativePath}`
      );
    }

    let stat;
    try {
      stat = await fs.promises.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return pathFailure(
          relativePath,
          'missing',
          `路径不存在：${relativePath}`
        );
      }
      return pathFailure(relativePath, 'io', `无法访问：${relativePath}`);
    }

    if (stat.isSymbolicLink()) {
      return pathFailure(
        relativePath,
        'symlink',
        `不支持链接路径：${relativePath}`
      );
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      return pathFailure(relativePath, 'missing', `路径不存在：${relativePath}`);
    }
    if (index === segments.length - 1) {
      return { ok: true, absolute: current, stat, relative: relativePath };
    }
  }

  return pathFailure(
    relativePath,
    'unsafe',
    `不支持的相对文件路径：${relativePath}`
  );
}

async function readUtf8File(absolutePath, maxBytes, displayPath) {
  let stat;
  try {
    stat = await fs.promises.stat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return pathFailure(displayPath, 'missing', `文件不存在：${displayPath}`);
    }
    return pathFailure(displayPath, 'io', `无法读取文件：${displayPath}`);
  }

  if (!stat.isFile()) {
    return pathFailure(displayPath, 'not-file', `不是普通文件：${displayPath}`);
  }
  if (stat.size > maxBytes) {
    return pathFailure(
      displayPath,
      'too-large',
      `文件超过读取上限（${mb(maxBytes)}）：${displayPath}`
    );
  }

  let buffer;
  try {
    buffer = await fs.promises.readFile(absolutePath);
  } catch {
    return pathFailure(displayPath, 'io', `无法读取文件：${displayPath}`);
  }
  if (buffer.length > maxBytes) {
    return pathFailure(
      displayPath,
      'too-large',
      `文件超过读取上限（${mb(maxBytes)}）：${displayPath}`
    );
  }

  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return pathFailure(
      displayPath,
      'encoding',
      `文件不是有效的 UTF-8 文本：${displayPath}`
    );
  }

  return {
    ok: true,
    content,
    size: buffer.length,
    mtimeMs: stat.mtimeMs,
  };
}

async function readSourceFile(filePath) {
  if (!isAbsoluteFilePath(filePath)) {
    return failure('unsafe', '题目文件路径无效。');
  }

  let realPath;
  try {
    realPath = await fs.promises.realpath(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return failure('missing', '题目文件不存在。');
    }
    return failure('io', '无法读取题目文件。');
  }

  if (path.extname(realPath).toLowerCase() !== '.lmcc') {
    return failure('not-lmcc', '请选择 .lmcc 题目文件。');
  }

  const read = await readUtf8File(realPath, MAX_SOURCE_BYTES, path.basename(realPath));
  if (!read.ok) return read;

  return {
    ok: true,
    filePath: realPath,
    root: path.dirname(realPath),
    fileName: path.basename(realPath),
    content: read.content,
    size: read.size,
    mtimeMs: read.mtimeMs,
  };
}

async function pickQuestionFile() {
  const result = await dialog.showOpenDialog({
    title: '打开 .lmcc 题目文件',
    buttonLabel: '打开题目',
    properties: ['openFile'],
    filters: [
      { name: 'LMCC 题目文件', extensions: ['lmcc'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: true, canceled: true };
  }
  return readSourceFile(result.filePaths[0]);
}

async function readQuestionText(payload) {
  const { root, rel, maxBytes } = payload || {};
  const rootResult = await realDirectory(root);
  if (!rootResult.ok) return rootResult;

  const resolved = await resolveWithinRoot(rootResult.directory, rel);
  if (!resolved.ok) return resolved;
  if (!resolved.stat.isFile()) {
    return pathFailure(rel, 'not-file', `不是普通文件：${rel}`);
  }

  const limit = Math.min(
    Number.isInteger(maxBytes) && maxBytes > 0 ? maxBytes : MAX_TEXT_BYTES,
    MAX_TEXT_BYTES
  );
  const read = await readUtf8File(resolved.absolute, limit, rel);
  if (!read.ok) return read;
  return {
    ok: true,
    content: read.content,
    size: read.size,
    mtimeMs: read.mtimeMs,
  };
}

async function statQuestionPaths(payload) {
  const { root, rels } = payload || {};
  if (!Array.isArray(rels) || rels.length > MAX_STAT_PATHS) {
    return failure('invalid', '检查的路径列表无效。');
  }
  const rootResult = await realDirectory(root);
  if (!rootResult.ok) return rootResult;

  const entries = await Promise.all(
    rels.map(async (rel) => {
      if (typeof rel !== 'string') {
        return { rel: String(rel), state: 'unsafe', message: '路径无效。' };
      }
      const resolved = await resolveWithinRoot(rootResult.directory, rel);
      if (!resolved.ok) {
        return {
          rel,
          state: resolved.code === 'symlink' ? 'symlink' : resolved.code,
          message: resolved.message,
        };
      }
      const { stat } = resolved;
      const state = stat.isDirectory()
        ? 'directory'
        : stat.isFile()
        ? 'file'
        : 'other';
      return {
        rel,
        state,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        message: null,
      };
    })
  );

  return { ok: true, root: rootResult.directory, entries };
}

async function readQuestionImage(payload) {
  const { root, rel } = payload || {};
  const rootResult = await realDirectory(root);
  if (!rootResult.ok) return rootResult;

  const resolved = await resolveWithinRoot(rootResult.directory, rel);
  if (!resolved.ok) return resolved;
  if (!resolved.stat.isFile()) {
    return pathFailure(rel, 'not-file', `不是普通文件：${rel}`);
  }

  const extension = path.extname(resolved.absolute).toLowerCase();
  const mime = IMAGE_MIME_BY_EXTENSION[extension];
  if (!mime) {
    return pathFailure(rel, 'unsupported', `不支持的图片格式：${rel}`);
  }
  if (resolved.stat.size > MAX_IMAGE_BYTES) {
    return pathFailure(
      rel,
      'too-large',
      `图片超过读取上限（${mb(MAX_IMAGE_BYTES)}）：${rel}`
    );
  }

  let buffer;
  try {
    buffer = await fs.promises.readFile(resolved.absolute);
  } catch {
    return pathFailure(rel, 'io', `无法读取图片：${rel}`);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return pathFailure(rel, 'too-large', `图片超过读取上限：${rel}`);
  }

  return {
    ok: true,
    mime,
    size: buffer.length,
    dataBase64: buffer.toString('base64'),
  };
}

async function openExternalLink(url) {
  if (typeof url !== 'string' || url.length > 4096) {
    return failure('unsafe-url', '不支持的链接。');
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return failure('unsafe-url', '不支持的链接。');
  }
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    return failure('unsafe-url', '不支持的链接。');
  }
  try {
    await shell.openExternal(parsed.toString());
    return { ok: true };
  } catch {
    return failure('io', '无法打开链接。');
  }
}

function registerLmccIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle('lmcc:pick-file', () => pickQuestionFile());
  ipcMain.handle('lmcc:read-source', (event, filePath) =>
    readSourceFile(filePath)
  );
  ipcMain.handle('lmcc:read-text', (event, payload) =>
    readQuestionText(payload)
  );
  ipcMain.handle('lmcc:stat-paths', (event, payload) =>
    statQuestionPaths(payload)
  );
  ipcMain.handle('lmcc:read-image', (event, payload) =>
    readQuestionImage(payload)
  );
  ipcMain.handle('lmcc:open-external', (event, url) =>
    openExternalLink(url)
  );
}

module.exports = {
  registerLmccIpc,
  // exported for tests / reuse
  resolveWithinRoot,
  readSourceFile,
  realDirectory,
  MAX_SOURCE_BYTES,
  MAX_TEXT_BYTES,
  MAX_IMAGE_BYTES,
};
