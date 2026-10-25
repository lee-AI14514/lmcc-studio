import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readQuestionText } from './questionAssets';
import {
  deriveEvaluationOutcome,
  evaluationDisabledReason,
  formatEvaluationDuration,
  parseEvaluationResult,
  parseEvaluationRuntime,
  selectEvaluationScript,
} from './evaluationModel';

const MAX_OUTPUT_CHARS = 1000 * 1000;
const MAX_OUTPUT_CHUNKS = 4000;
const MAX_RESULT_CHARS = 1000 * 1000;
const RUNTIME_MAX_BYTES = 1024 * 1024;

const ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);

function createRunId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function emptyEvaluation() {
  return {
    status: 'idle',
    chunks: [],
    outputChars: 0,
    displayTrimmed: false,
    startedAt: null,
    durationMs: null,
    exitCode: null,
    signal: null,
    stopped: null,
    truncated: false,
    result: null,
    outcome: null,
    error: null,
    python: null,
    script: null,
    cwd: null,
    timeoutMs: null,
  };
}

function loadingRuntime() {
  return {
    state: 'loading',
    runtimeId: null,
    localEvaluation: null,
    capabilities: null,
    message: '正在读取 .lmcc/runtime.json…',
  };
}

/**
 * Drive one local evaluator for a question and collect its streamed output.
 *
 * The hook is deliberately scoped to the reader component: switching to
 * another tab unmounts it and stops the child process instead of leaving an
 * orphaned Python process behind.
 */
