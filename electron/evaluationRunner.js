/**
 * Local evaluation process runner.
 *
 * A paper may declare a Python evaluator in `localTest.script` (or
 * `evaluationCode`). The renderer never executes the script itself: it sends
 * the question root and the declared relative path to this module, which
 * validates that the script stays inside the root (rejecting symlinks), then
 * spawns Python without a shell and streams stdout/stderr back as events.
 *
 * This module deliberately has no Electron dependency so the process
 * lifecycle can be exercised independently of the IPC layer.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { StringDecoder } = require('string_decoder');

const MAX_SCRIPT_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 10 * 60 * 1000;
const KILL_GRACE_MS = 1500;
const MAX_RELATIVE_PATH_LENGTH = 512;
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;

/** runId -> active run state */
const runs = new Map();

function failure(code, message, extra = {}) {
  return { ok: false, code, message, ...extra };
}

function mb(bytes) {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function optionalString(value, maxLength = 200) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000\r\n]/g, '').slice(0, maxLength);
}

function timeoutFromEnvironment() {
  const configured = Number(process.env.LMCC_EVALUATION_TIMEOUT_MS);
  if (Number.isFinite(configured) && configured >= 1000) {
    return Math.min(Math.floor(configured), MAX_TIMEOUT_MS);
  }
  return DEFAULT_TIMEOUT_MS;
}

function buildPythonCandidates(runtimeId) {
  const override = process.env.LMCC_PYTHON;
  if (typeof override === 'string' && override.trim()) {
    return [override.trim()];
  }

  const candidates = [];
  const version = /python[\s_-]*(\d+\.\d+)/i.exec(
    typeof runtimeId === 'string' ? runtimeId : ''
  );
  if (version) candidates.push(`python${version[1]}`);
  candidates.push('python3');

  if (process.platform === 'win32') {
    candidates.push('python');
    candidates.push('py');
  } else {
    candidates.push('python');
  }

  return [...new Set(candidates)];
}

