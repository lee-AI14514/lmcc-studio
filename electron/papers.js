/**
 * The local "paper library" (试卷库).
 *
 * Every immediate directory under `~/.lmcc-studio` is one paper. A paper is
 * recognized by at least one root-level `*.lmcc` question file; a paper that
 * was extracted from a ZIP with a single top-level directory is also accepted
 * by looking one level down (the same auto-strip rule used by the importer).
 *
 * This module only gathers raw data. The `.lmcc` parser and all paper-level
 * checks live in the renderer, so there is exactly one implementation of the
 * question format. Every filesystem path is resolved under the library root,
 * symlinked paper folders/files are refused, and reads are bounded.
 */
const { ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PAPERS_DIRECTORY_NAME = '.lmcc-studio';
const MAX_PAPERS = 200;
const MAX_QUESTIONS_PER_PAPER = 500;
const MAX_QUESTION_BYTES = 32 * 1024 * 1024;
const MAX_QUESTION_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_META_BYTES = 1 * 1024 * 1024;
const MAX_ID_LENGTH = 200;
const MAX_SESSION_SCAN_ENTRIES = 4000;
const MAX_SESSION_SCAN_DEPTH = 5;
const IGNORED_DIRS = new Set(['node_modules', '.git', 'build', 'dist']);
const SKIPPED_LIBRARY_DIRS = new Set(['.git', 'node_modules']);

let registered = false;
let activePaperId = null;

function papersRoot() {
  return path.join(os.homedir(), PAPERS_DIRECTORY_NAME);
}

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function isSafePaperId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    value !== '.' &&
    value !== '..' &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes('\u0000')
  );
}

function isLmccName(name) {
  return /\.lmcc$/i.test(name);
}

function displayPath(absolutePath, root) {
  const relative = path.relative(root, absolutePath);
  return relative && !relative.startsWith('..')
    ? relative.split(path.sep).join('/')
    : absolutePath;
}

async function ensurePapersRoot() {
  const root = papersRoot();
  try {
    await fs.promises.mkdir(root, { recursive: true });
    const stat = await fs.promises.stat(root);
    if (!stat.isDirectory()) {
      return failure('not-directory', '试卷目录不是文件夹。');
    }
    return { ok: true, root };
  } catch (error) {
    if (error.code === 'EACCES' || error.code === 'EPERM') {
      return failure('permission', '无法访问题卷目录。');
    }
    return failure('io', '无法访问题卷目录。');
  }
}

