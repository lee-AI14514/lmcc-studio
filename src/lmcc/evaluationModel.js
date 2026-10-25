/**
 * Pure helpers for the local evaluation UI.
 *
 * The question file only declares a path; the actual process is launched by
 * the Electron main process. Keeping target selection, runtime capability
 * parsing and result interpretation here makes those rules unit-testable.
 */

export const EVALUATION_SCRIPT_SOURCE = {
  localTest: 'localTest.script',
};

/**
 * The executable local evaluator is `localTest.script` only.
 *
 * `evaluationCode` is a read-only path used by the original IDE to open the
 * evaluation source; it is intentionally not executed.
 */
export function selectEvaluationScript(question) {
  if (!question || typeof question !== 'object') return null;
  const localScript = question.localTest?.script;
  if (typeof localScript === 'string' && localScript.trim()) {
    return {
      script: localScript,
      source: 'localTest',
      label: EVALUATION_SCRIPT_SOURCE.localTest,
    };
  }
  return null;
}


/**
 * Parse `.lmcc/runtime.json`.
 *
 * Local evaluation requires this file and a runtimeId. An explicit
 * `capabilities.localEvaluation === false` additionally disables the button.
 */
export function parseEvaluationRuntime(text) {
  if (text === null || text === undefined || String(text).trim() === '') {
    return {
      state: 'missing',
      runtimeId: null,
      localEvaluation: null,
      capabilities: null,
      message: '未找到 .lmcc/runtime.json，本地评测不可用。',
    };
  }

  let value;
  try {
    value = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch {
    return {
      state: 'invalid',
      runtimeId: null,
      localEvaluation: null,
      capabilities: null,
      message: '.lmcc/runtime.json 不是有效的 JSON。',
    };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {
      state: 'invalid',
      runtimeId: null,
      localEvaluation: null,
      capabilities: null,
      message: '.lmcc/runtime.json 的内容必须是 JSON 对象。',
    };
  }

  const capabilities =
    value.capabilities &&
    typeof value.capabilities === 'object' &&
    !Array.isArray(value.capabilities)
      ? value.capabilities
      : null;

  return {
    state: 'ready',
    runtimeId:
      typeof value.runtimeId === 'string' ? value.runtimeId.trim() : null,
    localEvaluation:
      typeof capabilities?.localEvaluation === 'boolean'
        ? capabilities.localEvaluation
        : null,
    capabilities,
    message:
      capabilities?.localEvaluation === false
        ? '试卷的 runtime 声明了 localEvaluation: false。'
        : null,
  };
}

/**
 * Why the run button is disabled. Returning `null` means the evaluation can
 * be started (subject to the main process finding Python and the script).
 */
export function evaluationDisabledReason({ target, runtime, bridgeAvailable }) {
  if (!bridgeAvailable) {
    return '当前环境不支持启动本地评测，请通过 Electron 启动 LMCC Studio。';
  }
  if (!target) {
    return '当前题目没有声明 localTest.script（evaluationCode 仅用于查看评测代码）。';
  }

  if (runtime?.state === 'missing') {
    return '未找到 .lmcc/runtime.json，本地评测不可用。';
  }
  if (runtime?.state === 'invalid') {
    return runtime.message || '.lmcc/runtime.json 配置无效，本地评测不可用。';
  }
  if (runtime?.state === 'unavailable') {
    return runtime.message || '无法读取 .lmcc/runtime.json，本地评测不可用。';
  }
  if (runtime?.state === 'ready' && !runtime.runtimeId) {
    return '.lmcc/runtime.json 缺少 runtimeId，本地评测不可用。';
  }
  if (runtime?.state === 'ready' && runtime.localEvaluation === false) {
    return '试卷的 .lmcc/runtime.json 未启用本地评测（capabilities.localEvaluation = false）。';
  }
  return null;
}

function usableResult(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const hasOk = typeof value.ok === 'boolean';
  const hasScore =
    typeof value.score === 'number' && Number.isFinite(value.score);
  if (!hasOk && !hasScore) return null;
  return {
    ok: hasOk ? value.ok : null,
    score: hasScore ? value.score : null,
  };
}

/**
 * Recognise the common evaluator result envelope, e.g.
 * `{"ok": false, "errors": {...}}`. The raw output is still the source of
 * truth in the panel; this only drives the status badge.
 */
export function parseEvaluationResult(stdout) {
  const text = String(stdout ?? '').trim();
  if (!text) return null;

  const candidates = [text];
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (line) {
      candidates.push(line);
      break;
    }
  }

  for (const candidate of candidates) {
    try {
      const result = usableResult(JSON.parse(candidate));
      if (result) return result;
    } catch {
      // Not every evaluator prints JSON; fall back to the exit code.
    }
  }

  // The 2025 LMCC papers print a Chinese summary such as “得分：50/50”.
  const score = /(?:得分|Score)\s*[:：]\s*(\d+)\s*\/\s*(\d+)/i.exec(text);
  if (score) {
    const earned = Number(score[1]);
    const total = Number(score[2]);
    if (Number.isFinite(earned) && Number.isFinite(total) && total > 0) {
      return { ok: earned === total, score: earned, maxScore: total };
    }
  }

  const correct = /正确题数\s*[:：]\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  if (correct) {
    const earned = Number(correct[1]);
    const total = Number(correct[2]);
    if (Number.isFinite(earned) && Number.isFinite(total) && total > 0) {
      return { ok: earned === total, score: earned, maxScore: total };
    }
  }

  return null;
}

export function formatEvaluationDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

export function deriveEvaluationOutcome({
  stopped,
  truncated,
  exitCode,
  result,
}) {
  if (stopped === 'timeout') {
    return { status: 'failed', label: '运行超时', tone: 'error' };
  }
  if (stopped === 'output-limit' || truncated) {
    return { status: 'failed', label: '输出超限', tone: 'error' };
  }
  if (stopped) {
    return { status: 'stopped', label: '已停止', tone: 'warning' };
  }
  if (exitCode !== 0) {
    return {
      status: 'failed',
      label:
        exitCode === null || exitCode === undefined
          ? '异常结束'
          : `失败 · 退出码 ${exitCode}`,
      tone: 'error',
    };
  }
  if (result?.ok === true) {
    return { status: 'passed', label: '评测通过', tone: 'ok' };
  }
  if (result?.ok === false) {
    return { status: 'failed', label: '评测未通过', tone: 'error' };
  }
  return { status: 'completed', label: '执行完成', tone: 'ok' };
}
