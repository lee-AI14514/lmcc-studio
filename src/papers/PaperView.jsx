import React, { useEffect, useMemo, useState } from 'react';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import { useLmccActions } from '../lmcc/useLmccActions';
import { TypePill, ChecksCard } from '../lmcc/LmccSections';
import { formatBytes } from '../lmcc/pathUtils';
import { usePapers } from './usePapers';
import { loadPaperStatus } from './paperAssets';
import {
  paperRuntimeLabel,
  paperStatusTone,
} from './paperModel';
import '../lmcc/LmccReader.css';
import './PaperView.css';

function booleanLabel(value) {
  if (value === true) return '支持';
  if (value === false) return '不支持';
  return '未声明';
}

function MetaRow({ label, children, mono = false }) {
  return (
    <div className="paper-kv-row">
      <dt>{label}</dt>
      <dd className={mono ? 'is-mono' : ''}>{children}</dd>
    </div>
  );
}

function RuntimeCard({ paper }) {
  const runtime = paper.runtimeInfo;
  const capabilities = runtime?.capabilities;

  return (
    <section className="lmcc-card paper-meta-card">
      <div className="lmcc-card-head">
        <h2>运行时</h2>
        <code className="lmcc-card-hint">.lmcc/runtime.json</code>
      </div>
      <dl className="paper-kv">
        <MetaRow label="runtimeId" mono>
          {paperRuntimeLabel(paper)}
        </MetaRow>
        <MetaRow label="本地评测">
          {runtime?.state === 'ready'
            ? booleanLabel(capabilities?.localEvaluation)
            : '未知'}
        </MetaRow>
        <MetaRow label="Notebook">
          {runtime?.state === 'ready'
            ? booleanLabel(capabilities?.notebook)
            : '未知'}
        </MetaRow>
        <MetaRow label="状态">
          {runtime?.state === 'ready' ? (
            <span className="paper-inline-ok">可用</span>
          ) : runtime?.state === 'missing' ? (
            '未配置'
          ) : (
            <span className="paper-inline-error">配置无效</span>
          )}
        </MetaRow>
      </dl>
      {runtime?.message ? (
        <p className="paper-card-note">{runtime.message}</p>
      ) : null}
    </section>
  );
}

function ContestCard({ paper }) {
  const contest = paper.contestInfo;

  return (
    <section className="lmcc-card paper-meta-card">
      <div className="lmcc-card-head">
        <h2>试卷归属</h2>
        <code className="lmcc-card-hint">.lmcc/contest.json</code>
      </div>
      {contest?.state === 'ready' ? (
        <dl className="paper-kv">
          <MetaRow label="文件名" mono>
            {contest.filename || '未声明'}
          </MetaRow>
          <MetaRow label="账号">{contest.username || '未声明'}</MetaRow>
          <MetaRow label="服务">{contest.service || '未声明'}</MetaRow>
        </dl>
      ) : (
        <p className="paper-card-note">
          {contest?.state === 'missing'
            ? '未找到归属文件；这不会影响题目阅读。'
            : contest?.message || '无法读取试卷归属信息。'}
        </p>
      )}
    </section>
  );
}

function PaperInfoCard({ paper }) {
  return (
    <section className="lmcc-card paper-meta-card">
      <div className="lmcc-card-head">
        <h2>试卷信息</h2>
      </div>
      <dl className="paper-kv">
        <MetaRow label="题目文件">
          {paper.summary.total} 个
        </MetaRow>
        <MetaRow label="答案声明">
          {paper.summary.answerFileCount} 个
        </MetaRow>
        <MetaRow label="题目大小">
          {formatBytes(paper.meta?.questionBytes || 0)}
        </MetaRow>
        <MetaRow label="布局">
          {paper.nested ? '单一顶层目录' : '根级题目'}
        </MetaRow>
        <MetaRow label="根目录" mono>
          <span className="paper-path-value">{paper.root}</span>
        </MetaRow>
      </dl>
    </section>
  );
}