async function readDirectoryEntries(directory) {
  try {
    return await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function sortByName(left, right) {
  return left.name.localeCompare(right.name, 'zh-CN', {
    numeric: true,
    sensitivity: 'base',
  });
}

async function readUtf8File(filePath, maxBytes) {
  let stat;
  try {
    stat = await fs.promises.lstat(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { state: 'missing', path: filePath };
    }
    return { state: 'error', path: filePath, message: '无法读取文件。' };
  }

  if (stat.isSymbolicLink()) {
    return {
      state: 'error',
      path: filePath,
      message: '不支持链接路径。',
    };
  }
  if (!stat.isFile()) {
    return {
      state: 'error',
      path: filePath,
      message: '不是普通文件。',
    };
  }
  if (stat.size > maxBytes) {
    return {
      state: 'error',
      path: filePath,
      message: `文件超过读取上限（${Math.round(
        maxBytes / (1024 * 1024)
      )} MB）。`,
      size: stat.size,
    };
  }

  let buffer;
  try {
    buffer = await fs.promises.readFile(filePath);
  } catch {
    return { state: 'error', path: filePath, message: '无法读取文件。' };
  }
  if (buffer.length > maxBytes) {
    return {
      state: 'error',
      path: filePath,
      message: `文件超过读取上限（${Math.round(
        maxBytes / (1024 * 1024)
      )} MB）。`,
      size: buffer.length,
    };
  }

  try {
    return {
      state: 'ready',
      path: filePath,
      text: new TextDecoder('utf-8', { fatal: true }).decode(buffer),
      size: buffer.length,
      mtimeMs: stat.mtimeMs,
    };
  } catch {
    return {
      state: 'error',
      path: filePath,
      message: '文件不是有效的 UTF-8 文本。',
      size: stat.size,
    };
  }
}

async function listRootQuestionEntries(directory) {
  const entries = await readDirectoryEntries(directory);
  const questions = [];
  const skipped = [];

  for (const entry of entries) {
    if (!isLmccName(entry.name)) continue;
    if (entry.isFile()) {
      questions.push(entry);
    } else if (entry.isSymbolicLink()) {
      skipped.push({
        code: 'PAPER_SYMLINK',
        message: `跳过符号链接题目文件：${entry.name}`,
      });
    }
  }

  questions.sort(sortByName);
  return { entries, questions, skipped };
}

/**
 * Find the effective paper root. Root-level `.lmcc` files win; a folder with
 * exactly one child directory is accepted as the ZIP "single top-level
 * directory" layout.
 */
async function detectPaperRoot(folder) {
  const rootScan = await listRootQuestionEntries(folder);
  if (rootScan.questions.length > 0) {
    return {
      ok: true,
      root: folder,
      nested: false,
      questionEntries: rootScan.questions,
      entries: rootScan.entries,
      warnings: rootScan.skipped,
    };
  }

  const directories = rootScan.entries.filter(
    (entry) => entry.isDirectory() && !entry.isSymbolicLink()
  );
  if (rootScan.entries.length === 1 && directories.length === 1) {
    const child = path.join(folder, directories[0].name);
    const childScan = await listRootQuestionEntries(child);
    if (childScan.questions.length > 0) {
      return {
        ok: true,
        root: child,
        nested: true,
        questionEntries: childScan.questions,
        entries: childScan.entries,
        warnings: [...rootScan.skipped, ...childScan.skipped],
      };
    }
  }

  return {
    ok: false,
    code: 'PAPER_NO_QUESTIONS',
    message: '试卷根目录中没有 .lmcc 题目文件。',
  };
}

async function readPaperMetadata(root) {
  const metaDirectory = path.join(root, '.lmcc');
  let directoryState = 'missing';

  try {
    const stat = await fs.promises.lstat(metaDirectory);
    if (stat.isSymbolicLink()) {
      return {
        directoryState: 'symlink',
        runtime: { state: 'unavailable', path: null },
        contest: { state: 'unavailable', path: null },
        warnings: [
          {
            code: 'PAPER_META_SYMLINK',
            message: '.lmcc 目录是符号链接，已跳过试卷配置读取。',
          },
        ],
      };
    }
    directoryState = stat.isDirectory() ? 'directory' : 'not-directory';
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return {
        directoryState: 'error',
        runtime: { state: 'unavailable', path: null },
        contest: { state: 'unavailable', path: null },
        warnings: [
          {
            code: 'PAPER_META_IO',
            message: '无法读取 .lmcc 试卷配置目录。',
          },
        ],
      };
    }
  }

  if (directoryState !== 'directory') {
    return {
      directoryState,
      runtime: { state: 'missing', path: null },
      contest: { state: 'missing', path: null },
      warnings:
        directoryState === 'not-directory'
          ? [
              {
                code: 'PAPER_META_KIND',
                message: '.lmcc 不是目录，已忽略试卷配置。',
              },
            ]
          : [],
    };
  }

  const runtimePath = path.join(metaDirectory, 'runtime.json');
  const contestPath = path.join(metaDirectory, 'contest.json');
  const [runtime, contest] = await Promise.all([
    readUtf8File(runtimePath, MAX_META_BYTES),
    readUtf8File(contestPath, MAX_META_BYTES),
  ]);

  return {
    directoryState,
    runtime: {
      ...runtime,
      relativePath: '.lmcc/runtime.json',
    },
    contest: {
      ...contest,
      relativePath: '.lmcc/contest.json',
    },
    warnings: [],
  };
}

/**
 * The import pipeline refuses any `session.json` in a package. Local paper
 * folders are allowed to contain one (the IDE writes it), but it should never
 * be distributed with a paper, so surface it as a warning.
 */
async function findSessionFiles(root) {
  const found = [];
  const queue = [{ directory: root, depth: 0 }];
  let visited = 0;
  let truncated = false;

  while (queue.length > 0) {
    if (visited >= MAX_SESSION_SCAN_ENTRIES) {
      truncated = true;
      break;
    }
    const current = queue.shift();
    let entries;
    try {
      entries = await fs.promises.readdir(current.directory, {
        withFileTypes: true,
      });
    } catch {
      continue;
    }

    for (const entry of entries) {
      visited += 1;
      if (visited > MAX_SESSION_SCAN_ENTRIES) {
        truncated = true;
        break;
      }
      if (entry.isSymbolicLink()) continue;

      const fullPath = path.join(current.directory, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === 'session.json') {
        found.push(displayPath(fullPath, root));
      } else if (
        entry.isDirectory() &&
        current.depth < MAX_SESSION_SCAN_DEPTH &&
        !IGNORED_DIRS.has(entry.name)
      ) {
        queue.push({ directory: fullPath, depth: current.depth + 1 });
      }
    }
  }

  return { files: found, truncated };
}

async function readPaperFolder(id) {
  if (!isSafePaperId(id)) {
    return failure('invalid-id', '试卷名称无效。', { id: String(id) });
  }

  const root = papersRoot();
  const folder = path.join(root, id);
  let folderStat;
  try {
    folderStat = await fs.promises.lstat(folder);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return failure('missing', '试卷不存在。', { id, name: id, path: folder });
    }
    return failure('io', '无法访问题卷目录。', { id, name: id, path: folder });
  }

  if (folderStat.isSymbolicLink()) {
    return failure('symlink', '试卷目录不能是符号链接。', {
      id,
      name: id,
      path: folder,
    });
  }
  if (!folderStat.isDirectory()) {
    return failure('not-directory', '试卷路径不是目录。', {
      id,
      name: id,
      path: folder,
    });
  }

  let detected;
  try {
    detected = await detectPaperRoot(folder);
  } catch {
    return failure('io', '无法读取试卷目录。', { id, name: id, path: folder });
  }

  if (!detected.ok) {
    return failure(detected.code, detected.message, {
      id,
      name: id,
      path: folder,
      questions: [],
      warnings: [],
    });
  }

  const { root: paperRoot, nested, questionEntries } = detected;
  const warnings = [...(detected.warnings || [])];
  if (nested) {
    warnings.push({
      code: 'PAPER_NESTED_ROOT',
      severity: 'info',
      message: `检测到单一顶层目录，已使用 ${path.basename(
        paperRoot
      )} 作为试卷根目录。`,
    });
  }

  const metadata = await readPaperMetadata(paperRoot);
  warnings.push(...(metadata.warnings || []));

  const legacyContest = path.join(paperRoot, '.lmcc-contest.json');
  try {
    const legacyStat = await fs.promises.lstat(legacyContest);
    if (legacyStat.isFile()) {
      warnings.push({
        code: 'PAPER_LEGACY_CONTEST',
        message: '发现旧式试卷归属文件 .lmcc-contest.json。',
      });
    }
  } catch {
    // absent is the normal case
  }

  const sessionScan = await findSessionFiles(paperRoot);
  if (sessionScan.files.length > 0) {
    warnings.push({
      code: 'PAPER_SESSION',
      message: `试卷包含登录会话文件：${sessionScan.files.join(
        '、'
      )}。分发试卷前请移除。`,
    });
  }
  if (sessionScan.truncated) {
    warnings.push({
      code: 'PAPER_SESSION_SCAN_TRUNCATED',
      message: '登录会话文件扫描达到上限，可能还有未检查的目录。',
    });
  }

  const questions = [];
  let totalBytes = 0;
  for (const entry of questionEntries) {
    if (questions.length >= MAX_QUESTIONS_PER_PAPER) {
      warnings.push({
        code: 'PAPER_TOO_MANY_QUESTIONS',
        message: `一个试卷最多读取 ${MAX_QUESTIONS_PER_PAPER} 个 .lmcc 文件。`,
      });
      break;
    }

    const filePath = path.join(paperRoot, entry.name);
    let fileStat;
    try {
      fileStat = await fs.promises.lstat(filePath);
    } catch {
      questions.push({
        fileName: entry.name,
        filePath,
        size: 0,
        content: '',
        readError: '无法读取题目文件。',
      });
      continue;
    }

    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      warnings.push({
        code: 'PAPER_SYMLINK',
        message: `跳过符号链接题目文件：${entry.name}`,
      });
      continue;
    }

    if (fileStat.size > MAX_QUESTION_BYTES) {
      questions.push({
        fileName: entry.name,
        filePath,
        size: fileStat.size,
        content: '',
        readError: '题目文件超过读取上限（32 MB）。',
      });
      continue;
    }

    if (totalBytes + fileStat.size > MAX_QUESTION_TOTAL_BYTES) {
      warnings.push({
        code: 'PAPER_TOTAL_BYTES',
        message: '试卷的题目文件总大小超过读取上限，剩余题目未读取。',
      });
      break;
    }

    const read = await readUtf8File(filePath, MAX_QUESTION_BYTES);
    if (read.state !== 'ready') {
      questions.push({
        fileName: entry.name,
        filePath,
        size: fileStat.size,
        content: '',
        readError: read.message || '无法读取题目文件。',
      });
      continue;
    }

    totalBytes += read.size;
    questions.push({
      fileName: entry.name,
      filePath,
      size: read.size,
      content: read.text,
      mtimeMs: read.mtimeMs,
    });
  }

  return {
    ok: true,
    id,
    name: id,
    path: folder,
    root: paperRoot,
    nested,
    questions,
    runtime: metadata.runtime,
    contest: metadata.contest,
    warnings,
    meta: {
      questionCount: questions.length,
      questionBytes: totalBytes,
      questionLimit: MAX_QUESTIONS_PER_PAPER,
    },
  };
}

