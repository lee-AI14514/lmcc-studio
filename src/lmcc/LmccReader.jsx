import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { parseLmcc } from './lmccParser';
import { basenameOf, dirnameOf, formatBytes } from './pathUtils';
import { loadQuestionAssets } from './questionAssets';
import { useLmccActions } from './useLmccActions';
import { useEvaluation } from './useEvaluation';
import EvaluationPanel from './EvaluationPanel';
import Markdown from './Markdown';
import {
  AnswerFilesCard,
  ChecksCard,
  InputsCard,
  MetaCard,
  PromptCard,
  SourceView,
  TrainingCard,
  TypePill,
} from './LmccSections';
import './LmccReader.css';

const ERROR_HINTS = {
  LMCC_MAGIC: [
    '首行必须是 LMCC/1，并且后面紧跟一个换行。',
    '文件应为 UTF-8 文本，允许开头带 BOM。',
  ],
  LMCC_JSON: [
    '首行之后必须是合法的 JSON。',
    'JSON 不能包含注释、尾逗号或空的控制字符。',
  ],
  LMCC_LOAD: ['请确认文件仍然存在，并且有读取权限。'],
};

function parseTabContent(content, filePath, root, loadError) {
  if (loadError) {
    return {
      ok: false,
      error: {
        message: loadError,
        code: 'LMCC_LOAD',
        detail: null,
      },
    };
  }
  try {
    return {
      ok: true,
      result: parseLmcc(content ?? '', {
        root: root || dirnameOf(filePath || ''),
      }),
    };
  } catch (error) {
    return { ok: false, error };
  }
}

function StatementSkeleton() {
  return (
    <div className="lmcc-statement-skeleton" aria-label="正在读取题面">
      <span className="is-title" />
      <span />
      <span />
      <span className="is-short" />
      <span />
      <span className="is-medium" />
    </div>
  );
}

