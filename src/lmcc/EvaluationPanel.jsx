import React, { useEffect, useMemo, useRef } from 'react';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import TerminalRoundedIcon from '@mui/icons-material/TerminalRounded';
import { formatEvaluationDuration } from './evaluationModel';
import './EvaluationPanel.css';

function runtimeLabel(runtime) {
  if (runtime?.state === 'ready') {
    return runtime.runtimeId || 'runtime 已配置';
  }
  if (runtime?.state === 'loading') return '读取 runtime…';
  if (runtime?.state === 'missing') return '未配置 runtime';
  return 'runtime 不可读';
}

function statusOf(evaluation, stopping) {
  if (evaluation.status === 'idle') {
    return { label: '未运行', tone: 'idle' };
  }
  if (evaluation.status === 'starting') {
    return { label: '启动中', tone: 'running' };
  }
  if (evaluation.status === 'running') {
    return { label: stopping ? '停止中' : '运行中', tone: 'running' };
  }
  if (evaluation.status === 'stopping') {
    return { label: '停止中', tone: 'running' };
  }
  if (evaluation.outcome) {
    return {
      label: evaluation.outcome.label,
      tone: evaluation.outcome.tone || 'idle',
    };
  }
  if (evaluation.status === 'error') {
    return { label: '无法启动', tone: 'error' };
  }
  return { label: '已结束', tone: 'idle' };
}

export default function EvaluationPanel({ evaluation }) {
  const terminalRef = useRef(null);
  const stickRef = useRef(true);
  const {
    target,
    runtime,
    mode,
    setMode,
    disabledReason,
    canRun,
    isRunning,
    stopping,
    run,
    stop,
    clear,
    chunks,
    displayTrimmed,
  } = evaluation;
  const state = evaluation.evaluation;
  const status = statusOf(state, stopping);

  useEffect(() => {
    const node = terminalRef.current;
    if (!node || !stickRef.current) return;
    node.scrollTop = node.scrollHeight;
  }, [chunks, state.status]);

  const handleScroll = () => {
    const node = terminalRef.current;
    if (!node) return;
    stickRef.current =
      node.scrollHeight - node.scrollTop - node.clientHeight < 24;
  };

  const footer = useMemo(() => {
    const parts = [];
    if (state.python) parts.push(state.python);
    if (Number.isFinite(state.durationMs)) {
      parts.push(formatEvaluationDuration(state.durationMs));
    }
    if (state.exitCode !== null && state.exitCode !== undefined) {
      parts.push(`退出码 ${state.exitCode}`);
    }
    if (state.timeoutMs) {
      parts.push(`时限 ${Math.round(state.timeoutMs / 1000)} s`);
    }
    return parts;
  }, [
    state.durationMs,
    state.exitCode,
    state.python,
    state.timeoutMs,
  ]);

  const emptyText = disabledReason
    ? '评测不可用。'
    : '运行评测后，Python 脚本的 stdout / stderr 会显示在这里。';

  return (
    <section className="lmcc-card lmcc-eval-card" data-testid="evaluation-panel">
      <div className="lmcc-card-head">
        <h2>评测机</h2>
        <span
          className={`lmcc-eval-status is-${status.tone}`}
          data-testid="evaluation-status"
        >
          {status.label}
        </span>
      </div>

      <div className="lmcc-eval-target">
        <span className="lmcc-eval-target-icon">
          <TerminalRoundedIcon sx={{ fontSize: 15 }} />
        </span>
        <span className="lmcc-eval-target-copy">
          <code>{target?.script || '未声明评测脚本'}</code>
          <span>
            {target?.label || 'localTest.script / evaluationCode'}
          </span>
        </span>
        <span className="lmcc-eval-runtime" title={runtime?.message || ''}>
          {runtimeLabel(runtime)}
        </span>
      </div>

      {disabledReason && !isRunning ? (
        <p className="lmcc-eval-disabled">{disabledReason}</p>
      ) : null}

      <div className="lmcc-eval-actions">
        <label
          className="lmcc-eval-mode"
          title="传给评测脚本的 --mode 参数"
        >
          <span>模式</span>
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value)}
            disabled={isRunning}
          >
            <option value="grading">评分</option>
            <option value="demo">演示</option>
          </select>
        </label>

        <button
          type="button"
          className="lmcc-eval-run"
          onClick={run}
          disabled={!canRun || isRunning}
          title={disabledReason || `运行当前题目的本地评测脚本（${mode === 'demo' ? '演示' : '评分'}模式）`}
        >
          <PlayArrowRoundedIcon sx={{ fontSize: 16 }} />
          {isRunning ? '运行中…' : '运行评测'}
        </button>

        {isRunning ? (
          <button
            type="button"
            className="lmcc-eval-stop"
            onClick={stop}
            disabled={stopping}
          >
            <StopRoundedIcon sx={{ fontSize: 15 }} />
            {stopping ? '停止中…' : '停止'}
          </button>
        ) : null}

        {!isRunning && chunks.length > 0 ? (
          <button
            type="button"
            className="lmcc-eval-clear"
            onClick={clear}
          >
            <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
            清空
          </button>
        ) : null}
      </div>

      <pre
        className="lmcc-eval-terminal"
        ref={terminalRef}
        onScroll={handleScroll}
        tabIndex={0}
        aria-label="评测输出"
        data-testid="evaluation-output"
      >
        {chunks.length === 0 ? (
          <span className="lmcc-eval-placeholder">{emptyText}</span>
        ) : (
          chunks.map((chunk) => (
            <span
              key={chunk.id}
              className={`lmcc-eval-chunk is-${chunk.stream}${
                chunk.tone ? ` is-${chunk.tone}` : ''
              }`}
            >
              {chunk.text}
            </span>
          ))
        )}
        {isRunning ? (
          <span className="lmcc-eval-cursor" aria-hidden="true">
            ▌
          </span>
        ) : null}
      </pre>

      {displayTrimmed ? (
        <p className="lmcc-eval-note">
          输出过长，界面只保留最近的 1,000,000 个字符。
        </p>
      ) : null}
      {state.truncated ? (
        <p className="lmcc-eval-note is-error">
          评测脚本的输出超过上限，进程已被停止。
        </p>
      ) : null}

      <div className="lmcc-eval-foot">
        <span>
          {footer.length
            ? footer.join(' · ')
            : state.status === 'idle'
            ? '等待运行'
            : '本次评测未启动'}
        </span>
        {state.cwd ? <code title={state.cwd}>{state.cwd}</code> : null}
      </div>
    </section>
  );
}