function QuestionCard({ question, checks, onOpen, opening }) {
  const parsed = question.parsed;
  const errorCount = checks.filter(
    (item) => item.severity === 'error'
  ).length;
  const warningCount = checks.filter(
    (item) => item.severity === 'warning'
  ).length;

  return (
    <button
      type="button"
      className={`paper-question ${question.ok ? '' : 'is-invalid'}`}
      onClick={() => onOpen(question.filePath)}
      disabled={opening}
      title={
        question.ok
          ? `打开题目：${parsed.question.title}`
          : `打开并查看错误：${question.fileName}`
      }
    >
      <span className="paper-question-index">
        {String(question.index + 1).padStart(2, '0')}
      </span>

      <span className="paper-question-main">
        <span className="paper-question-top">
          {question.ok ? (
            <TypePill
              type={parsed.type}
              declaredType={parsed.declaredType}
            />
          ) : (
            <span className="paper-question-error-pill">
              <ErrorOutlineRoundedIcon sx={{ fontSize: 13 }} />
              无法解析
            </span>
          )}
          <span className="paper-question-title">
            {question.ok ? parsed.question.title : question.fileName}
          </span>
        </span>

        <span className="paper-question-meta">
          <code>{question.fileName}</code>
          {question.ok ? (
            <>
              <span className="lmcc-dot" />
              <span>{parsed.question.id}</span>
              <span className="lmcc-dot" />
              <span>
                {parsed.question.files.length} 个答案
              </span>
              {parsed.issues.some(
                (item) => item.severity === 'error'
              ) ? (
                <>
                  <span className="lmcc-dot" />
                  <span className="paper-inline-error">配置问题</span>
                </>
              ) : null}
            </>
          ) : (
            <>
              <span className="lmcc-dot" />
              <span className="paper-inline-error">题目文件错误</span>
            </>
          )}
        </span>

        {question.ok ? (
          <span className="paper-question-statement">
            {parsed.question.statement}
          </span>
        ) : (
          <span className="paper-question-error">
            {question.error.message}
          </span>
        )}

        {checks.length > 0 ? (
          <span className="paper-question-checks">
            {errorCount > 0 ? (
              <span className="paper-check-chip is-error">
                <ErrorOutlineRoundedIcon sx={{ fontSize: 12 }} />
                {errorCount} 个错误
              </span>
            ) : null}
            {warningCount > 0 ? (
              <span className="paper-check-chip is-warning">
                <WarningAmberRoundedIcon sx={{ fontSize: 12 }} />
                {warningCount} 个提示
              </span>
            ) : null}
          </span>
        ) : null}
      </span>

      <span className="paper-question-open">
        <OpenInNewRoundedIcon sx={{ fontSize: 14 }} />
        <ChevronRightRoundedIcon sx={{ fontSize: 16 }} />
      </span>
    </button>
  );
}