export function useEvaluation({ root, parsed, filePath }) {
  const question = parsed?.question || null;
  const target = useMemo(() => selectEvaluationScript(question), [question]);
  const bridgeAvailable =
    typeof window !== 'undefined' &&
    typeof window.lmcc?.startEvaluation === 'function';

  const [runtime, setRuntime] = useState(loadingRuntime);
  const [evaluation, setEvaluation] = useState(emptyEvaluation);
  const [stopping, setStopping] = useState(false);
  const [mode, setMode] = useState('grading');

  const activeRunRef = useRef(null);
  const stdoutRef = useRef('');
  const chunkIdRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const runId = activeRunRef.current;
      activeRunRef.current = null;
      if (runId && window.lmcc?.stopEvaluation) {
        Promise.resolve(window.lmcc.stopEvaluation(runId)).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (!root) {
      setRuntime(parseEvaluationRuntime(null));
      return undefined;
    }

    setRuntime(loadingRuntime());
    readQuestionText(root, '.lmcc/runtime.json', RUNTIME_MAX_BYTES)
      .then((result) => {
        if (!alive) return;
        if (result?.ok) {
          setRuntime(parseEvaluationRuntime(result.content));
        } else if (result?.code === 'missing') {
          setRuntime(parseEvaluationRuntime(null));
        } else {
          setRuntime({
            state: 'unavailable',
            runtimeId: null,
            localEvaluation: null,
            capabilities: null,
            message: result?.message || '无法读取 .lmcc/runtime.json。',
          });
        }
      })
      .catch(() => {
        if (!alive) return;
        setRuntime({
          state: 'unavailable',
          runtimeId: null,
          localEvaluation: null,
          capabilities: null,
          message: '无法读取 .lmcc/runtime.json。',
        });
      });

    return () => {
      alive = false;
    };
  }, [root]);

  const appendChunk = useCallback((stream, text, tone = null) => {
    if (!text) return;
    const capped =
      text.length > MAX_OUTPUT_CHARS
        ? text.slice(0, MAX_OUTPUT_CHARS)
        : text;
    chunkIdRef.current += 1;
    const entry = {
      id: chunkIdRef.current,
      stream,
      tone,
      text: capped,
    };

    setEvaluation((previous) => {
      const chunks = previous.chunks.concat(entry);
      let outputChars = previous.outputChars + capped.length;
      let displayTrimmed = previous.displayTrimmed;
      let changed = text.length > capped.length;

      while (
        chunks.length > MAX_OUTPUT_CHUNKS ||
        outputChars > MAX_OUTPUT_CHARS
      ) {
        if (chunks.length <= 1) break;
        const removed = chunks.shift();
        outputChars -= removed.text.length;
        displayTrimmed = true;
      }

      if (!changed && outputChars > MAX_OUTPUT_CHARS) {
        changed = true;
      }

      return {
        ...previous,
        chunks,
        outputChars,
        displayTrimmed: displayTrimmed || changed,
      };
    });
  }, []);

  const finish = useCallback(
    (event) => {
      const result = parseEvaluationResult(stdoutRef.current);
      const outcome = deriveEvaluationOutcome({
        stopped: event.stopped,
        truncated: event.truncated,
        exitCode: event.code,
        result,
      });
      const duration = formatEvaluationDuration(event.durationMs);

      activeRunRef.current = null;
      setStopping(false);
      setEvaluation((previous) => ({
        ...previous,
        status: outcome.status,
        outcome,
        result,
        exitCode: event.code,
        signal: event.signal,
        durationMs: event.durationMs,
        stopped: event.stopped,
        truncated: Boolean(event.truncated),
        error: null,
      }));
      appendChunk(
        'system',
        `\n[${outcome.label} · ${duration}` +
          (event.code === null ? '' : ` · 退出码 ${event.code}`) +
          ']\n',
        outcome.tone
      );
    },
    [appendChunk]
  );

  useEffect(() => {
    if (!window.lmcc?.onEvaluationEvent) return undefined;

    const unsubscribe = window.lmcc.onEvaluationEvent((event) => {
      if (!event || event.runId !== activeRunRef.current) return;

      if (event.type === 'start') {
        setEvaluation((previous) => ({
          ...previous,
          status: 'running',
          python: event.python,
          script: event.script,
          mode: event.mode || previous.mode,
          cwd: event.cwd,
          startedAt: previous.startedAt || Date.now(),
          timeoutMs: event.timeoutMs,
          error: null,
        }));
        appendChunk(
          'system',
          `$ ${event.python} -u ${event.script} --mode ${
            event.mode || 'grading'
          }\n# cwd ${event.cwd}\n`
        );
        return;
      }

      if (event.type === 'output') {
        if (event.stream === 'stdout') {
          stdoutRef.current = (
            stdoutRef.current + String(event.text ?? '')
          ).slice(-MAX_RESULT_CHARS);
        }
        appendChunk(event.stream, event.text);
        return;
      }

      if (event.type === 'system') {
        appendChunk(
          'system',
          `${event.message || ''}\n`,
          event.tone === 'error' ? 'error' : event.tone
        );
        return;
      }

      if (event.type === 'exit') {
        finish(event);
      }
    });

    return unsubscribe;
  }, [appendChunk, finish]);

  const disabledReason = useMemo(() => {
    if (runtime.state === 'loading') {
      return '正在读取 .lmcc/runtime.json…';
    }
    return evaluationDisabledReason({
      target,
      runtime,
      bridgeAvailable,
    });
  }, [bridgeAvailable, runtime, target]);

  const isRunning = ACTIVE_STATUSES.has(evaluation.status);

  const run = useCallback(async () => {
    if (!target || disabledReason || activeRunRef.current) return null;
    if (!window.lmcc?.startEvaluation) return null;

    const runId = createRunId();
    activeRunRef.current = runId;
    stdoutRef.current = '';
    setStopping(false);
    setEvaluation({
      ...emptyEvaluation(),
      status: 'starting',
      script: target.script,
      mode,
      startedAt: Date.now(),
    });

    try {
      const result = await window.lmcc.startEvaluation({
        runId,
        root,
        script: target.script,
        questionId: question?.id,
        questionType: parsed?.type,
        questionFile: filePath,
        runtimeId: runtime.state === 'ready' ? runtime.runtimeId : undefined,
        mode,
      });

      if (activeRunRef.current !== runId) return result;
      if (!result?.ok) {
        activeRunRef.current = null;
        const message = result?.message || '无法启动评测。';
        setEvaluation((previous) => ({
          ...previous,
          status: 'error',
          error: message,
          outcome: { status: 'error', label: '无法启动', tone: 'error' },
        }));
        appendChunk('system', `${message}\n`, 'error');
        return result;
      }

      if (mountedRef.current) {
        setEvaluation((previous) => ({
          ...previous,
          python: result.python,
          script: result.script,
          mode: result.mode || previous.mode,
          cwd: result.cwd,
          timeoutMs: result.timeoutMs,
        }));
      }
      return result;
    } catch (error) {
      if (activeRunRef.current !== runId) return null;
      activeRunRef.current = null;
      const message = error?.message || '无法启动评测。';
      setEvaluation((previous) => ({
        ...previous,
        status: 'error',
        error: message,
        outcome: { status: 'error', label: '无法启动', tone: 'error' },
      }));
      appendChunk('system', `${message}\n`, 'error');
      return { ok: false, message };
    }
  }, [
    appendChunk,
    disabledReason,
    filePath,
    mode,
    parsed?.type,
    question?.id,
    root,
    runtime,
    target,
  ]);

  const stop = useCallback(async () => {
    const runId = activeRunRef.current;
    if (!runId || !window.lmcc?.stopEvaluation) return;
    setStopping(true);
    appendChunk('system', '正在请求停止评测…\n', 'warning');
    try {
      const result = await window.lmcc.stopEvaluation(runId);
      if (!result?.ok && activeRunRef.current === runId) {
        setStopping(false);
        appendChunk(
          'system',
          `${result?.message || '停止评测失败。'}\n`,
          'warning'
        );
      }
    } catch {
      if (activeRunRef.current === runId) {
        setStopping(false);
        appendChunk('system', '停止评测失败。\n', 'warning');
      }
    }
  }, [appendChunk]);

  const clear = useCallback(() => {
    if (activeRunRef.current) return;
    setEvaluation(emptyEvaluation());
  }, []);

  const changeMode = useCallback((next) => {
    if (activeRunRef.current) return;
    if (next === 'demo' || next === 'grading') setMode(next);
  }, []);

  return {
    target,
    runtime,
    mode,
    setMode: changeMode,
    evaluation,
    status: evaluation.status,
    outcome: evaluation.outcome,
    chunks: evaluation.chunks,
    displayTrimmed: evaluation.displayTrimmed,
    disabledReason,
    canRun: !disabledReason && Boolean(target),
    isRunning,
    stopping,
    run,
    stop,
    clear,
  };
}