async function listPapers() {
  const rootResult = await ensurePapersRoot();
  if (!rootResult.ok) return rootResult;

  const root = rootResult.root;
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return failure('io', '无法读取试卷目录。', { root, papers: [] });
  }

  const folders = entries
    .filter(
      (entry) =>
        entry.isDirectory() &&
        !entry.isSymbolicLink() &&
        !SKIPPED_LIBRARY_DIRS.has(entry.name)
    )
    .sort(sortByName);

  const truncated = folders.length > MAX_PAPERS;
  const papers = [];
  for (const folder of folders.slice(0, MAX_PAPERS)) {
    papers.push(await readPaperFolder(folder.name));
  }

  if (
    !activePaperId ||
    !papers.some((paper) => paper.id === activePaperId)
  ) {
    const firstValid = papers.find((paper) => paper.ok);
    activePaperId = firstValid?.id ?? papers[0]?.id ?? null;
  }

  return {
    ok: true,
    root,
    activeId: activePaperId,
    papers,
    truncated,
  };
}

async function activatePaper(id) {
  if (!isSafePaperId(id)) {
    return failure('invalid-id', '试卷名称无效。', { papers: [] });
  }

  const result = await listPapers();
  if (!result.ok) return result;

  const paper = result.papers.find((item) => item.id === id);
  if (!paper) {
    return failure('missing', '试卷不存在。', {
      ...result,
      papers: result.papers,
    });
  }

  activePaperId = id;
  return {
    ...result,
    activeId: activePaperId,
    paper,
  };
}

async function getWorkspaceRoot() {
  const result = await listPapers();
  if (!result.ok) return result.root || papersRoot();
  const active = result.papers.find((paper) => paper.id === result.activeId);
  return active?.root || active?.path || result.root;
}

function registerPapersIpc() {
  if (registered) return;
  registered = true;

  ipcMain.handle('papers:list', () => listPapers());
  ipcMain.handle('papers:activate', (event, id) => activatePaper(id));
  ipcMain.handle('papers:root', () => papersRoot());
}

module.exports = {
  registerPapersIpc,
  listPapers,
  activatePaper,
  getWorkspaceRoot,
  papersRoot,
  // exported for tests / reuse
  detectPaperRoot,
  readPaperFolder,
  MAX_QUESTIONS_PER_PAPER,
  MAX_QUESTION_BYTES,
};