export default function PaperView({ tab }) {
  const { library, load, openPaper } = usePapers();
  const { openQuestionFile } = useLmccActions();
  const [status, setStatus] = useState({ status: 'loading', checks: new Map() });
  const [refreshing, setRefreshing] = useState(false);
  const [opening, setOpening] = useState(false);
  const [notice, setNotice] = useState(null);

  const paper = library.papers.find((item) => item.id === tab.paperId);
  const replacedPaper =
    !paper && tab.paperId && library.status === 'ready';

  useEffect(() => {
    if (library.status === 'idle') load();
  }, [library.status, load]);

  useEffect(() => {
    setNotice(null);
    setStatus({ status: 'loading', checks: new Map() });
    if (!paper?.recognized) {
      setStatus({ status: 'skipped', checks: new Map() });
      return undefined;
    }

    let active = true;
    loadPaperStatus(paper)
      .then((result) => {
        if (active) setStatus(result);
      })
      .catch(() => {
        if (active) {
          setStatus({
            status: 'error',
            checks: new Map(),
            message: '无法检查试卷文件状态。',
          });
        }
      });
    return () => {
      active = false;
    };
  }, [paper]);

  const checks = useMemo(() => {
    if (!paper?.recognized) return paper?.issues || [];
    const list = [...(paper.issues || [])];
    if (status.status === 'ready' || status.status === 'loading') {
      for (const questionChecks of status.checks?.values?.() || []) {
        list.push(...questionChecks);
      }
    } else if (status.message) {
      list.push({
        severity: 'info',
        code: 'PAPER_STATUS',
        message: status.message,
      });
    }
    return list;
  }, [paper, status]);

  const checksByFile = status.checks || new Map();

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setNotice(null);
    const result = await load();
    if (result?.ok) {
      window.dispatchEvent(new Event('lmcc:refresh-tree'));
      const next = result.papers.find((item) => item.id === tab.paperId);
      if (next) {
        openPaper(next);
        setNotice({ type: 'ok', message: '已重新扫描试卷。' });
      }
    } else {
      setNotice({
        type: 'error',
        message: result?.message || '重新扫描试卷失败。',
      });
    }
    setRefreshing(false);
  };

  const handleOpenQuestion = async (filePath) => {
    if (opening) return;
    setOpening(true);
    setNotice(null);
    const result = await openQuestionFile(filePath);
    setOpening(false);
    if (!result?.ok) {
      setNotice({
        type: 'error',
        message: result?.message || '打开题目失败。',
      });
    }
  };

  if (!paper) {
    return (
      <div className="paper-view">
        <header className="paper-head">
          <div className="paper-head-main">
            <span className="paper-eyebrow">PAPER · 试卷</span>
            <h1>{tab.paperName || '试卷'}</h1>
            <div className="paper-head-sub">
              <span className="is-mono">{tab.paperPath || '路径未知'}</span>
            </div>
          </div>
          <div className="paper-head-actions">
            <button
              type="button"
              className="lmcc-action"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshRoundedIcon
                sx={{ fontSize: 16 }}
                className={refreshing ? 'lmcc-spin' : ''}
              />
              {refreshing ? '扫描中…' : '重新扫描'}
            </button>
          </div>
        </header>
        <div className="paper-error-stage">
          <div className="paper-error-card">
            <ErrorOutlineRoundedIcon sx={{ fontSize: 26 }} />
            <div>
              <h2>
                {library.status === 'error'
                  ? '无法读取试卷库。'
                  : replacedPaper
                  ? '这份试卷已不在试卷库中。'
                  : '正在读取试卷…'}
              </h2>
              <p>
                {library.status === 'error'
                  ? library.error || '请检查 ~/.lmcc-studio 是否可读。'
                  : replacedPaper
                  ? '试卷可能已被移动、重命名或删除。'
                  : '请稍候，或点击“重新扫描”。'}
              </p>
              {tab.paperPath ? <code>{tab.paperPath}</code> : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!paper.recognized) {
    return (
      <div className="paper-view">
        <header className="paper-head">
          <div className="paper-head-main">
            <span className="paper-eyebrow">PAPER · 试卷</span>
            <h1>{paper.name}</h1>
            <div className="paper-head-sub">
              <span className="is-mono">{paper.path}</span>
              <span className="lmcc-dot" />
              <span className="paper-status is-error">无法识别</span>
            </div>
          </div>
          <div className="paper-head-actions">
            <button
              type="button"
              className="lmcc-action"
              onClick={handleRefresh}
              disabled={refreshing}
            >
              <RefreshRoundedIcon
                sx={{ fontSize: 16 }}
                className={refreshing ? 'lmcc-spin' : ''}
              />
              {refreshing ? '扫描中…' : '重新扫描'}
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

        <div className="paper-error-stage">
          <div className="paper-error-card">
            <ErrorOutlineRoundedIcon sx={{ fontSize: 28 }} />
            <div>
              <h2>{paper.issues[0]?.message || '试卷无法识别。'}</h2>
              <p>
                试卷文件夹的根目录至少需要一个 <code>.lmcc</code> 题目文件。
                如果是从 ZIP 解压出来的单层目录，也可以直接放到
                <code>~/.lmcc-studio</code> 下。
              </p>
              <code>{paper.path}</code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const hasError = checks.some((item) => item.severity === 'error');
  const hasWarning = checks.some((item) => item.severity === 'warning');
  const tone = hasError
    ? 'error'
    : hasWarning
    ? 'warning'
    : paperStatusTone(paper);
  const statusLabel =
    tone === 'error'
      ? '存在问题'
      : tone === 'warning'
      ? '有提示'
      : '结构有效';
  const errorCount = checks.filter(
    (item) => item.severity === 'error'
  ).length;
  const noteCount = checks.filter(
    (item) => item.severity === 'warning' || item.severity === 'info'
  ).length;

  return (
    <div className="paper-view">
      <header className="paper-head">
        <div className="paper-head-main">
          <span className="paper-eyebrow">PAPER · 试卷</span>
          <div className="paper-head-title-row">
            <h1>{paper.name}</h1>
            <span className={`paper-status is-${tone}`}>
              {tone === 'ok' ? (
                <CheckCircleRoundedIcon sx={{ fontSize: 13 }} />
              ) : tone === 'warning' ? (
                <WarningAmberRoundedIcon sx={{ fontSize: 13 }} />
              ) : (
                <ErrorOutlineRoundedIcon sx={{ fontSize: 13 }} />
              )}
              {statusLabel}
            </span>
          </div>
          <div className="paper-head-sub">
            <span className="is-mono">{paper.root}</span>
            <span className="lmcc-dot" />
            <span>{paper.summary.total} 道题</span>
            <span className="lmcc-dot" />
            <span>{paperRuntimeLabel(paper)}</span>
            {paper.nested ? (
              <>
                <span className="lmcc-dot" />
                <span>单一顶层目录</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="paper-head-actions">
          <button
            type="button"
            className="lmcc-action"
            onClick={handleRefresh}
            disabled={refreshing}
            title="重新扫描 ~/.lmcc-studio"
          >
            <RefreshRoundedIcon
              sx={{ fontSize: 16 }}
              className={refreshing ? 'lmcc-spin' : ''}
            />
            {refreshing ? '扫描中…' : '刷新试卷'}
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

      <div className="paper-summary-strip">
        <div className="paper-summary-item">
          <span className="paper-summary-label">题目</span>
          <strong>{paper.summary.total}</strong>
        </div>
        <div className="paper-summary-item">
          <span className="paper-summary-label">有效</span>
          <strong>{paper.summary.valid}</strong>
        </div>
        <div className="paper-summary-item">
          <span className="paper-summary-label">答案声明</span>
          <strong>{paper.summary.answerFileCount}</strong>
        </div>
        <div className="paper-summary-item">
          <span className="paper-summary-label">错误</span>
          <strong className={errorCount > 0 ? 'is-error' : ''}>
            {errorCount}
          </strong>
        </div>
        <div className="paper-summary-item">
          <span className="paper-summary-label">提示</span>
          <strong className={noteCount > 0 ? 'is-warning' : ''}>
            {noteCount}
          </strong>
        </div>
        <div className="paper-summary-runtime">
          <span className="paper-summary-label">题目文件</span>
          <span className="is-mono">
            {paper.questions.length} 个 ·{' '}
            {formatBytes(paper.meta?.questionBytes || 0)}
          </span>
        </div>
      </div>

      <div className="paper-body">
        <main className="paper-main">
          <section className="lmcc-card paper-question-card">
            <div className="lmcc-card-head">
              <h2>题目</h2>
              <span className="paper-card-hint">
                每个 .lmcc 是独立入口
              </span>
            </div>

            {paper.questions.length === 0 ? (
              <div className="paper-empty">
                <FolderOpenRoundedIcon sx={{ fontSize: 20 }} />
                试卷根目录中没有可读取的 .lmcc 文件。
              </div>
            ) : (
              <div className="paper-question-list">
                {paper.questions.map((question, index) => (
                  <QuestionCard
                    key={question.filePath}
                    question={{ ...question, index }}
                    checks={checksByFile.get(question.filePath) || []}
                    onOpen={handleOpenQuestion}
                    opening={opening}
                  />
                ))}
              </div>
            )}
          </section>

          {paper.questions.some((question) => !question.ok) ? (
            <section className="lmcc-card paper-error-list">
              <div className="lmcc-card-head">
                <h2>无法解析的题目</h2>
              </div>
              <ul>
                {paper.questions
                  .filter((question) => !question.ok)
                  .map((question) => (
                    <li key={question.filePath}>
                      <code>{question.fileName}</code>
                      <span>{question.error.message}</span>
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
        </main>

        <aside className="paper-aside">
          <RuntimeCard paper={paper} />
          <ContestCard paper={paper} />
          <ChecksCard
            checks={checks}
            loading={status.status === 'loading'}
          />
          <PaperInfoCard paper={paper} />
          <div className="paper-aside-note">
            <InfoOutlinedIcon sx={{ fontSize: 14 }} />
            试卷只做本地识别与阅读；不会自动提交答案。
          </div>
        </aside>
      </div>
    </div>
  );
}