async function realDirectory(root) {
  if (
    typeof root !== 'string' ||
    !root ||
    root.length > 4096 ||
    root.includes('\u0000') ||
    !path.isAbsolute(root)
  ) {
    return failure('unsafe-root', '题目目录无效。');
  }

  let real;
  try {
    real = await fs.promises.realpath(root);
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

async function resolveEvaluationScript(rootReal, relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length < 1 ||
    relativePath.length > MAX_RELATIVE_PATH_LENGTH ||
    relativePath.includes('\\') ||
    relativePath.includes('\u0000')
  ) {
    return failure('unsafe-script', '评测脚本路径无效。');
  }

  const segments = relativePath.split('/');
  if (
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..'
    )
  ) {
    return failure('unsafe-script', '评测脚本路径无效。');
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
      return failure('unsafe-script', '评测脚本必须位于题目目录内。');
    }

    let stat;
    try {
      stat = await fs.promises.lstat(current);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return failure('missing-script', `评测脚本不存在：${relativePath}`);
      }
      return failure('io', `无法访问评测脚本：${relativePath}`);
    }

    if (stat.isSymbolicLink()) {
      return failure('symlink-script', `不支持链接评测脚本：${relativePath}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      return failure('missing-script', `评测脚本不存在：${relativePath}`);
    }
    if (index === segments.length - 1) {
      if (!stat.isFile()) {
        return failure('not-file', `评测脚本不是普通文件：${relativePath}`);
      }
      if (stat.size > MAX_SCRIPT_BYTES) {
        return failure(
          'script-too-large',
          `评测脚本超过上限（${mb(MAX_SCRIPT_BYTES)}）：${relativePath}`
        );
      }
    }
  }

  return { ok: true, absolute: current, relative: relativePath };
}

function spawnCandidate(command, args, options) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, options);
    } catch (error) {
      resolve({ ok: false, code: error.code || 'spawn', error });
      return;
    }

    let settled = false;
    const cleanup = () => {
      child.off('spawn', onSpawn);
      child.off('error', onError);
    };
    const onSpawn = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ ok: true, child });
    };
    const onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        child.kill();
      } catch {
        // the process never started
      }
      resolve({ ok: false, code: error.code || 'spawn', error });
    };

    child.once('spawn', onSpawn);
    child.once('error', onError);
  });
}

function signalProcess(child, signal) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  if (process.platform === 'win32') {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // already gone
    }
  }
}

function emit(onEvent, event) {
  try {
    onEvent(event);
  } catch {
    // A closed renderer must not break process cleanup.
  }
}

function appendOutput(run, stream, chunk) {
  if (run.finished || run.truncated) return;

  run.outputBytes += chunk.length;
  if (run.outputBytes > MAX_OUTPUT_BYTES) {
    run.truncated = true;
    run.stopReason = run.stopReason || 'output-limit';
    clearTimeout(run.timeoutTimer);
    emit(run.onEvent, {
      type: 'system',
      runId: run.runId,
      tone: 'error',
      message: `输出超过 ${mb(MAX_OUTPUT_BYTES)}，已停止评测。`,
    });
    signalProcess(run.child, 'SIGTERM');
    run.killTimer = setTimeout(() => {
      if (!run.finished) signalProcess(run.child, 'SIGKILL');
    }, KILL_GRACE_MS);
    return;
  }

  const text = run.decoders[stream].write(chunk);
  if (text) {
    emit(run.onEvent, {
      type: 'output',
      runId: run.runId,
      stream,
      text,
    });
  }
}

function finishRun(run, code, signal) {
  if (run.finished) return;
  run.finished = true;
  clearTimeout(run.timeoutTimer);
  clearTimeout(run.killTimer);

  for (const stream of ['stdout', 'stderr']) {
    const text = run.decoders[stream].end();
    if (text && !run.truncated) {
      emit(run.onEvent, {
        type: 'output',
        runId: run.runId,
        stream,
        text,
      });
    }
  }

  // The evaluator is the leader of its own process group. If it spawned
  // background helpers, do not leave them running after the script exits.
  if (process.platform !== 'win32' && run.child?.pid) {
    try {
      process.kill(-run.child.pid, 'SIGTERM');
    } catch {
      // the group is already gone
    }
  }

  const durationMs = Date.now() - run.startedAt;
  emit(run.onEvent, {
    type: 'exit',
    runId: run.runId,
    code: typeof code === 'number' ? code : null,
    signal: signal || null,
    durationMs,
    outputBytes: run.outputBytes,
    truncated: run.truncated,
    stopped: run.stopReason || null,
  });
  runs.delete(run.runId);
}

function stopRun(run, reason, { silent = false } = {}) {
  if (!run || run.finished) return false;
  run.stopReason = run.stopReason || reason;
  if (!silent) {
    emit(run.onEvent, {
      type: 'system',
      runId: run.runId,
      tone: 'warning',
      message:
        reason === 'timeout'
          ? '评测运行超时，正在停止 Python 进程…'
          : '正在停止评测…',
    });
  }
  signalProcess(run.child, 'SIGTERM');
  clearTimeout(run.killTimer);
  run.killTimer = setTimeout(() => {
    if (!run.finished) signalProcess(run.child, 'SIGKILL');
  }, KILL_GRACE_MS);
  return true;
}

/**
 * Start one evaluator.
 *
 * @param {object} request
 * @param {string} request.runId renderer-generated unique id
 * @param {string} request.root absolute question/paper root
 * @param {string} request.script relative Python path
 * @param {string} [request.questionId]
 * @param {string} [request.questionType]
 * @param {string} [request.questionFile]
 * @param {string} [request.runtimeId]
 * @param {number} [request.timeoutMs]
 * @param {(event: object) => void} onEvent event sink
 */
async function startEvaluation(request, onEvent) {
  if (!request || typeof request !== 'object') {
    return failure('invalid', '评测请求无效。');
  }
  if (typeof onEvent !== 'function') {
    return failure('invalid', '评测事件接收器无效。');
  }

  const runId = request.runId;
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) {
    return failure('invalid-run', '评测运行标识无效。');
  }
  if (runs.has(runId)) {
    return failure('duplicate-run', '该评测正在运行。');
  }

  const rootResult = await realDirectory(request.root);
  if (!rootResult.ok) return rootResult;

  const scriptResult = await resolveEvaluationScript(
    rootResult.directory,
    request.script
  );
  if (!scriptResult.ok) return scriptResult;

  const mode = request.mode === 'demo' ? 'demo' : 'grading';
  const configuredTimeout = Number(request.timeoutMs);
  const timeoutMs =
    Number.isFinite(configuredTimeout) && configuredTimeout >= 1000
      ? Math.min(Math.floor(configuredTimeout), MAX_TIMEOUT_MS)
      : timeoutFromEnvironment();

  const env = {
    ...process.env,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
    LMCC_EVALUATION: '1',
    LMCC_QUESTION_ROOT: rootResult.directory,
    LMCC_EVALUATION_SCRIPT: scriptResult.relative,
    LMCC_QUESTION_ID: optionalString(request.questionId),
    LMCC_QUESTION_TYPE: optionalString(request.questionType),
    LMCC_QUESTION_FILE: optionalString(request.questionFile, 4096),
    LMCC_PROBLEM_FILE: optionalString(request.questionFile, 4096),
    LMCC_RUNTIME_ID: optionalString(request.runtimeId),
  };

  const candidates = buildPythonCandidates(request.runtimeId);
  const scriptDirectory = path.dirname(scriptResult.absolute);
  let child = null;
  let python = null;
  let lastError = null;

  for (const candidate of candidates) {
    const result = await spawnCandidate(
      candidate,
      ['-u', scriptResult.absolute, '--mode', mode],
      {
        cwd: scriptDirectory,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      }
    );
    if (result.ok) {
      child = result.child;
      python = candidate;
      break;
    }
    lastError = result;
    // Only "not installed" / "not executable" justifies trying the next
    // interpreter. Other errors would fail for every candidate.
    if (result.code !== 'ENOENT' && result.code !== 'EACCES') break;
  }

  if (!child) {
    const detail = lastError?.error?.message
      ? `（${lastError.error.message}）`
      : '';
    return failure(
      'python-missing',
      `未找到可用的 Python 3 解释器${detail}。请安装 Python 3，或通过 LMCC_PYTHON 指定解释器路径。`,
      { attempts: candidates }
    );
  }

  const run = {
    runId,
    child,
    python,
    script: scriptResult.relative,
    mode,
    cwd: scriptDirectory,
    timeoutMs,
    startedAt: Date.now(),
    outputBytes: 0,
    truncated: false,
    stopReason: null,
    finished: false,
    onEvent,
    decoders: {
      stdout: new StringDecoder('utf8'),
      stderr: new StringDecoder('utf8'),
    },
    timeoutTimer: null,
    killTimer: null,
  };
  runs.set(runId, run);

  child.stdout.on('data', (chunk) => appendOutput(run, 'stdout', chunk));
  child.stderr.on('data', (chunk) => appendOutput(run, 'stderr', chunk));
  child.on('error', (error) => {
    if (run.finished) return;
    emit(onEvent, {
      type: 'system',
      runId,
      tone: 'error',
      message: `无法启动 Python：${error.message}`,
    });
    run.stopReason = run.stopReason || 'spawn-error';
    finishRun(run, null, null);
  });
  child.on('close', (code, signal) => finishRun(run, code, signal));

  run.timeoutTimer = setTimeout(() => {
    if (!run.finished) stopRun(run, 'timeout');
  }, timeoutMs);

  emit(onEvent, {
    type: 'start',
    runId,
    python,
    script: scriptResult.relative,
    mode,
    cwd: scriptDirectory,
    argv: ['-u', scriptResult.absolute, '--mode', mode],
    startedAt: new Date(run.startedAt).toISOString(),
    timeoutMs,
  });

  return {
    ok: true,
    runId,
    python,
    script: scriptResult.relative,
    mode,
    cwd: scriptDirectory,
    timeoutMs,
  };
}

function stopEvaluation(runId) {
  if (typeof runId !== 'string') {
    return failure('invalid-run', '评测运行标识无效。');
  }
  const run = runs.get(runId);
  if (!run) {
    return failure('not-running', '评测已经结束。');
  }
  stopRun(run, 'stopped');
  return { ok: true, runId };
}

function stopAllEvaluations() {
  for (const run of runs.values()) {
    stopRun(run, 'shutdown', { silent: true });
    signalProcess(run.child, 'SIGKILL');
  }
}

module.exports = {
  startEvaluation,
  stopEvaluation,
  stopAllEvaluations,
  buildPythonCandidates,
  resolveEvaluationScript,
  realDirectory,
  MAX_SCRIPT_BYTES,
  MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
};