export default function LmccReader({ tab }) {
  const root = tab.root || dirnameOf(tab.filePath || '');
  const parseState = useMemo(
    () => parseTabContent(tab.content, tab.filePath, tab.root, tab.loadError),
    [tab.content, tab.filePath, tab.loadError, tab.root]
  );
  const parsed = parseState.ok ? parseState.result : null;

  const [assets, setAssets] = useState({ status: 'loading' });
  const [view, setView] = useState('question');
  const [reloading, setReloading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(null);
  const mainRef = React.useRef(null);
  const { openInEditor, reloadQuestion } = useLmccActions();
  const evaluation = useEvaluation({
    root,
    parsed,
    filePath: tab.filePath,
  });

  useEffect(() => {
    setView('question');
    setNotice(null);
    setCopied(null);
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [tab.title]);

  useEffect(() => {
    if (!parsed) {
      setAssets({ status: 'idle' });
      return undefined;
    }
    let active = true;
    setAssets({ status: 'loading' });
    loadQuestionAssets(parsed, { filePath: tab.filePath, root })
      .then((result) => {
        if (!active) return;
        setAssets({ status: 'ready', ...result });
      })
      .catch(() => {
        if (!active) return;
        setAssets({
          status: 'ready',
          root,
          statement: {
            state: 'error',
            text: '',
            message: '题面加载失败。',
          },
          entries: [],
          checks: [
            {
              severity: 'error',
              code: 'LMCC_ASSETS',
              message: '题目资源加载失败。',
            },
          ],
        });
      });
    return () => {
      active = false;
    };
  }, [parsed, root, tab.filePath]);

  const checks = useMemo(() => {
    if (!parsed) return [];
    const list = [...parsed.issues];
    if (assets.status === 'ready') list.push(...(assets.checks || []));
    return list;
  }, [parsed, assets]);

  const errorCount = checks.filter((item) => item.severity === 'error').length;

  const handleReload = useCallback(async () => {
    if (!tab.filePath) {
      setNotice({ type: 'error', message: '题目文件路径未知。' });
      return;
    }
    setReloading(true);
    setNotice(null);
    const result = await reloadQuestion(tab);
    setReloading(false);
    if (!result?.ok && !result?.canceled) {
      setNotice({
        type: 'error',
        message: result?.message || '重新读取题目失败。',
      });
    } else if (result?.ok) {
      setNotice({ type: 'ok', message: '已重新读取题目文件。' });
    }
  }, [reloadQuestion, tab]);

  const copyText = useCallback(async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      setNotice({ type: 'error', message: '无法写入剪贴板。' });
    }
  }, []);

  if (!parseState.ok) {
    const error = parseState.error || {};
    const hints = ERROR_HINTS[error.code] || [
      '请检查题目声明是否符合 .lmcc 格式。',
    ];
    const line = error.detail?.line;
    const column = error.detail?.column;

    return (
      <div className="lmcc-reader">
        <header className="lmcc-reader-head">
          <div className="lmcc-head-main">
            <TypePill />
            <div className="lmcc-head-titles">
              <h1 title={tab.filePath}>{basenameOf(tab.filePath) || '题目文件'}</h1>
              <div className="lmcc-head-sub">
                <span className="is-mono">{tab.filePath || '未知路径'}</span>
              </div>
            </div>
          </div>
          <div className="lmcc-head-actions">
            <button
              type="button"
              className="lmcc-action"
              onClick={handleReload}
              disabled={reloading}
            >
              <RefreshRoundedIcon sx={{ fontSize: 16 }} />
              {reloading ? '读取中…' : '重新读取'}
            </button>
            <button
              type="button"
              className="lmcc-action"
              onClick={() => openInEditor(tab)}
            >
              <EditNoteRoundedIcon sx={{ fontSize: 16 }} />
              在编辑器中打开
            </button>
          </div>
        </header>

        {notice ? (
          <div className={`lmcc-notice lmcc-notice-${notice.type}`}>
            <span>{notice.message}</span>
            <button
              type="button"
              className="lmcc-notice-close"
              onClick={() => setNotice(null)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        ) : null}

        <div className="lmcc-error-stage">
          <div className="lmcc-error-card">
            <span className="lmcc-error-icon">
              <ErrorOutlineRoundedIcon sx={{ fontSize: 26 }} />
            </span>
            <div className="lmcc-error-copy">
              <div className="lmcc-error-eyebrow">
                {error.code === 'LMCC_LOAD'
                  ? '读取失败'
                  : 'LMCC 题目文件校验失败'}
                {error.code ? (
                  <code className="lmcc-error-code">{error.code}</code>
                ) : null}
              </div>
              <h2>{error.message || '题目文件无法解析。'}</h2>
              {line ? (
                <p className="lmcc-error-location">
                  JSON 第 {line} 行
                  {column ? `，第 ${column} 列` : ''}
                  {error.detail?.reason ? ` · ${error.detail.reason}` : ''}
                </p>
              ) : null}
              {tab.filePath ? (
                <p className="lmcc-error-path">
                  <code>{tab.filePath}</code>
                </p>
              ) : null}
              <ul className="lmcc-error-hints">
                {hints.map((hint) => (
                  <li key={hint}>{hint}</li>
                ))}
              </ul>

              {tab.content ? (
                <details className="lmcc-error-raw">
                  <summary>查看原始内容</summary>
                  <SourceView source={tab.content} maxLines={400} />
                </details>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const question = parsed.question;
  const statement = assets.status === 'ready' ? assets.statement : null;
  const statementBaseDir = dirnameOf(question.statement);
  const rawJson = () => JSON.stringify(parsed.raw, null, 2);

  return (
    <div className="lmcc-reader">
      <header className="lmcc-reader-head">
        <div className="lmcc-head-main">
          <TypePill type={parsed.type} declaredType={parsed.declaredType} />
          <div className="lmcc-head-titles">
            <h1 title={question.title}>{question.title}</h1>
            <div className="lmcc-head-sub">
              <span>{question.id}</span>
              <span className="lmcc-dot" />
              <span className="is-mono">{basenameOf(tab.filePath)}</span>
              {tab.size ? (
                <>
                  <span className="lmcc-dot" />
                  <span>{formatBytes(tab.size)}</span>
                </>
              ) : null}
              {errorCount > 0 ? (
                <span className="lmcc-head-issue">{errorCount} 项问题</span>
              ) : (
                <span className="lmcc-head-ok">
                  <CheckCircleRoundedIcon sx={{ fontSize: 13 }} />
                  结构有效
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="lmcc-head-actions">
          <div className="lmcc-view-switch" role="tablist" aria-label="题目视图">
            <button
              type="button"
              role="tab"
              aria-selected={view === 'question'}
              className={view === 'question' ? 'is-active' : ''}
              onClick={() => setView('question')}
            >
              题目
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'raw'}
              className={view === 'raw' ? 'is-active' : ''}
              onClick={() => setView('raw')}
            >
              原文
            </button>
          </div>
          <button
            type="button"
            className="lmcc-action lmcc-eval-header-action"
            onClick={() => {
              setView('question');
              evaluation.run();
            }}
            disabled={!evaluation.canRun || evaluation.isRunning}
            title={
              evaluation.disabledReason ||
              (evaluation.isRunning
                ? '本地评测正在运行'
                : '运行本地评测脚本')
            }
            data-testid="evaluation-run-button"
          >
            <PlayArrowRoundedIcon sx={{ fontSize: 16 }} />
            {evaluation.isRunning ? '评测中…' : '评测'}
          </button>
          <button
            type="button"
            className="lmcc-action"
            onClick={handleReload}
            disabled={reloading}
            title="重新读取并解析文件"
          >
            <RefreshRoundedIcon
              sx={{ fontSize: 16 }}
              className={reloading ? 'lmcc-spin' : ''}
            />
            {reloading ? '读取中…' : '重新读取'}
          </button>
          <button
            type="button"
            className="lmcc-action"
            onClick={() => openInEditor(tab)}
            title="用文本编辑器打开此文件"
          >
            <EditNoteRoundedIcon sx={{ fontSize: 16 }} />
            在编辑器中打开
          </button>
        </div>
      </header>

      {notice ? (
        <div className={`lmcc-notice lmcc-notice-${notice.type}`}>
          <span>{notice.message}</span>
          <button
            type="button"
            className="lmcc-notice-close"
            onClick={() => setNotice(null)}
            aria-label="关闭提示"
          >
            ×
          </button>
        </div>
      ) : null}

      {view === 'raw' ? (
        <div className="lmcc-raw">
          <div className="lmcc-raw-toolbar">
            <div className="lmcc-raw-stats">
              <span>{tab.content.split('\n').length.toLocaleString()} 行</span>
              <span className="lmcc-dot" />
              <span>{tab.content.length.toLocaleString()} 字符</span>
              {tab.size ? (
                <>
                  <span className="lmcc-dot" />
                  <span>{formatBytes(tab.size)}</span>
                </>
              ) : null}
            </div>
            <div className="lmcc-raw-actions">
              <button
                type="button"
                className="lmcc-action is-small"
                onClick={() => copyText(tab.content, 'source')}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                {copied === 'source' ? '已复制' : '复制原文'}
              </button>
              <button
                type="button"
                className="lmcc-action is-small"
                onClick={() => copyText(rawJson(), 'json')}
              >
                <ContentCopyRoundedIcon sx={{ fontSize: 14 }} />
                {copied === 'json' ? '已复制' : '复制 JSON'}
              </button>
            </div>
          </div>
          <div className="lmcc-raw-scroll">
            <SourceView source={tab.content} />
          </div>
        </div>
      ) : (
        <div className="lmcc-reader-body">
          <main className="lmcc-reader-main" ref={mainRef}>
            <section className="lmcc-card lmcc-statement-card">
              <div className="lmcc-card-head">
                <h2>题面</h2>
                <code className="lmcc-card-hint">{question.statement}</code>
              </div>
              {assets.status === 'loading' ? (
                <StatementSkeleton />
              ) : statement?.state === 'ready' ? (
                <Markdown
                  source={statement.text}
                  root={root}
                  baseDir={statementBaseDir}
                />
              ) : (
                <div className="lmcc-statement-missing">
                  <ErrorOutlineRoundedIcon sx={{ fontSize: 20 }} />
                  <div>
                    <strong>题面无法读取</strong>
                    <p>{statement?.message || '题面文件不存在。'}</p>
                    <code>{question.statement}</code>
                  </div>
                </div>
              )}
            </section>

            <AnswerFilesCard question={question} assets={assets} />

            {question.inputs ? <InputsCard question={question} /> : null}

            {parsed.type === 'prompt' ? (
              <PromptCard question={question} assets={assets} />
            ) : null}

            {parsed.type === 'training' ? (
              <TrainingCard question={question} assets={assets} />
            ) : null}
          </main>

          <aside className="lmcc-reader-aside">
            <EvaluationPanel evaluation={evaluation} />
            <ChecksCard
              checks={checks}
              loading={assets.status === 'loading'}
            />
            <MetaCard result={parsed} tab={tab} root={root} assets={assets} />
          </aside>
        </div>
      )}
    </div>
  );
}
